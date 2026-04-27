import { ToolRegistry } from '../core/tool-registry.js';
import { SafetyLevel, ComplianceViolation, ComplianceCheckType, Jurisdiction, ViolationSeverity } from '../core/types.js';
import { eventBus } from '../core/events.js';

interface ComplianceRule {
  type: ComplianceCheckType;
  jurisdiction: Jurisdiction;
  description: string;
  check: (content: string, filePath: string) => ComplianceViolation[];
}

// PII patterns
const PII_PATTERNS = [
  { pattern: /[A-Z]{1,2}\d{6}[A-Z0-9]?/g, type: 'HKID', severity: 'critical' as ViolationSeverity },
  { pattern: /\b\d{3}-\d{3}-\d{3}\b/g, type: 'SSN', severity: 'critical' as ViolationSeverity },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, type: 'EMAIL', severity: 'warning' as ViolationSeverity },
  { pattern: /\b(?:\+?852[-\s]?)?\d{4}[-\s]?\d{4}\b/g, type: 'PHONE', severity: 'warning' as ViolationSeverity },
  { pattern: /\bPOL\d{8,12}\b/gi, type: 'POLICY_NUMBER', severity: 'critical' as ViolationSeverity },
];

// Compliance rules by jurisdiction
const RULES: ComplianceRule[] = [
  // Data Privacy
  {
    type: 'data_privacy',
    jurisdiction: 'HK',
    description: 'HK PDPO - Personal Data (Privacy) Ordinance',
    check: (content, filePath) => {
      const violations: ComplianceViolation[] = [];
      for (const { pattern, type, severity } of PII_PATTERNS) {
        const matches = content.match(pattern);
        if (matches && matches.length > 0) {
          const line = content.substring(0, content.indexOf(matches[0])).split('\n').length;
          violations.push({
            type: 'data_privacy',
            severity,
            file: filePath,
            line,
            description: `Unmasked ${type} detected in code (${matches.length} instance(s))`,
            recommendation: `Use environment variables or encrypted storage for ${type}. Apply masking in logs.`,
            jurisdiction: 'HK',
            ruleReference: 'PDPO Section 4 - Data Protection Principle 1',
          });
        }
      }
      return violations;
    },
  },
  {
    type: 'data_privacy',
    jurisdiction: 'EU',
    description: 'EU GDPR - General Data Protection Regulation',
    check: (content, filePath) => {
      const violations: ComplianceViolation[] = [];
      if (content.includes('localStorage') && (content.includes('name') || content.includes('email'))) {
        violations.push({
          type: 'data_privacy', severity: 'warning', file: filePath, line: 1,
          description: 'Potential PII stored in localStorage without consent',
          recommendation: 'Implement cookie consent banner and encrypt PII before localStorage',
          jurisdiction: 'EU', ruleReference: 'GDPR Article 6 - Lawfulness of processing',
        });
      }
      return violations;
    },
  },
  // Commission Disclosure
  {
    type: 'commission_disclosure',
    jurisdiction: 'HK',
    description: 'HK IA GL20 - Commission Disclosure Requirements',
    check: (content, filePath) => {
      const violations: ComplianceViolation[] = [];
      if (content.includes('commission') && !content.toLowerCase().includes('disclosure')) {
        const line = content.substring(0, content.indexOf('commission')).split('\n').length;
        violations.push({
          type: 'commission_disclosure', severity: 'warning', file: filePath, line,
          description: 'Commission calculation without disclosure mechanism',
          recommendation: 'Add commission disclosure display before policy sale completion',
          jurisdiction: 'HK', ruleReference: 'IA GL20 Section 5',
        });
      }
      return violations;
    },
  },
  // Agent Licensing
  {
    type: 'agent_licensing',
    jurisdiction: 'HK',
    description: 'HK Insurance Ordinance Cap 41 - Agent Registration',
    check: (content, filePath) => {
      const violations: ComplianceViolation[] = [];
      if (content.includes('sell') && content.includes('product') && !content.includes('license') && !content.includes('authori')) {
        violations.push({
          type: 'agent_licensing', severity: 'critical', file: filePath, line: 1,
          description: 'Product sale without license check',
          recommendation: 'Add license validation before allowing product sales',
          jurisdiction: 'HK', ruleReference: 'Insurance Ordinance Cap 41 Section 64',
        });
      }
      return violations;
    },
  },
  // Consumer Protection
  {
    type: 'consumer_protection',
    jurisdiction: 'HK',
    description: 'HK IA GL21 - Fair Treatment of Customers',
    check: (content, filePath) => {
      const violations: ComplianceViolation[] = [];
      if (content.includes('premium') && !content.includes('cooling')) {
        violations.push({
          type: 'consumer_protection', severity: 'warning', file: filePath, line: 1,
          description: 'Premium collection without cooling-off period',
          recommendation: 'Implement 21-day cooling-off period for life insurance policies',
          jurisdiction: 'HK', ruleReference: 'IA GL21 Section 3',
        });
      }
      return violations;
    },
  },
];

export function createComplianceChecker(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: 'compliance_checker',
      description: 'Check code for compliance violations against insurance regulations',
      safetyLevel: 'auto_approve' as SafetyLevel,
      params: [
        { name: 'content', type: 'string', required: true, description: 'File content to check' },
        { name: 'filePath', type: 'string', required: true, description: 'File path being checked' },
        { name: 'jurisdiction', type: 'string', required: false, description: 'Jurisdiction: HK, SG, EU, US (default HK)' },
        { name: 'checkTypes', type: 'array', required: false, description: 'Check types to run' },
      ],
    },
    execute: async (params) => {
      const content = String(params.content || '');
      const filePath = String(params.filePath || '');
      const jurisdiction = (String(params.jurisdiction || 'HK')) as Jurisdiction;
      const checkTypes = (params.checkTypes as ComplianceCheckType[]) || ['data_privacy', 'commission_disclosure', 'agent_licensing', 'consumer_protection'];

      const allViolations: ComplianceViolation[] = [];

      for (const rule of RULES) {
        if (rule.jurisdiction !== jurisdiction) continue;
        if (!checkTypes.includes(rule.type)) continue;
        const violations = rule.check(content, filePath);
        allViolations.push(...violations);
      }

      // Calculate risk score
      let riskScore = 0;
      for (const v of allViolations) {
        if (v.severity === 'critical') riskScore += 30;
        else if (v.severity === 'warning') riskScore += 10;
        else riskScore += 2;
      }
      riskScore = Math.min(riskScore, 100);

      const result = {
        passed: allViolations.filter(v => v.severity === 'critical').length === 0,
        violations: allViolations,
        overallRiskScore: riskScore,
        checkedAt: Date.now(),
        jurisdiction,
      };

      eventBus.emit({ type: 'compliance_checked', violations: allViolations, riskScore });

      return JSON.stringify(result, null, 2);
    },
  });
}
