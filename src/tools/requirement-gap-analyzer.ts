import { ToolRegistry } from '../core/tool-registry.js';
import { SafetyLevel } from '../core/types.js';

/**
 * Question categories that must be answered before requirements can be
 * generated. Each category has a checklist of things the design must cover.
 */
const QUESTION_CATEGORIES = [
  {
    category: 'Business Context',
    icon: '📋',
    checks: [
      { id: 'BC01', question: 'Who are the end users / actors?', pattern: /(?:actor|user|role|stakeholder)/i },
      { id: 'BC02', question: 'What is the business goal / problem statement?', pattern: /(?:objective|goal|problem|purpose|why)/i },
      { id: 'BC03', question: 'Which jurisdictions does this apply to?', pattern: /(?:jurisdiction|HK|SG|EU|US|regional)/i },
      { id: 'BC04', question: 'Which insurance products are involved?', pattern: /(?:product|life|health|motor|travel|property|group)/i },
      { id: 'BC05', question: 'What is the current state / existing process?', pattern: /(?:current|existing|as-is|today|currently)/i },
      { id: 'BC06', question: 'What is the expected volume / scale?', pattern: /(?:volume|scale|throughput|users? per|transaction|per day|per month)/i },
    ],
  },
  {
    category: 'Functional Scope',
    icon: '⚙️',
    checks: [
      { id: 'FS01', question: 'What are the inputs and outputs?', pattern: /(?:input|output|request|response|parameter)/i },
      { id: 'FS02', question: 'What are the business rules / formulas?', pattern: /(?:rule|formula|calculation|logic|algorithm)/i },
      { id: 'FS03', question: 'What validations are required?', pattern: /(?:valid|check|verify|constraint|must be|range)/i },
      { id: 'FS04', question: 'What are the edge cases / exception flows?', pattern: /(?:edge case|exception|error|fallback|what if|boundary)/i },
      { id: 'FS05', question: 'What is the state machine / workflow?', pattern: /(?:state|status|transition|flow|step|workflow|lifecycle)/i },
      { id: 'FS06', question: 'What are the approval / authorization rules?', pattern: /(?:approv|authori|permission|sign.?off|gate)/i },
    ],
  },
  {
    category: 'Data & Integration',
    icon: '🔗',
    checks: [
      { id: 'DI01', question: 'What data entities are involved?', pattern: /(?:entity|table|model|schema|record|data)/i },
      { id: 'DI02', question: 'Which external systems does this integrate with?', pattern: /(?:integrat|API|AS400|payment|warehouse|BPM|external|third.?party)/i },
      { id: 'DI03', question: 'What data migration / conversion is needed?', pattern: /(?:migrat|convert|transform|ETL|data map|legacy)/i },
      { id: 'DI04', question: 'What are the data retention requirements?', pattern: /(?:retention|archive|purge|keep|store|delete after)/i },
    ],
  },
  {
    category: 'Compliance & Security',
    icon: '🔒',
    checks: [
      { id: 'CS01', question: 'What PII / sensitive data is handled?', pattern: /(?:PII|HKID|SSN|NRIC|personal|sensitive|PHI|medical)/i },
      { id: 'CS02', question: 'What regulatory requirements apply?', pattern: /(?:regulat|compliance|PDPO|GDPR|IA GL|MAS|NAIC|Solvency|IFRS)/i },
      { id: 'CS03', question: 'Is an audit trail required?', pattern: /(?:audit|trail|log|trace|record|accountability)/i },
      { id: 'CS04', question: 'What access control / role restrictions apply?', pattern: /(?:access.?control|role|RBAC|permission|restricted|privilege)/i },
    ],
  },
  {
    category: 'UI / UX',
    icon: '🖥️',
    checks: [
      { id: 'UX01', question: 'What screens / pages are needed?', pattern: /(?:screen|page|view|form|modal|dialog|tab)/i },
      { id: 'UX02', question: 'What user interactions / workflows?', pattern: /(?:click|button|submit|select|navigation|interaction|UX)/i },
      { id: 'UX03', question: 'What notifications / alerts are needed?', pattern: /(?:notif|alert|email|SMS|message|reminder|toast)/i },
      { id: 'UX04', question: 'What reports / exports are needed?', pattern: /(?:report|export|PDF|CSV|download|dashboard|chart)/i },
    ],
  },
  {
    category: 'Non-Functional',
    icon: '📊',
    checks: [
      { id: 'NF01', question: 'What are the performance requirements?', pattern: /(?:performance|SLA|latency|response time|throughput|concurrent)/i },
      { id: 'NF02', question: 'What is the rollback / recovery plan?', pattern: /(?:rollback|recovery|fallback|undo|revert|compensat)/i },
      { id: 'NF03', question: 'What are the availability requirements?', pattern: /(?:uptime|availability|DR|disaster|failover|redundancy)/i },
      { id: 'NF04', question: 'What is the deployment strategy?', pattern: /(?:deploy|release|environment|staging|production|blue.?green|canary)/i },
    ],
  },
];

export function createRequirementGapAnalyzer(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: 'requirement_gap_analyzer',
      description: 'Analyze a design document or feature request to identify missing information that must be clarified BEFORE generating user requirements. Returns a list of questions grouped by category.',
      safetyLevel: 'auto_approve' as SafetyLevel,
      params: [
        { name: 'content', type: 'string', required: true, description: 'Design document content or feature request description to analyze' },
        { name: 'featureName', type: 'string', required: false, description: 'Feature name (for reference in output)' },
        { name: 'categories', type: 'array', required: false, description: 'Categories to check (default: all). Options: Business Context, Functional Scope, Data & Integration, Compliance & Security, UI / UX, Non-Functional' },
      ],
    },
    execute: async (params) => {
      const content = String(params.content || '');
      const featureName = String(params.featureName || 'unnamed-feature');
      const requestedCategories = params.categories as string[] | undefined;

      if (!content || content.length < 20) {
        return JSON.stringify({
          error: 'Content too short to analyze. Provide the full design document or feature description.',
          minSuggestion: 'At minimum, describe: what the feature does, who uses it, and which products/jurisdictions it covers.',
        }, null, 2);
      }

      const allQuestions: Array<{
        category: string;
        icon: string;
        missing: Array<{ id: string; question: string }>;
        covered: string[];
      }> = [];

      let totalMissing = 0;
      let totalCovered = 0;

      for (const cat of QUESTION_CATEGORIES) {
        // Filter by requested categories if specified
        if (requestedCategories && requestedCategories.length > 0) {
          const match = requestedCategories.some(rc =>
            cat.category.toLowerCase().includes(rc.toLowerCase()) ||
            rc.toLowerCase().includes(cat.category.toLowerCase().split(' ')[0].toLowerCase()),
          );
          if (!match) continue;
        }

        const missing: Array<{ id: string; question: string }> = [];
        const covered: string[] = [];

        for (const check of cat.checks) {
          if (check.pattern.test(content)) {
            covered.push(check.id);
          } else {
            missing.push({ id: check.id, question: check.question });
          }
        }

        totalMissing += missing.length;
        totalCovered += covered.length;

        if (missing.length > 0 || covered.length > 0) {
          allQuestions.push({
            category: cat.category,
            icon: cat.icon,
            missing,
            covered,
          });
        }
      }

      const readinessScore = Math.round((totalCovered / (totalCovered + totalMissing)) * 100);
      const isReady = totalMissing === 0;

      // Build readable output
      const lines: string[] = [];
      lines.push(`## Requirement Readiness Analysis: ${featureName}`);
      lines.push(`**Readiness: ${readinessScore}%** — ${isReady ? 'READY to generate requirements' : `${totalMissing} question(s) need answers before proceeding`}`);
      lines.push('');

      for (const cat of allQuestions) {
        if (cat.missing.length === 0) {
          lines.push(`### ${cat.icon} ${cat.category}: ✅ All covered`);
          continue;
        }

        lines.push(`### ${cat.icon} ${cat.category}: ${cat.missing.length} missing`);
        for (const m of cat.missing) {
          lines.push(`  - [${m.id}] **${m.question}**`);
        }
        if (cat.covered.length > 0) {
          lines.push(`  _Covered: ${cat.covered.join(', ')}_`);
        }
        lines.push('');
      }

      if (!isReady) {
        lines.push('---');
        lines.push(`**Next step:** Answer the ${totalMissing} question(s) above, then re-run this analysis to confirm readiness before generating requirements.`);
      }

      return JSON.stringify({
        featureName,
        readinessScore,
        isReady,
        totalCovered,
        totalMissing,
        categories: allQuestions,
        summary: lines.join('\n'),
      }, null, 2);
    },
  });
}
