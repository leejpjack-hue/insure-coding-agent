import { ModelConfig, TaskType } from './types.js';

interface RouteRule {
  taskType: TaskType;
  model: ModelConfig;
}

const ROUTES: RouteRule[] = [
  { taskType: 'architecture_design', model: { provider: 'anthropic', model: 'claude-opus-4-7', thinking: true, costPer1kInput: 0.015, costPer1kOutput: 0.075 } },
  { taskType: 'commission_logic', model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', costPer1kInput: 0.003, costPer1kOutput: 0.015 } },
  { taskType: 'code_generation', model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', costPer1kInput: 0.003, costPer1kOutput: 0.015 } },
  { taskType: 'code_review', model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', costPer1kInput: 0.003, costPer1kOutput: 0.015 } },
  { taskType: 'test_generation', model: { provider: 'deepseek', model: 'deepseek-v4-flash', costPer1kInput: 0.0001, costPer1kOutput: 0.0004 } },
  { taskType: 'compliance_check', model: { provider: 'openai', model: 'gpt-4o-mini', costPer1kInput: 0.00015, costPer1kOutput: 0.0006 } },
  { taskType: 'documentation', model: { provider: 'google', model: 'gemini-2.5-pro', costPer1kInput: 0.00125, costPer1kOutput: 0.005 } },
  { taskType: 'daily_completion', model: { provider: 'deepseek', model: 'deepseek-v4-flash', costPer1kInput: 0.0001, costPer1kOutput: 0.0004 } },
];

export class ModelRouter {
  private routes: Map<TaskType, ModelConfig> = new Map();
  private fallback: ModelConfig;

  constructor(defaultModel: ModelConfig) {
    this.fallback = defaultModel;
    for (const route of ROUTES) {
      this.routes.set(route.taskType, route.model);
    }
  }

  route(taskType: TaskType): ModelConfig {
    return this.routes.get(taskType) || this.fallback;
  }

  addRoute(taskType: TaskType, model: ModelConfig): void {
    this.routes.set(taskType, model);
  }

  removeRoute(taskType: TaskType): boolean {
    return this.routes.delete(taskType);
  }

  listRoutes(): Array<{ taskType: TaskType; model: string; provider: string }> {
    const result: Array<{ taskType: TaskType; model: string; provider: string }> = [];
    for (const [taskType, config] of this.routes) {
      result.push({ taskType, model: config.model, provider: config.provider });
    }
    return result;
  }

  estimateCost(taskType: TaskType, inputTokens: number, outputTokens: number): number {
    const model = this.route(taskType);
    const inputCost = (model.costPer1kInput || 0) * (inputTokens / 1000);
    const outputCost = (model.costPer1kOutput || 0) * (outputTokens / 1000);
    return inputCost + outputCost;
  }
}
