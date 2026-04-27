// AMS domain knowledge — structured facts the agent can pull into context.

export interface KnowledgeEntry {
  id: string;
  topic: string;
  tags: string[];
  content: string;
}

export const AMS_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'team_hierarchy',
    topic: 'Team hierarchy',
    tags: ['hierarchy', 'override', 'team'],
    content: `Standard AMS hierarchy:
Agent → Unit Manager (UM) → Branch Manager (BM) → Regional Director (RD).
Override commission flows up the chain. Typical overrides: UM 3-5%, BM 1.5-3%, RD 0.5-1.5%.
Override only paid when the upline meets persistency and minimum production criteria.`,
  },
  {
    id: 'product_taxonomy',
    topic: 'Product taxonomy',
    tags: ['product', 'classification'],
    content: `Major product categories:
- Life (term, whole, universal, ILAS, endowment)
- Health (medical, critical illness, hospital cash)
- Property (HOC, fire)
- Motor (private, commercial)
- Travel (annual multi-trip, single-trip)
- Group Life / Group Health (employee benefits)`,
  },
  {
    id: 'commission_lifecycle',
    topic: 'Commission lifecycle',
    tags: ['commission', 'lifecycle', 'finance'],
    content: `Lifecycle: earned → accrued → clawback window → released → paid.
Clawback rules: typically full clawback if policy lapses within year 1, partial in year 2.
Premium financing policies: stricter clawback windows.`,
  },
  {
    id: 'license_lifecycle',
    topic: 'License lifecycle',
    tags: ['license', 'lifecycle', 'compliance'],
    content: `States: pending_approval → active → pending_renewal → expired/suspended.
HK: 3-year cycle, 15 CPD hours/year (3 must be ethics).
SG: 1-year cycle, 30 CPD hours/year.
US: typically 2-year cycle, 24 CE hours.`,
  },
  {
    id: 'pii_definitions',
    topic: 'PII categories',
    tags: ['pii', 'privacy'],
    content: `Insurance-sensitive PII categories:
- Identity: HKID, NRIC, SSN, passport
- Financial: bank account, credit card, premium amount
- Health: medical history, claim records (PHI)
- Policy: policy number, coverage, beneficiaries
PHI requires extra protection (HK PDPO Schedule 1, US HIPAA, EU special category).`,
  },
  {
    id: 'kpi_metrics',
    topic: 'Performance KPIs',
    tags: ['kpi', 'performance', 'metrics'],
    content: `Common AMS KPIs:
- APE (Annualized Premium Equivalent)
- VNB (Value of New Business)
- Persistency 13M / 25M (% of policies in force after 13/25 months)
- Conversion rate (lead → sale)
- Average policy size
- Commission per agent / per FTE`,
  },
  {
    id: 'audit_trail',
    topic: 'Audit trail requirements',
    tags: ['audit', 'compliance', 'reporting'],
    content: `All commission formula changes, license overrides, and customer reassignments must
be recorded with: actor, timestamp, before/after value, reason, approver.
Records retained 7 years (HK), 5 years (SG), 6 years (UK), 10 years (US life).`,
  },
];

export function searchKnowledge(query: string): KnowledgeEntry[] {
  const q = query.toLowerCase();
  return AMS_KNOWLEDGE.filter(
    e =>
      e.topic.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.tags.some(t => t.toLowerCase().includes(q))
  );
}
