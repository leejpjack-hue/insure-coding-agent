// PII detection rules — used by compliance checker and on_file_save hook.
// Each rule has a regex and a recommended remediation.

import { ViolationSeverity } from '../core/types.js';

export interface PIIRule {
  id: string;
  type: string;
  pattern: RegExp;
  severity: ViolationSeverity;
  jurisdictions: string[];
  description: string;
  remediation: string;
}

export const PII_RULES: PIIRule[] = [
  {
    id: 'pii_hkid',
    type: 'HKID',
    pattern: /\b[A-Z]{1,2}\d{6}[A-Z0-9()]?\b/g,
    severity: 'critical',
    jurisdictions: ['HK'],
    description: 'Hong Kong Identity Card number',
    remediation: 'Mask all but last digit; encrypt at rest with AES-256.',
  },
  {
    id: 'pii_ssn',
    type: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    severity: 'critical',
    jurisdictions: ['US'],
    description: 'US Social Security Number',
    remediation: 'Tokenize; never store in plaintext or logs.',
  },
  {
    id: 'pii_nric_sg',
    type: 'NRIC',
    pattern: /\b[STFG]\d{7}[A-Z]\b/g,
    severity: 'critical',
    jurisdictions: ['SG'],
    description: 'Singapore NRIC',
    remediation: 'Mask middle digits per PDPA Advisory Guidelines.',
  },
  {
    id: 'pii_email',
    type: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    severity: 'warning',
    jurisdictions: ['HK', 'SG', 'EU', 'US'],
    description: 'Email address',
    remediation: 'Avoid emails in code; use config/env or a directory service.',
  },
  {
    id: 'pii_phone_hk',
    type: 'PHONE',
    pattern: /\b(?:\+?852[-\s]?)?[2-9]\d{3}[-\s]?\d{4}\b/g,
    severity: 'warning',
    jurisdictions: ['HK'],
    description: 'Hong Kong phone number',
    remediation: 'Store contact details in encrypted customer record only.',
  },
  {
    id: 'pii_policy_number',
    type: 'POLICY_NUMBER',
    pattern: /\bPOL[-_]?\d{8,12}\b/gi,
    severity: 'critical',
    jurisdictions: ['HK', 'SG', 'EU', 'US'],
    description: 'Insurance policy number',
    remediation: 'Reference policies by surrogate key; mask in logs.',
  },
  {
    id: 'pii_credit_card',
    type: 'CREDIT_CARD',
    pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    severity: 'critical',
    jurisdictions: ['HK', 'SG', 'EU', 'US'],
    description: 'Credit card number (PCI DSS)',
    remediation: 'Never log card numbers; use a PCI-compliant tokenization service.',
  },
  {
    id: 'pii_iban',
    type: 'IBAN',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    severity: 'warning',
    jurisdictions: ['EU'],
    description: 'IBAN bank account number',
    remediation: 'Encrypt at rest; mask in non-finance views.',
  },
];

export function maskPII(text: string): string {
  let masked = text;
  for (const rule of PII_RULES) {
    masked = masked.replace(rule.pattern, (m) => {
      if (m.length <= 4) return '*'.repeat(m.length);
      return m.slice(0, 2) + '*'.repeat(m.length - 4) + m.slice(-2);
    });
  }
  return masked;
}

export function findPII(content: string, jurisdiction?: string): Array<{ rule: PIIRule; matches: string[]; lines: number[] }> {
  const findings: Array<{ rule: PIIRule; matches: string[]; lines: number[] }> = [];
  for (const rule of PII_RULES) {
    if (jurisdiction && !rule.jurisdictions.includes(jurisdiction)) continue;
    const matches: string[] = [];
    const lines: number[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    while ((m = re.exec(content)) !== null) {
      matches.push(m[0]);
      lines.push(content.substring(0, m.index).split('\n').length);
    }
    if (matches.length > 0) findings.push({ rule, matches, lines });
  }
  return findings;
}
