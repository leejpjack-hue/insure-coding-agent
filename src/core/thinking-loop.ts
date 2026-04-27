import { AgentState } from './types.js';
import { eventBus } from './events.js';

export interface ThinkingLoopOptions {
  maxIterations: number;
  maxConsecutiveFails: number;
  autoFix: boolean;
  requireApprovalAfter: number;
  onIteration?: (state: ThinkingLoopState) => void;
  needApproval?: (iteration: number, description: string) => Promise<boolean>;
}

export interface ThinkingLoopState {
  iteration: number;
  consecutiveFails: number;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'needs_approval';
  lastAction: string;
  totalTokensUsed: number;
}

export class ThinkingLoop {
  private state: ThinkingLoopState;
  private options: ThinkingLoopOptions;

  constructor(options: ThinkingLoopOptions) {
    this.options = options;
    this.state = {
      iteration: 0,
      consecutiveFails: 0,
      status: 'running',
      lastAction: '',
      totalTokensUsed: 0,
    };
  }

  getState(): ThinkingLoopState {
    return { ...this.state };
  }

  shouldContinue(): boolean {
    if (this.state.status !== 'running') return false;
    if (this.state.iteration >= this.options.maxIterations) return false;
    if (this.state.consecutiveFails >= this.options.maxConsecutiveFails) return false;
    return true;
  }

  incrementIteration(action: string): void {
    this.state.iteration++;
    this.state.lastAction = action;
    this.options.onIteration?.(this.getState());
  }

  recordSuccess(): void {
    this.state.consecutiveFails = 0;
  }

  recordFailure(reason: string): void {
    this.state.consecutiveFails++;
    this.state.lastAction = `FAILED: ${reason}`;
    eventBus.emit({ type: 'agent_error', error: reason, iteration: this.state.iteration });
  }

  addTokens(count: number): void {
    this.state.totalTokensUsed += count;
  }

  async checkApproval(description: string): Promise<boolean> {
    if (this.state.iteration >= this.options.requireApprovalAfter) {
      if (this.options.needApproval) {
        this.state.status = 'needs_approval';
        const approved = await this.options.needApproval(this.state.iteration, description);
        this.state.status = approved ? 'running' : 'paused';
        return approved;
      }
    }
    return true;
  }

  markCompleted(): void {
    this.state.status = 'completed';
  }

  markFailed(reason: string): void {
    this.state.status = 'failed';
    this.state.lastAction = `FATAL: ${reason}`;
  }

  pause(): void {
    this.state.status = 'paused';
  }

  resume(): void {
    this.state.status = 'running';
  }
}
