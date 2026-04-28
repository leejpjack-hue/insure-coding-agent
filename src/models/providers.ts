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
  {
    name: 'zhipu',
    models: [
      { provider: 'zhipu', model: 'glm-5.1', costPer1kInput: 0.005, costPer1kOutput: 0.05 },
    ],
  },
  {
    // GitHub Copilot (OAuth device flow). Cost is paid per Copilot subscription,
    // not per-token; 0/0 here so cost calculations don't mislead.
    name: 'copilot',
    models: [
      { provider: 'copilot', model: 'gpt-4.1', costPer1kInput: 0, costPer1kOutput: 0 },
      { provider: 'copilot', model: 'claude-sonnet-4', costPer1kInput: 0, costPer1kOutput: 0 },
      { provider: 'copilot', model: 'claude-opus-4', thinking: true, costPer1kInput: 0, costPer1kOutput: 0 },
      { provider: 'copilot', model: 'gemini-2.5-pro', costPer1kInput: 0, costPer1kOutput: 0 },
      { provider: 'copilot', model: 'o4-mini', costPer1kInput: 0, costPer1kOutput: 0 },
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
