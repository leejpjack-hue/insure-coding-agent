import {
  Message, AgentState, ToolCall, ModelConfig,
} from './types.js';
import { ToolExecutor } from './tool-executor.js';
import { ToolRegistry } from './tool-registry.js';
import { ContextAssembler } from './context-assembler.js';
import { LLMClient, LLMResponse } from './llm-client.js';
import { ThinkingLoop, ThinkingLoopOptions, ThinkingLoopState } from './thinking-loop.js';
import { CheckpointManager } from './checkpoint.js';
import { SessionManager } from './session.js';
import { SafetyManager } from './safety-manager.js';
import { eventBus } from './events.js';

export interface AgentLoopOptions {
  sessionId: string;
  projectRoot: string;
  registry: ToolRegistry;
  sessionManager: SessionManager;
  modelConfig?: ModelConfig;
  maxIterations?: number;
  maxConsecutiveFails?: number;
  autoFix?: boolean;
  requireApprovalAfter?: number;
  maxRetries?: number;
  needApproval?: (iteration: number, description: string) => Promise<boolean>;
}

const DEFAULT_MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const CHARS_PER_TOKEN = 4;

// Completion signals the LLM uses to indicate the task is done
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
  private safetyManager: SafetyManager;
  private registry: ToolRegistry;
  private sessionId: string;
  private projectRoot: string;
  private modelConfig: ModelConfig;
  private maxRetries: number;

  // Tracking state
  private filesModified: Set<string> = new Set();
  private testsRun: number = 0;
  private testsPassed: number = 0;
  private totalTokensUsed: number = 0;
  private totalCost: number = 0;
  private startedAt: number = 0;

  constructor(opts: AgentLoopOptions) {
    this.sessionId = opts.sessionId;
    this.projectRoot = opts.projectRoot;
    this.registry = opts.registry;
    this.sessionManager = opts.sessionManager;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

    const session = this.sessionManager.getSession(opts.sessionId);
    this.modelConfig = opts.modelConfig ?? session?.modelConfig ?? {
      provider: 'openai',
      model: 'anthropic/claude-sonnet-4-20250514',
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
    this.testsRun = 0;
    this.testsPassed = 0;
    this.totalTokensUsed = 0;
    this.totalCost = 0;

    // Record user message
    this.sessionManager.addMessage({
      sessionId: this.sessionId,
      role: 'user',
      content: task,
      timestamp: Date.now(),
    });

    // Main agent loop
    while (this.thinkingLoop.shouldContinue()) {
      const history = this.sessionManager.getHistory(this.sessionId);

      // 1. Assemble full context
      const context = this.contextAssembler.assemble({
        sessionId: this.sessionId,
        projectRoot: this.projectRoot,
        task,
        history,
        registry: this.registry,
      });

      // 2. Call LLM with retry + exponential backoff
      let response: LLMResponse;
      try {
        response = await this.callLLMWithRetry(context, history);
        this.thinkingLoop.recordSuccess();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.thinkingLoop.recordFailure(message);

        // Record the error as an assistant message for context continuity
        this.sessionManager.addMessage({
          sessionId: this.sessionId,
          role: 'assistant',
          content: `[LLM Error — retrying] ${message}`,
          timestamp: Date.now(),
        });

        // If all retries exhausted, mark as failed
        const loopState = this.thinkingLoop.getState();
        if (loopState.consecutiveFails >= (this.thinkingLoop as unknown as { options: ThinkingLoopOptions }).options.maxConsecutiveFails) {
          this.thinkingLoop.markFailed(`Max consecutive LLM failures reached: ${message}`);
          break;
        }
        continue;
      }

      this.thinkingLoop.incrementIteration(response.type);

      // 3. Handle response by type
      if (response.type === 'text') {
        const handled = this.handleTextResponse(response.content || '');
        if (handled === 'completed') {
          this.thinkingLoop.markCompleted();
          break;
        }
        // Text response without completion marker — continue if we've done work
        if (this.thinkingLoop.getState().iteration > 1) {
          this.thinkingLoop.markCompleted();
          break;
        }
        continue;
      }

      if (response.type === 'tool_use' && response.toolCall) {
        const result = await this.handleToolUse(response.toolCall);
        if (result === 'paused') {
          break;
        }
        continue;
      }

      if (response.type === 'follow_up' && response.followUpQuestion) {
        this.handleFollowUp(response.followUpQuestion);
        this.thinkingLoop.pause();
        break;
      }
    }

    return this.finalizeAgentState();
  }

  private async callLLMWithRetry(
    context: string,
    history: Message[],
  ): Promise<LLMResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const messages = history.map(m => ({
          role: m.role as string,
          content: this.buildMessageContent(m),
        }));

        // Estimate input tokens for tracking
        const inputEstimate = this.estimateTokens(context + messages.map(m => m.content).join(''));
        this.addTokenUsage(inputEstimate);

        const response = await this.llmClient.chat({
          model: this.modelConfig,
          systemPrompt: context,
          messages,
        });

        // Estimate output tokens
        const outputEstimate = this.estimateTokens(
          response.content || '' +
          (response.toolCall ? JSON.stringify(response.toolCall.params) : '') +
          (response.followUpQuestion || ''),
        );
        this.addTokenUsage(outputEstimate);

        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < this.maxRetries - 1) {
          const delay = Math.min(
            BACKOFF_BASE_MS * Math.pow(2, attempt) + Math.random() * 1000,
            BACKOFF_MAX_MS,
          );
          await new Promise<void>(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error('LLM call failed after retries');
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

  private async handleToolUse(toolCall: ToolCall): Promise<'executed' | 'paused'> {
    // Safety check
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

    // Request approval if needed
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

    // Record assistant message with tool call
    this.sessionManager.addMessage({
      sessionId: this.sessionId,
      role: 'assistant',
      content: `Calling ${toolCall.name}`,
      toolCall,
      timestamp: Date.now(),
    });

    // Execute the tool
    const toolResult = await this.executor.execute(toolCall);

    // Record tool result
    this.sessionManager.addMessage({
      sessionId: this.sessionId,
      role: 'tool',
      content: toolResult.content,
      toolResult,
      timestamp: Date.now(),
    });

    // Track file modifications from tool results
    this.trackToolSideEffects(toolCall, toolResult.content);

    // Record success or failure
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

    // Track file modifications
    if (toolName === 'file_write' || toolName === 'file_edit') {
      const filePath = String(toolCall.params.path || toolCall.params.filePath || '');
      if (filePath) {
        this.filesModified.add(filePath);
      }
    }

    // Track test results
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
    // Match common test output patterns
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

    // Calculate cost
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
    // The onIteration callback is already called by ThinkingLoop.incrementIteration
    // We use this to track any additional side effects
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
