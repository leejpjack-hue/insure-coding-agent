import { AgentLoop, AgentLoopOptions } from './agent-loop.js';
import { ToolRegistry } from './tool-registry.js';
import { SessionManager } from './session.js';
import { ModelConfig, TaskType } from './types.js';
import { ModelRouter } from './model-router.js';

export interface OrchestratorOptions {
  projectRoot: string;
  dbPath: string;
  registry: ToolRegistry;
  defaultModel: ModelConfig;
}

export class Orchestrator {
  private sessionManager: SessionManager;
  private registry: ToolRegistry;
  private modelRouter: ModelRouter;
  private projectRoot: string;
  private activeLoops: Map<string, AgentLoop> = new Map();

  constructor(opts: OrchestratorOptions) {
    this.sessionManager = new SessionManager(opts.dbPath);
    this.registry = opts.registry;
    this.modelRouter = new ModelRouter(opts.defaultModel);
    this.projectRoot = opts.projectRoot;
  }

  async runTask(task: string, taskType: TaskType = 'general'): Promise<{ sessionId: string; result: string }> {
    const model = this.modelRouter.route(taskType);
    const session = this.sessionManager.createSession(this.projectRoot, model);

    const loop = new AgentLoop({
      sessionId: session.id,
      projectRoot: this.projectRoot,
      registry: this.registry,
      sessionManager: this.sessionManager,
    });

    this.activeLoops.set(session.id, loop);

    try {
      const state = await loop.run(task);
      const history = this.sessionManager.getHistory(session.id);
      const lastAssistant = history.filter(m => m.role === 'assistant').pop();

      return {
        sessionId: session.id,
        result: lastAssistant?.content || `Task ${state.status} after ${state.currentIteration} iterations`,
      };
    } finally {
      this.activeLoops.delete(session.id);
    }
  }

  async continueSession(sessionId: string, task: string): Promise<string> {
    const loop = this.activeLoops.get(sessionId);
    if (!loop) throw new Error(`No active session: ${sessionId}`);

    await loop.run(task);
    const history = this.sessionManager.getHistory(sessionId);
    const lastAssistant = history.filter(m => m.role === 'assistant').pop();
    return lastAssistant?.content || 'Task completed';
  }

  listSessions() {
    return this.sessionManager.listSessions();
  }

  getSessionHistory(sessionId: string) {
    return this.sessionManager.getHistory(sessionId);
  }

  undo(sessionId: string): boolean {
    const loop = this.activeLoops.get(sessionId);
    if (!loop) return false;
    return loop.undo();
  }

  close(): void {
    this.sessionManager.close();
  }
}
