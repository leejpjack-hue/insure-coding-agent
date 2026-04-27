import type { ModelConfig } from '../core/types.js';

export interface ProviderInfo {
  name: string;
  models: ModelConfig[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    name: 'anthropic',
    models: [
      { provider: 'anthropic', model: 'claude-opus-4-7', thinking: true, costPer1kInput: 0.015, costPer1kOutput: 0.075 },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514', costPer1kInput: 0.003, costPer1kOutput: 0.015 },
    ],
  },
  {
    name: 'openai',
    models: [
      { provider: 'openai', model: 'gpt-4o-mini', costPer1kInput: 0.00015, costPer1kOutput: 0.0006 },
    ],
  },
  {
    name: 'google',
    models: [
      { provider: 'google', model: 'gemini-2.5-pro', costPer1kInput: 0.00125, costPer1kOutput: 0.005 },
    ],
  },
  {
    name: 'deepseek',
    models: [
      { provider: 'deepseek', model: 'deepseek-v4-flash', costPer1kInput: 0.0001, costPer1kOutput: 0.0004 },
    ],
  },
];

export function getProviderModels(provider: string): ModelConfig[] {
  return PROVIDERS.find(p => p.name === provider)?.models ?? [];
}

export function getAllModels(): ModelConfig[] {
  return PROVIDERS.flatMap(p => p.models);
}

export function findModel(modelId: string): ModelConfig | undefined {
  return getAllModels().find(m => m.model === modelId);
}
