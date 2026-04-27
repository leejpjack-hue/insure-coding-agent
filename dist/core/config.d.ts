import { InsureAgentConfig, ModelConfig, TaskType } from './types.js';
export declare function loadConfig(overrides?: Partial<InsureAgentConfig>): InsureAgentConfig;
export declare function getModelForTask(config: InsureAgentConfig, taskType: TaskType): ModelConfig;
