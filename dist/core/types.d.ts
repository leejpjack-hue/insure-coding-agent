export type AgentStatus = 'idle' | 'thinking' | 'executing_tool' | 'waiting_approval' | 'completed' | 'failed' | 'paused';
export interface AgentState {
    sessionId: string;
    status: AgentStatus;
    currentIteration: number;
    totalTokensUsed: number;
    totalCost: number;
    filesModified: string[];
    testsRun: number;
    testsPassed: number;
    startedAt: number;
    updatedAt: number;
}
export interface Session {
    id: string;
    projectRoot: string;
    status: 'active' | 'paused' | 'completed' | 'failed';
    modelConfig: ModelConfig;
    state: AgentState;
    createdAt: number;
    updatedAt: number;
}
export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';
export interface ToolCall {
    id: string;
    name: string;
    params: Record<string, unknown>;
    reasoning?: string;
}
export interface ToolResult {
    callId: string;
    status: 'success' | 'error' | 'denied';
    content: string;
    metadata?: Record<string, unknown>;
    duration: number;
}
export interface Message {
    id: string;
    sessionId: string;
    role: MessageRole;
    content: string;
    toolCall?: ToolCall;
    toolResult?: ToolResult;
    timestamp: number;
    checkpointId?: string;
}
export interface Checkpoint {
    id: string;
    sessionId: string;
    iteration: number;
    description: string;
    fileSnapshots: Record<string, string>;
    createdAt: number;
}
export type Event = {
    type: 'file_changed';
    path: string;
    content: string;
} | {
    type: 'lsp_diagnostic';
    file: string;
    diagnostics: LSPDiagnostic[];
} | {
    type: 'tool_executed';
    tool: string;
    result: ToolResult;
} | {
    type: 'test_completed';
    passed: number;
    failed: number;
    duration: number;
} | {
    type: 'compliance_checked';
    violations: ComplianceViolation[];
    riskScore: number;
} | {
    type: 'checkpoint_created';
    id: string;
    sessionId: string;
} | {
    type: 'session_paused';
    sessionId: string;
    reason: string;
} | {
    type: 'session_resumed';
    sessionId: string;
} | {
    type: 'user_input_required';
    message: string;
} | {
    type: 'agent_error';
    error: string;
    iteration: number;
} | {
    type: 'hook_triggered';
    hookName: string;
    triggerEvent: string;
} | {
    type: 'commission_validated';
    isValid: boolean;
    discrepancies: string[];
} | {
    type: 'license_checked';
    agentId: string;
    status: LicenseStatus;
};
export interface LSPDiagnostic {
    severity: 'error' | 'warning' | 'info';
    message: string;
    file: string;
    line: number;
    column?: number;
    code?: string;
}
export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'zhipu' | 'copilot' | 'custom';
export interface ModelConfig {
    provider: ModelProvider;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    thinking?: boolean;
    maxTokens?: number;
    temperature?: number;
    costPer1kInput?: number;
    costPer1kOutput?: number;
}
export interface ModelRoute {
    taskType: TaskType;
    complexity: 'low' | 'medium' | 'high';
    budget: 'economy' | 'standard' | 'premium';
    model: ModelConfig;
}
export type TaskType = 'architecture_design' | 'commission_logic' | 'code_generation' | 'code_review' | 'test_generation' | 'compliance_check' | 'documentation' | 'daily_completion' | 'general';
export type SafetyLevel = 'auto_approve' | 'need_confirmation' | 'deny';
export interface ToolDefinition {
    name: string;
    description: string;
    safetyLevel: SafetyLevel;
    params: ToolParam[];
}
export interface ToolParam {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required: boolean;
    description: string;
    default?: unknown;
}
export interface Pipeline {
    id: string;
    name: string;
    description: string;
    steps: PipelineStep[];
}
export interface PipelineStep {
    name: string;
    description: string;
    taskType: TaskType;
    modelOverride?: ModelConfig;
    maxIterations?: number;
    requireApproval?: boolean;
}
export interface PipelineResult {
    pipelineId: string;
    status: 'success' | 'partial' | 'failed';
    stepsCompleted: number;
    totalSteps: number;
    filesCreated: string[];
    filesModified: string[];
    testsRun: number;
    testsPassed: number;
    complianceViolations: number;
    duration: number;
}
export type AgentLevel = 'bronze' | 'silver' | 'gold' | 'platinum' | 'unit_manager' | 'branch_manager' | 'regional_director';
export type ProductType = 'life' | 'health' | 'property' | 'motor' | 'travel' | 'group_life' | 'group_health';
export type Jurisdiction = 'HK' | 'SG' | 'EU' | 'US';
export type CommissionType = 'flat_rate' | 'tiered' | 'override' | 'bonus' | 'renewal';
export interface CommissionTier {
    id: string;
    name: string;
    minPremium: number;
    maxPremium: number;
    rate: number;
    productType: ProductType;
    agentLevel: AgentLevel;
    policyYear: number;
    isRenewal: boolean;
}
export interface CommissionInput {
    agentLevel: AgentLevel;
    productType: ProductType;
    premiumAmount: number;
    policyYear: number;
    isRenewal: boolean;
    teamSize?: number;
    jurisdiction: Jurisdiction;
}
export interface CommissionResult {
    commission: number;
    rate: number;
    tier: string;
    breakdown: CommissionBreakdown[];
}
export interface CommissionBreakdown {
    label: string;
    amount: number;
    rate: number;
}
export type LicenseStatus = 'active' | 'expired' | 'suspended' | 'pending_renewal' | 'pending_approval';
export interface LicenseInfo {
    agentId: string;
    licenseNumber: string;
    status: LicenseStatus;
    authorizedProducts: ProductType[];
    issuedAt: number;
    expiresAt: number;
    jurisdiction: Jurisdiction;
    continuingEducationHours: number;
    requiredCEHours: number;
}
export type ViolationSeverity = 'critical' | 'warning' | 'info';
export type ComplianceCheckType = 'data_privacy' | 'commission_disclosure' | 'agent_licensing' | 'consumer_protection' | 'reporting' | 'capital_adequacy';
export interface ComplianceViolation {
    type: ComplianceCheckType;
    severity: ViolationSeverity;
    file: string;
    line: number;
    description: string;
    recommendation: string;
    jurisdiction: Jurisdiction;
    ruleReference?: string;
}
export interface ComplianceResult {
    passed: boolean;
    violations: ComplianceViolation[];
    overallRiskScore: number;
    checkedAt: number;
    jurisdiction: Jurisdiction;
}
export interface AuditEntry {
    id: string;
    sessionId: string;
    action: string;
    details: Record<string, unknown>;
    timestamp: number;
    userId?: string;
}
export interface InsureAgentConfig {
    port: number;
    host: string;
    dbPath: string;
    defaultModel: ModelConfig;
    modelRoutes: Record<TaskType, ModelConfig>;
    safetyLimits: SafetyLimits;
    amsDomain: AMSDomainConfig;
}
export interface SafetyLimits {
    maxIterations: number;
    maxConsecutiveFails: number;
    autoFix: boolean;
    requireApprovalAfter: number;
    maxCheckpointsPerSession: number;
    dangerousCommands: string[];
    rateLimitPerMinute: number;
}
export interface AMSDomainConfig {
    jurisdiction: Jurisdiction;
    supportedProducts: ProductType[];
    agentLevels: AgentLevel[];
    commissionTypes: CommissionType[];
    complianceChecks: ComplianceCheckType[];
}
