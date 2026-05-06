import {
  Message, AgentState, ToolCall, ModelConfig,
} from './types.js';
import { ToolExecutor } from './tool-executor.js';
import { ToolRegistry } from './tool-registry.js';
import { ContextAssembler } from './context-assembler.js';
import { LLMClient, LLMResponse, LLMStreamChunk, OpenAITool, NetworkError, APIError, StopReason } from './llm-client.js';
import { ThinkingLoop, ThinkingLoopOptions, ThinkingLoopState } from './thinking-loop.js';
import { CheckpointManager } from './checkpoint.js';
import { SessionManager } from './session.js';
import { SafetyManager } from './safety-manager.js';
import { MemoryManager } from './memory.js';
import { SkillGenerator } from './skill-generator.js';
import { eventBus } from './events.js';

// Events emitted by the agent loop for CLI display
export type AgentEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end' }
  | { type: 'text_delta'; text: string }
  | { type: 'text_end'; content: string }
  | { type: 'tool_call_start'; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; name: string; content: string; status: string; duration: number }
  | { type: 'error'; error: string }
  | { type: 'iteration'; iteration: number }
  | { type: 'complete'; result: string; iterations: number; tokens: number; cost: number };

export interface AgentLoopOptions {
  sessionId: string;
  projectRoot: string;
  registry: ToolRegistry;
  sessionManager: SessionManager;
  memoryManager?: MemoryManager;
  skillGenerator?: SkillGenerator;
  modelConfig?: ModelConfig;
  maxIterations?: number;
  maxConsecutiveFails?: number;
  autoFix?: boolean;
  requireApprovalAfter?: number;
  maxRetries?: number;
  needApproval?: (iteration: number, description: string) => Promise<boolean>;
  onEvent?: (event: AgentEvent) => void;
}

const DEFAULT_MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const CHARS_PER_TOKEN = 4;

const COMPLETION_MARKERS = [
  'task complete', 'task completed', '[done]', '[finished]',
  '## summary', '### summary', '## final result',
  'all changes have been made', 'all changes applied',
  'implementation complete', 'implementation finished',
];

export class AgentLoop {
  private executor: ToolExecutor;
  private contextAssembler: ContextAssembler;
  private llmClient: LLMClient;
  private thinkingLoop: ThinkingLoop;
  private checkpointManager: CheckpointManager;
  private sessionManager: SessionManager;
  private memoryManager?: MemoryManager;
  private skillGenerator?: SkillGenerator;
  private safetyManager: SafetyManager;
  private registry: ToolRegistry;
  private sessionId: string;
  private projectRoot: string;
  private modelConfig: ModelConfig;
  private maxRetries: number;
  private onEvent?: (event: AgentEvent) => void;

  private filesModified: Set<string> = new Set();
  private toolsUsedThisTask: string[] = [];
  private testsRun: number = 0;
  private testsPassed: number = 0;
  private totalTokensUsed: number = 0;
  private totalCost: number = 0;
  private startedAt: number = 0;
  private reasoningContinuations: number = 0;

  constructor(opts: AgentLoopOptions) {
    this.sessionId = opts.sessionId;
    this.projectRoot = opts.projectRoot;
    this.registry = opts.registry;
    this.sessionManager = opts.sessionManager;
    this.memoryManager = opts.memoryManager;
    this.skillGenerator = opts.skillGenerator;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.onEvent = opts.onEvent;

    const session = this.sessionManager.getSession(opts.sessionId);
    this.modelConfig = opts.modelConfig ?? session?.modelConfig ?? {
      provider: 'zhipu',
      model: 'glm-5.1',
    };

    this.checkpointManager = new CheckpointManager();
    this.safetyManager = new SafetyManager();

    this.executor = new ToolExecutor({
      sessionId: opts.sessionId,
      projectRoot: opts.projectRoot,
      registry: opts.registry,
      checkpointManager: this.checkpointManager,
    });

    this.contextAssembler = new ContextAssembler();
    this.llmClient = new LLMClient();

    const loopOptions: ThinkingLoopOptions = {
      maxIterations: opts.maxIterations ?? 20,
      maxConsecutiveFails: opts.maxConsecutiveFails ?? 5,
      autoFix: opts.autoFix !== false,
      requireApprovalAfter: opts.requireApprovalAfter ?? 10,
      needApproval: opts.needApproval,
      onIteration: (state: ThinkingLoopState) => {
        this.emitIterationEvent(state);
      },
    };

    this.thinkingLoop = new ThinkingLoop(loopOptions);
  }

  async run(task: string): Promise<AgentState> {
    const session = this.sessionManager.getSession(this.sessionId);
    if (!session) throw new Error(`Session not found: ${this.sessionId}`);

    this.startedAt = Date.now();
    this.filesModified = new Set();
    this.toolsUsedThisTask = [];
    this.testsRun = 0;
    this.testsPassed = 0;
    this.totalTokensUsed = 0;
    this.totalCost = 0;
    this.reasoningContinuations = 0;

    this.sessionManager.addMessage({
      sessionId: this.sessionId,
      role: 'user',
      content: task,
      timestamp: Date.now(),
    });

    while (this.thinkingLoop.shouldContinue()) {
      const history = this.sessionManager.getHistory(this.sessionId);
      const context = this.contextAssembler.assemble({
        sessionId: this.sessionId,
        projectRoot: this.projectRoot,
        task,
        history,
        registry: this.registry,
        memoryManager: this.memoryManager,
        skillGenerator: this.skillGenerator,
      });

      let response: LLMResponse;
      try {
        response = await this.callLLMWithRetry(context, history);
        this.thinkingLoop.recordSuccess();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isNetwork = err instanceof NetworkError;
        this.onEvent?.({ type: 'error', error: message });

        this.sessionManager.addMessage({
          sessionId: this.sessionId,
          role: 'assistant',
          content: isNetwork
            ? `[Network error — exhausted retries] ${message}`
            : `[LLM Error — retrying] ${message}`,
          timestamp: Date.now(),
        });

        // Network failures don't indicate a problem with the prompt or model;
        // callLLMWithRetry already exhausted its dedicated network budget.
        // Fail the task immediately rather than confusing the consecutive-fails
        // logic (which is meant for genuinely flaky model behaviour).
        if (isNetwork) {
          this.thinkingLoop.markFailed(`Network unreachable after retries: ${message}`);
          break;
        }

        this.thinkingLoop.recordFailure(message);
        const loopState = this.thinkingLoop.getState();
        if (loopState.consecutiveFails >= (this.thinkingLoop as unknown as { options: ThinkingLoopOptions }).options.maxConsecutiveFails) {
          this.thinkingLoop.markFailed(`Max consecutive LLM failures reached: ${message}`);
          break;
        }
        continue;
      }

      this.thinkingLoop.incrementIteration(response.type);
      this.onEvent?.({ type: 'iteration', iteration: this.thinkingLoop.getState().iteration });

      if (response.type === 'text') {
        this.onEvent?.({ type: 'text_end', content: response.content || '' });
        // Persist the assistant text and look for explicit completion markers.
        const handled = this.handleTextResponse(response.content || '');

        // 1. Provider gave us a definitive stop signal — trust it.
        if (response.stopReason === 'stop') {
          this.thinkingLoop.markCompleted();
          break;
        }
        // 2. Model says "[done]" / "task completed" etc. — also trust.
        if (handled === 'completed') {
          this.thinkingLoop.markCompleted();
          break;
        }
        // 3. Provider truncated due to max_tokens — keep going so the model can
        //    finish its thought; the next iteration carries the partial reply
        //    as context.
        if (response.stopReason === 'length') {
          continue;
        }
        // 4. Unknown stop + heavy reasoning with minimal content — model was
        //    cut off mid-thinking (common with GLM-5.1's shared token budget).
        //    The model spent all tokens on reasoning and never reached its
        //    planned tool calls. Continue the loop with a prompt that tells it
        //    to skip re-analysis and call tools directly.
        if (response.stopReason === 'unknown'
            && response.reasoning && response.reasoning.length > 500
            && (!response.content || response.content.trim().length < 100)
            && this.reasoningContinuations < 3) {
          this.reasoningContinuations++;
          // Include the tail of the reasoning so the model can pick up
          // where it left off without re-analysing from scratch.
          const tail = response.reasoning.slice(-1500);
          this.sessionManager.addMessage({
            sessionId: this.sessionId,
            role: 'user',
            content: `[System: Your previous response was cut off during reasoning. ` +
              `You already have all the information from previous tool calls — DO NOT re-read files or re-analyze. ` +
              `End of your previous reasoning:\n"""\n${tail}\n"""\n` +
              `Call file_write (or the appropriate tool) NOW to create the document you were planning. ` +
              `Keep your thinking brief and go straight to the tool call.]`,
            timestamp: Date.now(),
          });
          continue;
        }
        // 5. Provider exposed stopReason but it's not 'stop' (e.g. 'unknown',
        //    'content_filter') — treat substantial text as a final answer.
        //    Without this, GLM-5.1 (which sometimes emits tool-call
        //    *announcements* as content) would loop forever.
        if (response.stopReason && response.stopReason !== 'unknown') {
          // anything other than the explicit-stop / explicit-length cases
          // already handled above falls through to the fallback heuristic.
        }
        // 6. Fallback heuristic for providers that don't expose stopReason
        //    (or report 'unknown'): a reply with substantial *content* is
        //    almost always final. Pure-reasoning responses with no content
        //    are handled by case 4 above.
        if (response.content && response.content.trim().length > 50) {
          this.thinkingLoop.markCompleted();
          break;
        }
        const totalText = (response.content || '') + (response.reasoning || '');
        if (totalText.length > 50) {
          this.thinkingLoop.markCompleted();
          break;
        }
        if (this.thinkingLoop.getState().iteration > 3) {
          this.thinkingLoop.markCompleted();
          break;
        }
        continue;
      }

      if (response.type === 'tool_use') {
        const calls = response.toolCalls && response.toolCalls.length > 0
          ? response.toolCalls
          : (response.toolCall ? [response.toolCall] : []);
        if (calls.length === 0) continue;

        // Process all tool calls returned in this assistant turn. We execute
        // them serially so each tool result is recorded in session history
        // before the next call sees it (a few tools — file_edit, file_write,
        // bash_execute — depend on side-effects of earlier calls). Independent
        // reads will execute fast either way; if you need true parallel reads
        // see docs/agent-loop-review.md.
        let paused = false;
        for (const tc of calls) {
          const result = await this.handleToolUse(tc);
          if (result === 'paused') { paused = true; break; }
        }
        if (paused) break;
        continue;
      }

      if (response.type === 'follow_up' && response.followUpQuestion) {
        this.handleFollowUp(response.followUpQuestion);
        this.thinkingLoop.pause();
        break;
      }
    }

    const state = this.finalizeAgentState();

    // Trigger memory learning on task completion
    if (state.status !== 'failed' && (this.memoryManager || this.skillGenerator)) {
      this.learnFromTask(task, state);
    }

    this.onEvent?.({
      type: 'complete',
      result: state.status === 'failed' ? 'Task failed' : 'Task completed',
      iterations: state.currentIteration,
      tokens: state.totalTokensUsed,
      cost: state.totalCost,
    });

    return state;
  }

  private async callLLMWithRetry(
    context: string,
    history: Message[],
  ): Promise<LLMResponse> {
    let lastError: Error | undefined;
    // Network failures are retried more aggressively (separate budget) than
    // model/API errors, since they don't indicate a problem with the prompt.
    const maxNetworkAttempts = Math.max(this.maxRetries, 5);
    let networkAttempts = 0;
    let modelAttempts = 0;

    while (networkAttempts < maxNetworkAttempts && modelAttempts < this.maxRetries) {
      try {
        const messages = history.map(m => ({
          role: m.role as string,
          content: this.buildMessageContent(m),
        }));

        const inputEstimate = this.estimateTokens(context + messages.map(m => m.content).join(''));
        this.addTokenUsage(inputEstimate);

        // Use streaming when an event listener is attached
        if (this.onEvent) {
          return await this.callLLMStreaming(context, messages);
        }

        const response = await this.llmClient.chat({
          model: this.modelConfig,
          systemPrompt: context,
          messages,
          tools: this.getToolDefinitions(),
        });

        const outputEstimate = this.estimateTokens(
          response.content || '' +
          (response.toolCall ? JSON.stringify(response.toolCall.params) : '') +
          (response.followUpQuestion || ''),
        );
        this.addTokenUsage(outputEstimate);

        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isNetwork = err instanceof NetworkError;
        const isRetryableApi = err instanceof APIError && err.isRetryable();

        // Permanent API errors (401, 403, 404) — bail immediately, don't burn retries
        if (err instanceof APIError && !err.isRetryable()) {
          throw err;
        }

        if (isNetwork) {
          networkAttempts++;
          // Longer backoff for network: 2s, 4s, 8s, 16s, 30s
          const delay = Math.min(2000 * Math.pow(2, networkAttempts - 1), BACKOFF_MAX_MS);
          await new Promise<void>(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Model error / retryable API error
        modelAttempts++;
        if (modelAttempts >= this.maxRetries) break;
        const delay = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, modelAttempts - 1) + Math.random() * 1000,
          BACKOFF_MAX_MS,
        );
        await new Promise<void>(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new Error('LLM call failed after retries');
  }

  private async callLLMStreaming(
    context: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<LLMResponse> {
    let reasoning = '';
    let content = '';
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let inThinking = false;
    let streamStopReason: StopReason = 'unknown';

    const toolDefs = this.getToolDefinitions();

    try {
      for await (const chunk of this.llmClient.chatStream({
        model: this.modelConfig,
        systemPrompt: context,
        messages,
        tools: toolDefs,
      })) {
        switch (chunk.type) {
          case 'reasoning':
            if (!inThinking) {
              this.onEvent?.({ type: 'thinking_start' });
              inThinking = true;
            }
            reasoning += chunk.text || '';
            this.onEvent?.({ type: 'thinking_delta', text: chunk.text || '' });
            break;
          case 'content':
            if (inThinking) {
              this.onEvent?.({ type: 'thinking_end' });
              inThinking = false;
            }
            content += chunk.text || '';
            this.onEvent?.({ type: 'text_delta', text: chunk.text || '' });
            break;
          case 'tool_call_start':
            if (inThinking) {
              this.onEvent?.({ type: 'thinking_end' });
              inThinking = false;
            }
            toolCalls.push({ id: chunk.toolCall!.id, name: chunk.toolCall!.name, arguments: '' });
            break;
          case 'tool_call_delta':
            if (toolCalls.length > 0) {
              toolCalls[toolCalls.length - 1].arguments += chunk.toolCall!.argumentsDelta;
            }
            break;
          case 'done':
            if (inThinking) {
              this.onEvent?.({ type: 'thinking_end' });
              inThinking = false;
            }
            streamStopReason = chunk.stopReason ?? 'unknown';
            break;
        }
      }
    } catch (streamErr) {
      // Don't swallow network errors — let the outer retry classify them.
      if (streamErr instanceof NetworkError) throw streamErr;
      // Stream failed mid-flight (partial JSON, unexpected EOF) — fall back to
      // a non-streaming call so we still get a clean response shape.
      const response = await this.llmClient.chat({
        model: this.modelConfig,
        systemPrompt: context,
        messages,
        tools: toolDefs,
      });
      if (response.reasoning) {
        this.onEvent?.({ type: 'thinking_start' });
        this.onEvent?.({ type: 'thinking_delta', text: response.reasoning });
        this.onEvent?.({ type: 'thinking_end' });
      }
      if (response.content) {
        this.onEvent?.({ type: 'text_delta', text: response.content });
      }
      this.onEvent?.({ type: 'text_end', content: response.content || '' });
      // The non-streaming fallback already returns toolCalls plural when present,
      // so the run() loop will iterate over them. tool_call_start is emitted
      // from handleToolUse() per call.
      return response;
    }

    const outputEstimate = this.estimateTokens(reasoning + content + toolCalls.map(tc => tc.arguments).join(''));
    this.addTokenUsage(outputEstimate);

    if (toolCalls.length > 0) {
      // Build typed ToolCall list. tool_call_start events are emitted from
      // handleToolUse() so each call is announced right before it executes.
      const built = toolCalls.map((tc, i) => ({
        id: tc.id || `tc_${Date.now()}_${i}`,
        name: tc.name,
        params: this.safeParseToolArgs(tc.arguments),
      }));
      return {
        type: 'tool_use',
        reasoning,
        toolCall: built[0],
        toolCalls: built,
        // Streaming providers report 'tool_calls' as the stop reason when the
        // model decides to call tools — treat that as canonical even if the
        // chunk happened to omit it.
        stopReason: streamStopReason === 'unknown' ? 'tool_calls' : streamStopReason,
      };
    }

    this.onEvent?.({ type: 'text_end', content });
    return { type: 'text', content, reasoning, stopReason: streamStopReason };
  }

  private handleTextResponse(content: string): 'completed' | 'continue' {
    this.sessionManager.addMessage({
      sessionId: this.sessionId,
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });

    const lower = content.toLowerCase();
    const isCompletion = COMPLETION_MARKERS.some(marker => lower.includes(marker));

    if (isCompletion) {
      return 'completed';
    }

    return 'continue';
  }

  private safeParseToolArgs(args: string): Record<string, unknown> {
    if (!args) return {};
    try { return JSON.parse(args); } catch { return { _raw: args }; }
  }

  private async handleToolUse(toolCall: ToolCall): Promise<'executed' | 'paused'> {
    // Announce the tool call to listeners before any safety/approval gate so
    // the CLI can render the step header even if the call is blocked.
    this.onEvent?.({ type: 'tool_call_start', name: toolCall.name, params: toolCall.params });

    const safetyCheck = this.safetyManager.checkTool(toolCall.name, toolCall.params);
    if (!safetyCheck.allowed) {
      this.sessionManager.addMessage({
        sessionId: this.sessionId,
        role: 'tool',
        content: `Tool denied: ${safetyCheck.reason}`,
        timestamp: Date.now(),
      });
      this.thinkingLoop.recordFailure(`Safety denial: ${safetyCheck.reason}`);
      return 'executed';
    }

    if (safetyCheck.requiresConfirmation) {
      const approved = await this.thinkingLoop.checkApproval(
        `Execute tool "${toolCall.name}" with params: ${JSON.stringify(toolCall.params).substring(0, 200)}`,
      );
      if (!approved) {
        this.sessionManager.addMessage({
          sessionId: this.sessionId,
          role: 'tool',
          content: 'User denied tool execution',
          timestamp: Date.now(),
        });
        this.thinkingLoop.pause();
        eventBus.emit({
          type: 'user_input_required',
          message: `Tool "${toolCall.name}" requires approval`,
        });
        return 'paused';
      }
    }

    this.sessionManager.addMessage({
      sessionId: this.sessionId,
      role: 'assistant',
      content: `Calling ${toolCall.name}`,
      toolCall,
      timestamp: Date.now(),
    });

    const toolResult = await this.executor.execute(toolCall);

    this.onEvent?.({
      type: 'tool_result',
      name: toolCall.name,
      content: toolResult.content,
      status: toolResult.status,
      duration: toolResult.duration,
    });

    this.sessionManager.addMessage({
      sessionId: this.sessionId,
      role: 'tool',
      content: toolResult.content,
      toolResult,
      timestamp: Date.now(),
    });

    this.trackToolSideEffects(toolCall, toolResult.content);
    this.toolsUsedThisTask.push(toolCall.name);

    if (toolResult.status === 'error') {
      this.thinkingLoop.recordFailure(`Tool error: ${toolResult.content}`);
    } else {
      this.thinkingLoop.recordSuccess();
    }

    return 'executed';
  }

  private handleFollowUp(question: string): void {
    this.sessionManager.addMessage({
      sessionId: this.sessionId,
      role: 'assistant',
      content: question,
      timestamp: Date.now(),
    });

    eventBus.emit({
      type: 'user_input_required',
      message: question,
    });
  }

  private trackToolSideEffects(toolCall: ToolCall, resultContent: string): void {
    const toolName = toolCall.name;

    if (toolName === 'file_write' || toolName === 'file_edit') {
      const filePath = String(toolCall.params.path || toolCall.params.filePath || '');
      if (filePath) {
        this.filesModified.add(filePath);
      }
    }

    if (toolName === 'bash_execute') {
      const cmd = String(toolCall.params.command || '');
      if (cmd.includes('test') || cmd.includes('spec') || cmd.includes('jest') || cmd.includes('mocha') || cmd.includes('vitest')) {
        const passed = this.extractTestCount(resultContent, 'passed');
        const failed = this.extractTestCount(resultContent, 'failed');
        const total = passed + failed;
        if (total > 0) {
          this.testsRun += total;
          this.testsPassed += passed;
          eventBus.emit({
            type: 'test_completed',
            passed,
            failed,
            duration: 0,
          });
        }
      }
    }
  }

  private extractTestCount(text: string, type: 'passed' | 'failed'): number {
    const patterns = type === 'passed'
      ? [/(\d+)\s+pass(?:ed|ing)?/i, /tests?[:\s]+(\d+)\s+pass/i, /(\d+) successful/i]
      : [/(\d+)\s+fail(?:ed|ing)?/i, /tests?[:\s]+(\d+)\s+fail/i, /(\d+)\s+failing/i];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return 0;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  private addTokenUsage(count: number): void {
    this.totalTokensUsed += count;
    this.thinkingLoop.addTokens(count);

    const inputCost = this.modelConfig.costPer1kInput ?? 0;
    const outputCost = this.modelConfig.costPer1kOutput ?? 0;
    const avgCostPer1k = (inputCost + outputCost) / 2;
    this.totalCost += (count / 1000) * avgCostPer1k;
  }

  private buildMessageContent(m: Message): string {
    let content = m.content;
    if (m.toolCall) {
      content += `\n[Tool Call: ${m.toolCall.name}(${JSON.stringify(m.toolCall.params).substring(0, 300)})]`;
    }
    if (m.toolResult) {
      content += `\n[Tool Result (${m.toolResult.status}): ${m.toolResult.content.substring(0, 500)}]`;
    }
    return content;
  }

  private emitIterationEvent(state: ThinkingLoopState): void {
    // kept for ThinkingLoop compatibility
  }

  /** Convert registered tools to OpenAI function-calling format. */
  private getToolDefinitions(): OpenAITool[] {
    return this.registry.list().map(def => ({
      type: 'function' as const,
      function: {
        name: def.name,
        description: def.description,
        parameters: {
          type: 'object' as const,
          properties: Object.fromEntries(
            def.params.map(p => {
              const schema: Record<string, unknown> = {
                type: p.type,
                description: p.description,
              };
              if (p.type === 'array') {
                schema.items = { type: 'string' };
              }
              if (p.type === 'object') {
                schema.properties = {};
              }
              if (p.default !== undefined) {
                schema.default = p.default;
              }
              return [p.name, schema];
            })
          ),
          required: def.params.filter(p => p.required).map(p => p.name),
        },
      },
    }));
  }

  private learnFromTask(task: string, state: AgentState): void {
    if (this.memoryManager) {
      const history = this.sessionManager.getHistory(this.sessionId);
      this.memoryManager.summarizeSession(
        history.map(m => ({ role: m.role, content: m.content })),
        this.sessionId,
      );
    }
    if (this.skillGenerator && this.toolsUsedThisTask.length >= 3) {
      const lastAssistant = [...this.sessionManager.getHistory(this.sessionId)]
        .reverse().find(m => m.role === 'assistant');
      this.skillGenerator.generateSkillDoc({
        task,
        toolsUsed: this.toolsUsedThisTask,
        sessionId: this.sessionId,
        outcome: lastAssistant?.content ?? state.status,
      });
    }
  }

  private finalizeAgentState(): AgentState {
    const loopState = this.thinkingLoop.getState();
    const statusMap: Record<string, AgentState['status']> = {
      completed: 'idle',
      failed: 'failed',
      paused: 'paused',
      needs_approval: 'waiting_approval',
      running: 'idle',
    };

    const agentState: AgentState = {
      sessionId: this.sessionId,
      status: statusMap[loopState.status] ?? 'idle',
      currentIteration: loopState.iteration,
      totalTokensUsed: this.totalTokensUsed,
      totalCost: this.totalCost,
      filesModified: Array.from(this.filesModified),
      testsRun: this.testsRun,
      testsPassed: this.testsPassed,
      startedAt: this.startedAt || Date.now(),
      updatedAt: Date.now(),
    };

    this.sessionManager.updateSession(this.sessionId, { state: agentState });
    return agentState;
  }

  undo(): boolean {
    return !!this.checkpointManager.undo(this.sessionId, this.projectRoot);
  }

  getStatus(): { agentState: AgentState; loopState: ThinkingLoopState } {
    const session = this.sessionManager.getSession(this.sessionId);
    const state: AgentState = session?.state ?? {
      sessionId: this.sessionId,
      status: 'idle' as const,
      currentIteration: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      filesModified: [],
      testsRun: 0,
      testsPassed: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    return { agentState: state, loopState: this.thinkingLoop.getState() };
  }
}
