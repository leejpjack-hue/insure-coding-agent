import { Message, AgentState, ToolCall } from './types.js';
import { ToolExecutor } from './tool-executor.js';
import { ToolRegistry } from './tool-registry.js';
import { ContextAssembler } from './context-assembler.js';
import { LLMClient, LLMResponse } from './llm-client.js';
import { ThinkingLoop, ThinkingLoopOptions } from './thinking-loop.js';
import { CheckpointManager } from './checkpoint.js';
import { SessionManager } from './session.js';
import { SafetyManager } from './safety-manager.js';
import { eventBus } from './events.js';

export interface AgentLoopOptions {
  sessionId: string;
  projectRoot: string;
  registry: ToolRegistry;
  sessionManager: SessionManager;
  maxIterations?: number;
  maxConsecutiveFails?: number;
  autoFix?: boolean;
  requireApprovalAfter?: number;
  needApproval?: (iteration: number, description: string) => Promise<boolean>;
}

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

  constructor(opts: AgentLoopOptions) {
    this.sessionId = opts.sessionId;
    this.projectRoot = opts.projectRoot;
    this.registry = opts.registry;
    this.sessionManager = opts.sessionManager;
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
    this.thinkingLoop = new ThinkingLoop({
      maxIterations: opts.maxIterations || 20,
      maxConsecutiveFails: opts.maxConsecutiveFails || 5,
      autoFix: opts.autoFix !== false,
      requireApprovalAfter: opts.requireApprovalAfter || 10,
      needApproval: opts.needApproval,
    });
  }

  async run(task: string): Promise<AgentState> {
    const session = this.sessionManager.getSession(this.sessionId);
    if (!session) throw new Error(`Session not found: ${this.sessionId}`);

    // Add user message
    this.sessionManager.addMessage({
      sessionId: this.sessionId,
      role: 'user',
      content: task,
      timestamp: Date.now(),
    });

    // Main agent loop
    while (this.thinkingLoop.shouldContinue()) {
      const history = this.sessionManager.getHistory(this.sessionId);

      // 1. Assemble context
      const context = this.contextAssembler.assemble({
        sessionId: this.sessionId,
        projectRoot: this.projectRoot,
        task,
        history,
        registry: this.registry,
      });

      // 2. Call LLM
      let response: LLMResponse;
      try {
        response = await this.llmClient.chat({
          model: session.modelConfig,
          systemPrompt: context,
          messages: history.map(m => ({ role: m.role, content: m.content })),
        });
        this.thinkingLoop.recordSuccess();
      } catch (err) {
        this.thinkingLoop.recordFailure(err instanceof Error ? err.message : String(err));
        continue;
      }

      this.thinkingLoop.incrementIteration(response.type);

      // 3. Handle response
      if (response.type === 'text') {
        // Agent wants to respond to user
        this.sessionManager.addMessage({
          sessionId: this.sessionId,
          role: 'assistant',
          content: response.content || '',
          timestamp: Date.now(),
        });

        // Check if this looks like completion (only if it's explicitly ending)
        const content = (response.content || '').toLowerCase();
        if (content.includes('task complete') || content.includes('[done]') || content.includes('[finished]')) {
          this.thinkingLoop.markCompleted();
          break;
        }
        // If no more tool calls and substantive response, complete after 1 text response
        if (this.thinkingLoop.getState().iteration > 0) {
          this.thinkingLoop.markCompleted();
          break;
        }
        continue;
      }

      if (response.type === 'tool_use' && response.toolCall) {
        // Safety check
        const safetyCheck = this.safetyManager.checkTool(response.toolCall.name, response.toolCall.params);
        if (!safetyCheck.allowed) {
          this.sessionManager.addMessage({
            sessionId: this.sessionId,
            role: 'tool',
            content: `Safety denial: ${safetyCheck.reason}`,
            timestamp: Date.now(),
          });
          this.thinkingLoop.recordFailure(`Safety denial: ${safetyCheck.reason}`);
          continue;
        }

        if (safetyCheck.requiresConfirmation) {
          const approved = await this.thinkingLoop.checkApproval(`Execute ${response.toolCall.name}`);
          if (!approved) {
            this.thinkingLoop.pause();
            break;
          }
        }

        // Execute tool
        const toolResult = await this.executor.execute(response.toolCall);

        // Add tool call and result to history
        this.sessionManager.addMessage({
          sessionId: this.sessionId,
          role: 'assistant',
          content: `Calling ${response.toolCall.name}`,
          toolCall: response.toolCall,
          timestamp: Date.now(),
        });

        this.sessionManager.addMessage({
          sessionId: this.sessionId,
          role: 'tool',
          content: toolResult.content,
          toolResult,
          timestamp: Date.now(),
        });

        if (toolResult.status === 'error') {
          this.thinkingLoop.recordFailure(`Tool error: ${toolResult.content}`);
        } else {
          this.thinkingLoop.recordSuccess();
        }

        continue;
      }

      if (response.type === 'follow_up' && response.followUpQuestion) {
        this.sessionManager.addMessage({
          sessionId: this.sessionId,
          role: 'assistant',
          content: response.followUpQuestion,
          timestamp: Date.now(),
        });
        this.thinkingLoop.pause();
        break;
      }
    }

    // Update session state
    const loopState = this.thinkingLoop.getState();
    const agentState: AgentState = {
      sessionId: this.sessionId,
      status: loopState.status === 'completed' ? 'idle' : loopState.status === 'failed' ? 'failed' : 'paused',
      currentIteration: loopState.iteration,
      totalTokensUsed: loopState.totalTokensUsed,
      totalCost: 0,
      filesModified: [],
      testsRun: 0,
      testsPassed: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.sessionManager.updateSession(this.sessionId, { state: agentState });
    return agentState;
  }

  undo(): boolean {
    return !!this.checkpointManager.undo(this.sessionId, this.projectRoot);
  }

  getStatus(): { agentState: AgentState; loopState: ReturnType<ThinkingLoop['getState']> } {
    const session = this.sessionManager.getSession(this.sessionId);
    const state: AgentState = session?.state || {
      sessionId: this.sessionId,
      status: 'idle',
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
