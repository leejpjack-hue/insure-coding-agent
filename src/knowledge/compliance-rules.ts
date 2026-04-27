// Structured compliance rules database.
// References regulations in HK, SG, EU, US for AMS-relevant checks.

import { ComplianceCheckType, Jurisdiction, ViolationSeverity } from '../core/types.js';

export interface ComplianceRuleDef {
  id: string;
  type: ComplianceCheckType;
  jurisdiction: Jurisdiction;
  reference: string;
  title: string;
  description: string;
  severity: ViolationSeverity;
  triggers: string[];        // substrings/keywords that indicate the rule may apply
  forbidsAll?: string[];     // if all of these substrings present, violation
  requiresAny?: string[];    // if rule applies, at least one of these must be present
  recommendation: string;
}

export const COMPLIANCE_RULES: ComplianceRuleDef[] = [
  // ===== HK =====
  {
    id: 'HK-PDPO-DPP1',
    type: 'data_privacy',
    jurisdiction: 'HK',
    reference: 'PDPO Schedule 1, DPP 1',
    title: 'Purpose and manner of collection of personal data',
    description: 'Personal data must be collected lawfully and only for a purpose directly related to the data user’s function.',
    severity: 'critical',
    triggers: ['hkid', 'identityCard', 'id_card'],
    requiresAny: ['consent', 'purpose', 'pics'],
    recommendation: 'Show a Personal Information Collection Statement (PICS) before any HKID is collected.',
  },
  {
    id: 'HK-IA-GL20',
    type: 'commission_disclosure',
    jurisdiction: 'HK',
    reference: 'IA GL20',
    title: 'Disclosure of remuneration in long-term insurance',
    description: 'Insurance intermediaries must disclose commission and remuneration arrangements.',
    severity: 'warning',
    triggers: ['commission', 'remuneration'],
    requiresAny: ['disclosure', 'disclose', 'discloseRate'],
    recommendation: 'Display commission disclosure to the customer prior to policy purchase.',
  },
  {
    id: 'HK-IA-GL21',
    type: 'consumer_protection',
    jurisdiction: 'HK',
    reference: 'IA GL21',
    title: 'Cooling-off period and fair treatment',
    description: 'Long-term policies require a cooling-off period of at least 21 days.',
    severity: 'warning',
    triggers: ['premium', 'policySale', 'issuePolicy'],
    requiresAny: ['cooling', 'coolingOff', 'cool_off', 'cancellationWindow'],
    recommendation: 'Implement a 21-day cooling-off window for long-term policies.',
  },
  {
    id: 'HK-IO-Cap41-S64',
    type: 'agent_licensing',
    jurisdiction: 'HK',
    reference: 'Insurance Ordinance Cap 41, s.64',
    title: 'Licensed insurance intermediaries',
    description: 'Only licensed intermediaries may carry on regulated activity.',
    severity: 'critical',
    triggers: ['sellProduct', 'sell_product', 'newPolicy'],
    requiresAny: ['license', 'licence', 'authorized', 'isLicensed'],
    recommendation: 'Validate the agent’s licence status and product authorisation before allowing the action.',
  },

  // ===== SG =====
  {
    id: 'SG-PDPA-CONSENT',
    type: 'data_privacy',
    jurisdiction: 'SG',
    reference: 'PDPA s.13',
    title: 'Consent obligation',
    description: 'Consent must be obtained before collection, use or disclosure of personal data.',
    severity: 'critical',
    triggers: ['nric', 'NRIC', 'singpass'],
    requiresAny: ['consent', 'optIn'],
    recommendation: 'Capture explicit opt-in consent and log consent receipt.',
  },
  {
    id: 'SG-MAS-FAA',
    type: 'commission_disclosure',
    jurisdiction: 'SG',
    reference: 'MAS Notice FAA-N03',
    title: 'Disclosure requirements for representatives',
    description: 'Financial advisers must disclose remuneration on recommendation.',
    severity: 'warning',
    triggers: ['commission', 'recommend'],
    requiresAny: ['disclosure', 'disclose'],
    recommendation: 'Add remuneration disclosure section to recommendation output.',
  },

  // ===== EU =====
  {
    id: 'EU-GDPR-ART6',
    type: 'data_privacy',
    jurisdiction: 'EU',
    reference: 'GDPR Article 6',
    title: 'Lawfulness of processing',
    description: 'Processing requires a lawful basis (consent, contract, legitimate interest, etc.).',
    severity: 'critical',
    triggers: ['process', 'store'],
    forbidsAll: ['localStorage', 'personal'],
    recommendation: 'Add a consent banner and minimise data stored client-side.',
  },
  {
    id: 'EU-IDD-DISCLOSURE',
    type: 'commission_disclosure',
    jurisdiction: 'EU',
    reference: 'IDD Article 19',
    title: 'Insurance Distribution Directive — disclosure',
    description: 'The nature and basis of remuneration must be disclosed to the customer.',
    severity: 'warning',
    triggers: ['commission'],
    requiresAny: ['disclosure', 'disclose'],
    recommendation: 'Surface IDD-compliant disclosure on quote and policy schedule.',
  },

  // ===== US =====
  {
    id: 'US-NAIC-PRODUCER',
    type: 'agent_licensing',
    jurisdiction: 'US',
    reference: 'NAIC Producer Licensing Model Act',
    title: 'Producer licensing',
    description: 'Producers must hold a valid licence in the state in which they transact insurance.',
    severity: 'critical',
    triggers: ['sellProduct'],
    requiresAny: ['license', 'licence', 'stateLicense'],
    recommendation: 'Check producer licence per state before allowing transactions.',
  },
];

export function rulesFor(jurisdiction: Jurisdiction, types?: ComplianceCheckType[]): ComplianceRuleDef[] {
  return COMPLIANCE_RULES.filter(r =>
    r.jurisdiction === jurisdiction && (!types || types.includes(r.type))
  );
}
