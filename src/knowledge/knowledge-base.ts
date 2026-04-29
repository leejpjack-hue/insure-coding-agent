// Knowledge base façade — combines AMS knowledge, compliance rules, commission rules,
// licensing rules, PII rules and the insurance-systems landscape behind a single
// search interface.

import { AMS_KNOWLEDGE, KnowledgeEntry } from './ams-knowledge.js';
import { COMPLIANCE_RULES, ComplianceRuleDef } from './compliance-rules.js';
import { COMMISSION_DISCLOSURE_RULES, CommissionDisclosureRule } from './commission-rules.js';
import { LICENSING_RULES, LicensingRule } from './agent-licensing-rules.js';
import { PII_RULES, PIIRule } from './pii-rules.js';
import { INSURANCE_SYSTEMS, InsuranceSystemEntry } from './insurance-systems.js';
import { TFIDFIndex } from './embeddings.js';

export type KBHit =
  | { kind: 'knowledge'; entry: KnowledgeEntry; score: number }
  | { kind: 'compliance'; rule: ComplianceRuleDef; score: number }
  | { kind: 'commission'; rule: CommissionDisclosureRule; score: number }
  | { kind: 'licensing'; rule: LicensingRule; score: number }
  | { kind: 'pii'; rule: PIIRule; score: number }
  | { kind: 'system'; entry: InsuranceSystemEntry; score: number };

export class KnowledgeBase {
  private knowledgeIdx = new TFIDFIndex<KnowledgeEntry>(e => `${e.topic} ${e.tags.join(' ')} ${e.content}`);
  private complianceIdx = new TFIDFIndex<ComplianceRuleDef>(r => `${r.title} ${r.description} ${r.reference} ${r.recommendation}`);
  private commissionIdx = new TFIDFIndex<CommissionDisclosureRule>(r => `${r.reference} ${r.appliesTo.join(' ')} ${r.mustDisclose.join(' ')}`);
  private licensingIdx = new TFIDFIndex<LicensingRule>(r => `${r.regulator} ${r.reference} ${r.appliesTo.join(' ')} ${r.initialRequirements.examName}`);
  private piiIdx = new TFIDFIndex<PIIRule>(r => `${r.type} ${r.description} ${r.remediation} ${r.jurisdictions.join(' ')}`);
  private systemsIdx = new TFIDFIndex<InsuranceSystemEntry>(s =>
    `${s.name} ${s.aliases.join(' ')} ${s.category} ${s.summary} ` +
    `${s.responsibilities.join(' ')} ${s.ownedEntities.join(' ')} ` +
    `${s.integratesWith.join(' ')} ${s.complianceHotspots.join(' ')}`);

  constructor() {
    this.knowledgeIdx.build(AMS_KNOWLEDGE);
    this.complianceIdx.build(COMPLIANCE_RULES);
    this.commissionIdx.build(COMMISSION_DISCLOSURE_RULES);
    this.licensingIdx.build(LICENSING_RULES);
    this.piiIdx.build(PII_RULES);
    this.systemsIdx.build(INSURANCE_SYSTEMS);
  }

  search(query: string, topK: number = 5): KBHit[] {
    const hits: KBHit[] = [
      ...this.knowledgeIdx.search(query, topK).map(h => ({ kind: 'knowledge' as const, entry: h.doc, score: h.score })),
      ...this.complianceIdx.search(query, topK).map(h => ({ kind: 'compliance' as const, rule: h.doc, score: h.score })),
      ...this.commissionIdx.search(query, topK).map(h => ({ kind: 'commission' as const, rule: h.doc, score: h.score })),
      ...this.licensingIdx.search(query, topK).map(h => ({ kind: 'licensing' as const, rule: h.doc, score: h.score })),
      ...this.piiIdx.search(query, topK).map(h => ({ kind: 'pii' as const, rule: h.doc, score: h.score })),
      ...this.systemsIdx.search(query, topK).map(h => ({ kind: 'system' as const, entry: h.doc, score: h.score })),
    ];
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  stats(): { knowledge: number; compliance: number; commission: number; licensing: number; pii: number; systems: number } {
    return {
      knowledge: this.knowledgeIdx.size(),
      compliance: this.complianceIdx.size(),
      commission: this.commissionIdx.size(),
      licensing: this.licensingIdx.size(),
      pii: this.piiIdx.size(),
      systems: this.systemsIdx.size(),
    };
  }
}

let _kb: KnowledgeBase | null = null;
export function getKnowledgeBase(): KnowledgeBase {
  if (!_kb) _kb = new KnowledgeBase();
  return _kb;
}
