// Pipeline execution types and built-in AMS pipelines

import type {
  Pipeline,
  PipelineStep,
  PipelineResult,
  TaskType,
  ModelConfig,
  AgentState,
  ComplianceViolation,
} from '../core/types.js';

// ===== Pipeline Execution Types =====

export interface PipelineStepResult {
  stepName: string;
  status: 'success' | 'failed' | 'skipped';
  agentState: AgentState | null;
  output: string;
  filesCreated: string[];
  filesModified: string[];
  testsRun: number;
  testsPassed: number;
  complianceViolations: ComplianceViolation[];
  duration: number;
  error?: string;
}

export interface PipelineContext {
  pipelineId: string;
  sessionId: string;
  projectRoot: string;
  currentStepIndex: number;
  previousResults: PipelineStepResult[];
  sharedState: Record<string, unknown>;
}

export interface PipelineRunOptions {
  projectRoot: string;
  maxIterations?: number;
  needApproval?: (iteration: number, description: string) => Promise<boolean>;
}

export type PipelineStepExecutor = (
  step: PipelineStep,
  context: PipelineContext,
  options: PipelineRunOptions,
) => Promise<PipelineStepResult>;

// ===== Pipeline Registry =====

export class PipelineRegistry {
  private pipelines: Map<string, Pipeline> = new Map();

  register(pipeline: Pipeline): void {
    if (this.pipelines.has(pipeline.id)) {
      throw new Error(`Pipeline "${pipeline.id}" already registered`);
    }
    this.pipelines.set(pipeline.id, pipeline);
  }

  get(id: string): Pipeline | undefined {
    return this.pipelines.get(id);
  }

  list(): Pipeline[] {
    return Array.from(this.pipelines.values());
  }

  findByTaskType(taskType: TaskType): Pipeline[] {
    return this.list().filter(p =>
      p.steps.some(s => s.taskType === taskType),
    );
  }
}

// ===== Built-in AMS Pipelines =====

export const COMMISSION_CHANGE_PIPELINE: Pipeline = {
  id: 'commission_change',
  name: 'Commission Formula Change',
  description: 'Full pipeline for modifying commission calculation formulas with validation, testing, and compliance checks',
  steps: [
    {
      name: 'read_current_formula',
      description: 'Read and understand the current commission formula implementation',
      taskType: 'code_review',
      maxIterations: 5,
    },
    {
      name: 'implement_change',
      description: 'Implement the commission formula change according to requirements',
      taskType: 'code_generation',
      maxIterations: 10,
    },
    {
      name: 'write_tests',
      description: 'Write unit tests covering the commission formula change including edge cases',
      taskType: 'test_generation',
      maxIterations: 8,
    },
    {
      name: 'run_tests_and_fix',
      description: 'Run tests and fix any failures iteratively',
      taskType: 'code_generation',
      maxIterations: 10,
      requireApproval: false,
    },
    {
      name: 'validate_commission',
      description: 'Validate commission calculations against known expected values',
      taskType: 'commission_logic',
      maxIterations: 5,
    },
    {
      name: 'compliance_check',
      description: 'Run compliance checks for commission disclosure requirements',
      taskType: 'compliance_check',
      maxIterations: 5,
      requireApproval: true,
    },
  ],
};

export const AGENT_ONBOARDING_PIPELINE: Pipeline = {
  id: 'agent_onboarding',
  name: 'Agent Onboarding',
  description: 'Pipeline for setting up a new insurance agent with licensing, product authorization, and commission tier assignment',
  steps: [
    {
      name: 'create_agent_record',
      description: 'Create the agent database record with level, team assignment, and personal details',
      taskType: 'code_generation',
      maxIterations: 5,
    },
    {
      name: 'setup_licensing',
      description: 'Set up agent licensing for the required product types and jurisdiction',
      taskType: 'code_generation',
      maxIterations: 5,
    },
    {
      name: 'assign_commission_tier',
      description: 'Assign the appropriate commission tier based on agent level and products',
      taskType: 'commission_logic',
      maxIterations: 5,
    },
    {
      name: 'compliance_verification',
      description: 'Verify all licensing and compliance requirements are met for the jurisdiction',
      taskType: 'compliance_check',
      maxIterations: 5,
      requireApproval: true,
    },
  ],
};

export const COMPLIANCE_AUDIT_PIPELINE: Pipeline = {
  id: 'compliance_audit',
  name: 'Compliance Audit',
  description: 'Full compliance audit pipeline covering data privacy, commission disclosure, agent licensing, and reporting',
  steps: [
    {
      name: 'scan_data_privacy',
      description: 'Scan codebase for PII handling and data privacy compliance',
      taskType: 'compliance_check',
      maxIterations: 5,
    },
    {
      name: 'check_commission_disclosure',
      description: 'Verify commission disclosure rules are correctly implemented',
      taskType: 'compliance_check',
      maxIterations: 5,
    },
    {
      name: 'verify_agent_licensing',
      description: 'Verify agent licensing logic meets regulatory requirements',
      taskType: 'compliance_check',
      maxIterations: 5,
    },
    {
      name: 'generate_audit_report',
      description: 'Generate comprehensive audit report with all findings and recommendations',
      taskType: 'documentation',
      maxIterations: 5,
      requireApproval: true,
    },
  ],
};

export const PR_REVIEW_PIPELINE: Pipeline = {
  id: 'pr_review',
  name: 'Pull Request Review',
  description: 'Automated PR review pipeline with code review, test verification, and compliance checks',
  steps: [
    {
      name: 'code_review',
      description: 'Review code changes for quality, correctness, and AMS domain best practices',
      taskType: 'code_review',
      maxIterations: 8,
    },
    {
      name: 'run_tests',
      description: 'Run all existing tests and verify no regressions',
      taskType: 'test_generation',
      maxIterations: 5,
    },
    {
      name: 'check_compliance',
      description: 'Run compliance checks on all changed files',
      taskType: 'compliance_check',
      maxIterations: 5,
    },
    {
      name: 'summary_report',
      description: 'Generate review summary with findings, suggestions, and approval recommendation',
      taskType: 'documentation',
      maxIterations: 3,
      requireApproval: true,
    },
  ],
};

export const BUG_FIX_PIPELINE: Pipeline = {
  id: 'bug_fix',
  name: 'Bug Fix',
  description: 'Structured bug fix pipeline with diagnosis, fix, test, and verification',
  steps: [
    {
      name: 'diagnose',
      description: 'Read relevant code and diagnose the root cause of the bug',
      taskType: 'code_review',
      maxIterations: 8,
    },
    {
      name: 'implement_fix',
      description: 'Implement the fix for the identified bug',
      taskType: 'code_generation',
      maxIterations: 10,
    },
    {
      name: 'write_regression_tests',
      description: 'Write regression tests to prevent the bug from recurring',
      taskType: 'test_generation',
      maxIterations: 5,
    },
    {
      name: 'verify_fix',
      description: 'Run all tests and verify the fix resolves the issue without regressions',
      taskType: 'test_generation',
      maxIterations: 5,
    },
  ],
};

export const FEATURE_DEVELOPMENT_PIPELINE: Pipeline = {
  id: 'feature_development',
  name: 'Feature Development',
  description: 'Full feature development pipeline from architecture to testing and compliance',
  steps: [
    {
      name: 'architecture_design',
      description: 'Design the feature architecture and API interfaces',
      taskType: 'architecture_design',
      maxIterations: 8,
      requireApproval: true,
    },
    {
      name: 'implement_feature',
      description: 'Implement the feature according to the architecture design',
      taskType: 'code_generation',
      maxIterations: 15,
    },
    {
      name: 'write_tests',
      description: 'Write comprehensive unit and integration tests',
      taskType: 'test_generation',
      maxIterations: 8,
    },
    {
      name: 'compliance_check',
      description: 'Run compliance checks on the new feature code',
      taskType: 'compliance_check',
      maxIterations: 5,
    },
    {
      name: 'documentation',
      description: 'Write documentation for the new feature',
      taskType: 'documentation',
      maxIterations: 3,
    },
  ],
};

// ===== Task Type to Pipeline Mapping =====

export const TASK_PIPELINE_MAP: Record<string, string> = {
  commission_logic: 'commission_change',
  compliance_check: 'compliance_audit',
  code_review: 'pr_review',
};

export function getDefaultPipelineForTask(taskType: TaskType): Pipeline | undefined {
  const pipelineId = TASK_PIPELINE_MAP[taskType];
  if (!pipelineId) return undefined;
  return BUILT_IN_PIPELINES.find(p => p.id === pipelineId);
}

export const BUILT_IN_PIPELINES: Pipeline[] = [
  COMMISSION_CHANGE_PIPELINE,
  AGENT_ONBOARDING_PIPELINE,
  COMPLIANCE_AUDIT_PIPELINE,
  PR_REVIEW_PIPELINE,
  BUG_FIX_PIPELINE,
  FEATURE_DEVELOPMENT_PIPELINE,
];

export function createBuiltinPipelineRegistry(): PipelineRegistry {
  const registry = new PipelineRegistry();
  for (const pipeline of BUILT_IN_PIPELINES) {
    registry.register(pipeline);
  }
  return registry;
}
