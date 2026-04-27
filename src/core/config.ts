import { InsureAgentConfig, ModelConfig, ModelProvider, TaskType, Jurisdiction, ProductType, AgentLevel, ComplianceCheckType } from './types.js';

const DEFAULT_MODELS: Record<TaskType, ModelConfig> = {
  architecture_design: { provider: 'anthropic', model: 'claude-opus-4-7', thinking: true },
  commission_logic: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  code_generation: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  code_review: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  test_generation: { provider: 'deepseek', model: 'deepseek-v4-flash' },
  compliance_check: { provider: 'openai', model: 'gpt-4o-mini' },
  documentation: { provider: 'google', model: 'gemini-2.5-pro' },
  daily_completion: { provider: 'deepseek', model: 'deepseek-v4-flash' },
  general: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
};

export function loadConfig(overrides?: Partial<InsureAgentConfig>): InsureAgentConfig {
  const config: InsureAgentConfig = {
    port: parseInt(process.env.INSURE_AGENT_PORT || '7008'),
    host: process.env.INSURE_AGENT_HOST || '0.0.0.0',
    dbPath: process.env.INSURE_AGENT_DB_PATH || './data/insure-agent.db',
    defaultModel: {
      provider: (process.env.DEFAULT_MODEL_PROVIDER as ModelProvider) || 'openai',
      model: process.env.DEFAULT_MODEL || 'anthropic/claude-sonnet-4-20250514',
      apiKey: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL || process.env.OPENAI_BASE_URL,
    },
    modelRoutes: DEFAULT_MODELS,
    safetyLimits: {
      maxIterations: parseInt(process.env.MAX_ITERATIONS || '20'),
      maxConsecutiveFails: parseInt(process.env.MAX_CONSECUTIVE_FAILS || '5'),
      autoFix: process.env.AUTO_FIX !== 'false',
      requireApprovalAfter: parseInt(process.env.REQUIRE_APPROVAL_AFTER || '10'),
      maxCheckpointsPerSession: parseInt(process.env.MAX_CHECKPOINTS || '50'),
      dangerousCommands: ['rm', 'drop', 'delete', 'truncate', 'shutdown', 'reboot', 'mkfs', 'dd'],
      rateLimitPerMinute: parseInt(process.env.RATE_LIMIT || '60'),
    },
    amsDomain: {
      jurisdiction: (process.env.AMS_JURISDICTION as Jurisdiction) || 'HK',
      supportedProducts: ['life', 'health', 'property', 'motor', 'travel', 'group_life', 'group_health'],
      agentLevels: ['bronze', 'silver', 'gold', 'platinum', 'unit_manager', 'branch_manager', 'regional_director'],
      commissionTypes: ['flat_rate', 'tiered', 'override', 'bonus', 'renewal'],
      complianceChecks: ['data_privacy', 'commission_disclosure', 'agent_licensing', 'consumer_protection', 'reporting'],
    },
  };

  if (overrides) {
    return { ...config, ...overrides };
  }
  return config;
}

export function getModelForTask(config: InsureAgentConfig, taskType: TaskType): ModelConfig {
  return config.modelRoutes[taskType] || config.defaultModel;
}
