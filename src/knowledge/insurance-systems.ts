// Reference knowledge about the standard system landscape in a typical
// insurance carrier IT estate.
//
// Each entry describes one system: what it owns, who it serves, the data
// entities it is the source of truth for, what it integrates with, and the
// regulatory / compliance hot-spots a coding agent must keep in mind when
// touching it. Consumed by KnowledgeBase via TF-IDF retrieval.

export type SystemCriticality = 'tier-1' | 'tier-2' | 'tier-3';

export interface InsuranceSystemEntry {
  id: string;
  name: string;
  aliases: string[];
  category:
    | 'sales'
    | 'core_policy'
    | 'underwriting'
    | 'distribution'
    | 'customer'
    | 'finance'
    | 'data'
    | 'process'
    | 'compliance';
  criticality: SystemCriticality;
  /** One-paragraph summary used for retrieval ranking. */
  summary: string;
  /** What this system owns / is responsible for. */
  responsibilities: string[];
  /** Source-of-truth data entities. */
  ownedEntities: string[];
  /** Systems this one typically integrates with (by id). */
  integratesWith: string[];
  /** Common API / tech surface. */
  technicalSurface: string[];
  /** Regulatory / compliance hot-spots when modifying it. */
  complianceHotspots: string[];
  /** What a coding agent should be careful about. */
  agentNotes: string[];
}

export const INSURANCE_SYSTEMS: InsuranceSystemEntry[] = [
  // === SALES =====================================================
  {
    id: 'quotation_system',
    name: 'Quotation System',
    aliases: ['quote engine', 'illustration system', 'quote tool'],
    category: 'sales',
    criticality: 'tier-1',
    summary:
      'Computes premium, coverage and rider illustrations for prospects before policy submission. Drives the price the customer sees on the agency / customer / POS channels and feeds straight into the new-business pipeline.',
    responsibilities: [
      'Premium calculation per product, age, sum-assured, riders, smoking status',
      'Generation of quote PDFs and benefit illustrations (HK GL15-compliant for life)',
      'Validity windows and quote versioning (rate revisions, promotion codes)',
      'Cross-sell suggestions / rider bundling',
      'What-if simulations (ILAS investment performance, premium holiday)',
    ],
    ownedEntities: [
      'quote', 'quote_line', 'rate_table_snapshot', 'illustration_pdf', 'cross_sell_rule',
    ],
    integratesWith: [
      'agency_portal', 'customer_portal', 'pos', 'ams', 'underwriting_system', 'data_warehouse',
    ],
    technicalSurface: [
      'REST: POST /quote, GET /quote/:id, POST /quote/:id/illustrate',
      'Rate-table import job (nightly from actuarial)',
      'PDF rendering service (queued)',
    ],
    complianceHotspots: [
      'HK IA GL15 — illustration disclosure for life products',
      'EU IDD Art. 20 — IPID document for non-life',
      'Cooling-off period prominence (HK IA GL21 = 21 days)',
      'Commission disclosure when displayed alongside the quote (HK GL20)',
    ],
    agentNotes: [
      'Premium formula changes must round consistently with the AS400 booking engine — drift here causes financial reconciliation breaks downstream.',
      'Always version the rate-table snapshot ID on the quote — never recompute from "current" tables.',
      'Quotes are not policies: never write them to the policy of-record system.',
    ],
  },

  // === CORE POLICY ==============================================
  {
    id: 'as400_life',
    name: 'AS400 Life Admin (Policy of Record)',
    aliases: ['as400', 'iseries life', 'policy admin', 'lifeasia', 'ingenium', 'cyberlife'],
    category: 'core_policy',
    criticality: 'tier-1',
    summary:
      'IBM i (AS/400) batch-and-online life-policy administration platform. Authoritative system of record for in-force policies, premium billing, valuation, claims and policy-level financial movements. Most carriers run a packaged solution (LifeAsia, Ingenium, CyberLife) on top of DB2/400.',
    responsibilities: [
      'Policy issuance, endorsement, alteration, surrender, lapse, reinstatement',
      'Premium billing cycles (monthly/quarterly/annual) and dunning',
      'Bonus declaration, valuation extracts (IFRS 17, Solvency II)',
      'Commission accrual and clawback bookkeeping',
      'Claims registration and payment authorisation',
    ],
    ownedEntities: [
      'policy', 'policy_holder', 'beneficiary', 'premium_due', 'premium_paid',
      'policy_movement', 'commission_ledger', 'claim', 'reserve',
    ],
    integratesWith: [
      'data_warehouse', 'bpm', 'underwriting_system', 'payment_gateway',
      'ams', 'agency_portal', 'customer_portal',
    ],
    technicalSurface: [
      'DB2/400 tables accessed via SQL or RPG/COBOL programs',
      'Nightly batch (J0BSCDE), valuation extracts, commission run',
      'IBM MQ or file-drop for downstream feeds',
      'Modern integration via API gateway → CL programs / stored procs',
    ],
    complianceHotspots: [
      'IFRS 17 / Solvency II reserve and KPI extraction',
      'HK IA monthly statistical returns',
      'Policyholder PII (HKID, medical) — DB2 column-level encryption is rare; mask aggressively in any extract',
      'Audit trail: every policy movement must be reproducible via batch run logs',
    ],
    agentNotes: [
      'Never modify AS400 records from agent side without an approved change control. Read via reports / replicated DW.',
      'EBCDIC ↔ UTF-8: dates often stored as packed decimal CYYMMDD; double-check any extract.',
      'Batch windows (typically 22:00-04:00 local) are sacred — schedule reads outside.',
      'When asked to "fix the policy" the agent should propose a BPM workflow / endorsement, not a direct DB write.',
    ],
  },

  // === UNDERWRITING =============================================
  {
    id: 'underwriting_system',
    name: 'Underwriting System (UW Workbench)',
    aliases: ['uw system', 'auto uw', 'rules engine', 'medical underwriting'],
    category: 'underwriting',
    criticality: 'tier-1',
    summary:
      'Decides whether to accept a risk and on what terms. Combines rules-based auto-underwriting (Q&A pre-screening, BMI, occupation class) with case workflow for medical / large-sum reviews. Outputs a UW decision (standard / sub-standard / decline) that feeds back to quotation and policy issuance.',
    responsibilities: [
      'Auto-underwriting rules execution (Munich Re / Swiss Re rule books or in-house)',
      'Knock-out questions, evidence requirements, medical reflexive Q&A',
      'Case management: pending evidence (APS, PMAR, blood report)',
      'Loadings, exclusions, postpones, declines',
      'Reinsurance referral for over-retention cases',
    ],
    ownedEntities: [
      'uw_case', 'uw_decision', 'evidence_request', 'loading', 'exclusion',
      'reinsurance_referral', 'medical_disclosure',
    ],
    integratesWith: [
      'quotation_system', 'as400_life', 'bpm', 'agency_portal', 'customer_portal',
      'data_warehouse',
    ],
    technicalSurface: [
      'Rules engine (Drools / IBM ODM / SwissRe Magnum)',
      'Document upload / OCR for medical reports',
      'REST: POST /uw/case, GET /uw/case/:id, POST /uw/case/:id/decision',
    ],
    complianceHotspots: [
      'Genetic-information non-discrimination rules (where applicable)',
      'PHI / sensitive medical data — access logged, role-based',
      'Reinsurance treaty terms: must not breach retention limits',
      'Decision rationale must be traceable for complaint handling',
    ],
    agentNotes: [
      'Never silently change a rule threshold (e.g. BMI cutoff) — that re-rates an entire portfolio. Always require actuarial sign-off in PR.',
      'Evidence requirements drive customer experience — coordinate with portal/POS team before changing.',
      'PHI must never appear in logs; mask before persisting decision rationale.',
    ],
  },

  // === DISTRIBUTION =============================================
  {
    id: 'ams',
    name: 'Agency Management System (AMS)',
    aliases: ['agency mgmt', 'agent admin', 'compass', 'agency portal backend'],
    category: 'distribution',
    criticality: 'tier-1',
    summary:
      'Owns the agent and team dimension: registration, licensing, hierarchy, product authorisation, commission engine, performance KPIs. Backbone of the tied-agency channel and the focus of this codebase.',
    responsibilities: [
      'Agent profile, hierarchy (Agent → UM → BM → RD), team movement',
      'Licence lifecycle and CPD tracking',
      'Product authorisation matrix (who can sell what)',
      'Commission calculation, override, clawback, advance, finance booking',
      'Performance KPIs (APE, VNB, persistency 13M/25M)',
      'Customer assignment and portfolio transfer',
    ],
    ownedEntities: [
      'agent', 'agent_hierarchy', 'licence', 'cpd_record', 'product_auth',
      'commission_run', 'commission_line', 'override_chain', 'kpi_snapshot',
    ],
    integratesWith: [
      'agency_portal', 'pos', 'as400_life', 'underwriting_system',
      'payment_gateway', 'data_warehouse', 'bpm', 'aml_system',
    ],
    technicalSurface: [
      'REST API to portal/POS, SQL to DW, batch commission runs',
      'Hierarchy graph queries (recursive CTE or Neo4j)',
      'Event bus for licence-expiry alerts',
    ],
    complianceHotspots: [
      'HK IA Code of Conduct, GL20 commission disclosure, GL23 CPD',
      'SG MAS FAA-N13 representative requirements',
      'NAIC Producer Licensing Model Act (US)',
      'PII (HKID, addresses) under PDPO / PDPA / GDPR',
    ],
    agentNotes: [
      'Commission formula changes must produce an audit trail and pass a reconciliation against the previous run.',
      'Hierarchy moves are the #1 source of bugs — always test override-chain calculation across the move date.',
      'Licence expiry must trigger sales blocks in POS within 24 h of expiry.',
    ],
  },
  {
    id: 'agency_portal',
    name: 'Agency Portal',
    aliases: ['agent portal', 'tied agent web', 'broker portal'],
    category: 'distribution',
    criticality: 'tier-1',
    summary:
      'Web / mobile interface used by tied agents, brokers and unit managers to do their daily work: see book of business, run quotes, submit applications, track commission, manage team. Sits in front of AMS, quotation, AS400 and underwriting.',
    responsibilities: [
      'Book of business and renewal calendar',
      'New-business submission workflow with electronic signature',
      'Commission statements and clawback visibility',
      'Team dashboards (UM/BM views) — production, persistency, leaderboard',
      'Training and licence-renewal reminders',
      'Document repository (forms, brochures, regulatory updates)',
    ],
    ownedEntities: [
      'session', 'submission_draft', 'esign_envelope', 'agent_message', 'agent_doc',
    ],
    integratesWith: [
      'ams', 'quotation_system', 'underwriting_system', 'as400_life',
      'customer_portal', 'pos', 'aml_system', 'payment_gateway',
    ],
    technicalSurface: [
      'SPA (React / Angular / Flutter Web) + BFF',
      'Single sign-on with the carrier IDP',
      'Mobile app (iOS/Android) with biometric login',
    ],
    complianceHotspots: [
      'Strong customer authentication (HK Banking Ordinance / HKMA / SFC where applicable)',
      'Commission disclosure visible before policy submission (HK IA GL20)',
      'PDPO consent capture for any new customer data field',
    ],
    agentNotes: [
      'Submission drafts contain PII — encrypt at rest and TTL them after submission.',
      'Latency-sensitive: any quote call > 3 s harms conversion. Cache rate-table reads at the edge.',
      'Mobile and web must stay in feature parity per regulator visibility expectations.',
    ],
  },
  {
    id: 'pos',
    name: 'Point of Sales (POS)',
    aliases: ['e-application', 'mobile pos', 'tablet pos', 'iPoint of Sale'],
    category: 'sales',
    criticality: 'tier-1',
    summary:
      'Tablet / kiosk / branch counter application that an agent uses face-to-face with a prospect. Captures FNA (financial needs analysis), illustration, application, signature, payment, KYC/AML — end-to-end in one sitting. Often offline-capable and synchronises later.',
    responsibilities: [
      'Financial Needs Analysis questionnaire (HK GL30 / SG MAS FAA-N16)',
      'Quotation with full benefit illustration',
      'Customer onboarding (HKID/passport scan, OCR, liveness)',
      'AML/CDD screening and risk classification',
      'eSignature capture and policy submission',
      'First-premium collection (PG initiation)',
    ],
    ownedEntities: [
      'fna_record', 'application', 'kyc_evidence', 'esignature', 'payment_intent',
    ],
    integratesWith: [
      'quotation_system', 'underwriting_system', 'aml_system',
      'payment_gateway', 'agency_portal', 'as400_life',
    ],
    technicalSurface: [
      'Native iPad / Android app + offline store (SQLite/IndexedDB)',
      'Sync engine (conflict-free replicated data types or last-writer-wins with audit)',
      'Camera SDK for ID OCR and liveness',
    ],
    complianceHotspots: [
      'HK IA GL30 — needs analysis must be done before recommendation',
      'SG MAS FAA-N16 — FNA / RMS for accredited / retail investors',
      'eSignature legal validity (HK ETO Cap 553 / EU eIDAS)',
      'Offline data: device must be remote-wipeable; PII encrypted with hardware-backed key',
    ],
    agentNotes: [
      'Never let an offline submission bypass AML — queue it, but do not finalise the policy until AML clears.',
      'FNA outputs feed the suitability evidence — never alter retroactively.',
      'Signature artefacts must be cryptographically bound to the application snapshot (hash, not just attached).',
    ],
  },
  {
    id: 'customer_portal',
    name: 'Customer Portal',
    aliases: ['policyholder portal', 'self-service portal', 'mycarrier app'],
    category: 'customer',
    criticality: 'tier-2',
    summary:
      'Web / mobile self-service for the policyholder: view policies, pay premiums, file claims, change beneficiaries, contact agent, get e-statements. Also the channel for direct (no-agent) sales of simple products.',
    responsibilities: [
      'Authentication (password, OTP, biometric, FIDO2)',
      'Policy summary, premium-due calendar, e-statement download',
      'Self-service endorsements (address, beneficiary, mode of payment)',
      'Online claims initiation with document upload',
      'Direct purchase of simple products (term, travel, motor)',
      'Customer support chat / agent contact',
    ],
    ownedEntities: [
      'customer_account', 'session', 'service_request', 'claim_intake', 'consent_log',
    ],
    integratesWith: [
      'as400_life', 'underwriting_system', 'payment_gateway',
      'aml_system', 'agency_portal', 'data_warehouse',
    ],
    technicalSurface: [
      'SPA + BFF, mobile native, push notifications',
      'IDP federation (carrier IDP, Apple/Google sign-in for guests)',
      'Document upload with virus scan',
    ],
    complianceHotspots: [
      'PDPO Schedule 1 DPP-1 to DPP-6 (purpose, accuracy, security, access)',
      'Strong customer authentication (PSD2 SCA in EU)',
      'Cookie consent / tracking consent (GDPR)',
      'Vulnerable customer accommodations (HK IA GL31)',
    ],
    agentNotes: [
      'Any self-service endorsement must be reflected back to AS400 within SLA — never leave portal-only state.',
      'Beneficiary changes are the #1 fraud target: always require step-up authentication.',
      'Direct-sales journeys still need licence/authorisation checks behind the scenes.',
    ],
  },

  // === FINANCE ==================================================
  {
    id: 'payment_gateway',
    name: 'Payment Gateway',
    aliases: ['pg', 'payment service', 'collection engine'],
    category: 'finance',
    criticality: 'tier-1',
    summary:
      'Initiates and reconciles money movements: first premium, recurring premium, claim payouts, commission payouts, refunds. Sits between distribution / customer-facing systems and the bank rails (autopay/DDA, Fast Payment, card, e-wallet, SWIFT).',
    responsibilities: [
      'Tokenisation of card / bank account details (PCI scope minimisation)',
      'One-off and recurring collection (DDA / SEPA / FPS)',
      'Refund and chargeback handling',
      'Outbound disbursement (claim, commission, surrender)',
      'Reconciliation against bank statements (T+1 / intraday)',
      '3-D Secure / SCA orchestration',
    ],
    ownedEntities: [
      'payment_token', 'payment_intent', 'transaction', 'refund', 'mandate',
      'reconciliation_record', 'fx_quote',
    ],
    integratesWith: [
      'pos', 'customer_portal', 'agency_portal', 'as400_life',
      'ams', 'data_warehouse', 'aml_system',
    ],
    technicalSurface: [
      'Bank API (FPS Hong Kong, FAST Singapore, SEPA, ACH)',
      'Card acquirer APIs (Stripe, Adyen, in-house)',
      'Webhooks for asynchronous status updates',
    ],
    complianceHotspots: [
      'PCI DSS 4.0 — never log full PAN; tokenise',
      'PSD2 / SCA in EU; 3-D Secure 2 globally',
      'AML transaction monitoring and STR/SAR triggers',
      'Sanctions screening on counterparties (OFAC, UN)',
    ],
    agentNotes: [
      'Idempotency-Key header on every collection request — duplicate charges are the #1 customer complaint.',
      'Webhook handlers must be idempotent and verify signature before processing.',
      'Reconciliation is the source of truth for what was actually paid; never trust the gateway "success" alone.',
    ],
  },

  // === DATA / PROCESS / COMPLIANCE ==============================
  {
    id: 'data_warehouse',
    name: 'Data Warehouse',
    aliases: ['dw', 'edw', 'data lakehouse', 'snowflake', 'bigquery'],
    category: 'data',
    criticality: 'tier-2',
    summary:
      'Consolidates extracts from all transactional systems (AS400, AMS, UW, portals, PG) into a query-friendly star/snowflake schema or lakehouse. Powers BI dashboards, regulatory reporting, actuarial valuation feeds and ML feature stores.',
    responsibilities: [
      'Nightly / micro-batch ETL from source systems',
      'Conformed dimensions (customer, agent, product, time)',
      'Fact tables (premium, claim, commission, valuation, KPI)',
      'Slowly-changing dimensions (Type 2 for agent hierarchy)',
      'Regulatory reporting marts (IFRS 17, Solvency II)',
      'Self-service BI and feature store for ML',
    ],
    ownedEntities: [
      'dim_customer', 'dim_agent', 'dim_product', 'dim_date',
      'fact_premium', 'fact_commission', 'fact_claim', 'fact_kpi_snapshot',
    ],
    integratesWith: [
      'as400_life', 'ams', 'underwriting_system', 'agency_portal',
      'customer_portal', 'payment_gateway', 'aml_system', 'bpm',
    ],
    technicalSurface: [
      'ELT tooling (dbt, Fivetran, Informatica)',
      'Storage (Snowflake / BigQuery / Databricks)',
      'BI (Tableau, Power BI, Looker)',
    ],
    complianceHotspots: [
      'PII minimisation in DW — tokenise HKID/SSN at ingestion',
      'Right-to-be-forgotten propagation (GDPR Art. 17)',
      'Retention policy: most carriers keep policy data 7-10 years post-termination',
      'Row-level access for sensitive dimensions (medical, claims)',
    ],
    agentNotes: [
      'DW is read-only for the agent — never propose a DW write that should have happened upstream.',
      'Schema changes need a backfill plan; downstream BI breaks silently otherwise.',
      'Use the DW (not AS400) for analytics — it is what valuation and regulatory teams actually consume.',
    ],
  },
  {
    id: 'bpm',
    name: 'Business Process Management (BPM)',
    aliases: ['workflow', 'case management', 'pega', 'camunda', 'appian'],
    category: 'process',
    criticality: 'tier-2',
    summary:
      'Orchestrates long-running, human-in-the-loop processes that span multiple core systems: new-business case, claims handling, complaint resolution, endorsement requests, AML escalation. Stores task state and SLAs.',
    responsibilities: [
      'Process definitions (BPMN 2.0) and human task inboxes',
      'SLA tracking and escalation paths',
      'Document attachment lifecycle inside a case',
      'Cross-system orchestration via service tasks',
      'Audit trail of every step for regulator inspection',
    ],
    ownedEntities: [
      'process_instance', 'task', 'case_document', 'sla_breach', 'audit_step',
    ],
    integratesWith: [
      'underwriting_system', 'as400_life', 'aml_system',
      'agency_portal', 'customer_portal', 'data_warehouse',
    ],
    technicalSurface: [
      'BPMN engine (Camunda, Pega, Appian, IBM BAW)',
      'REST + JMS / Kafka for service tasks',
      'Forms engine for human tasks',
    ],
    complianceHotspots: [
      'Complaint handling SLA (HK IA: acknowledge in 7 days, resolve in 60)',
      'Claims fair-treatment metrics (TAT, denial rate)',
      'Audit trail completeness — every state change must be replayable',
    ],
    agentNotes: [
      'Process changes need version-aware deployment — running cases keep the old BPMN version.',
      'Avoid "skip to end" admin actions; they break SLA reporting.',
      'Long-running processes can outlive the deploying agent\'s session — design for resumption.',
    ],
  },
  {
    id: 'aml_system',
    name: 'AML / KYC / Sanctions Screening System',
    aliases: ['aml', 'kyc', 'sanctions', 'cdd', 'pep screening', 'fircosoft', 'lexisnexis'],
    category: 'compliance',
    criticality: 'tier-1',
    summary:
      'Screens customers, beneficiaries and counterparties against sanctions, PEP and adverse-media lists. Performs Customer Due Diligence (CDD) at onboarding, ongoing monitoring of policies and money flows, and produces Suspicious Transaction Reports (STR/SAR) when triggered.',
    responsibilities: [
      'Onboarding screening: name match against OFAC, UN, HKMA, JFIU lists',
      'PEP (Politically Exposed Person) and adverse-media flagging',
      'Risk classification (low / medium / high) driving CDD level',
      'Ongoing transaction monitoring and behaviour rules',
      'STR / SAR case workflow and regulator filing',
      'Periodic re-screening (typically nightly or on list update)',
    ],
    ownedEntities: [
      'screening_request', 'screening_match', 'risk_rating', 'cdd_evidence',
      'str_case', 'monitoring_alert',
    ],
    integratesWith: [
      'pos', 'customer_portal', 'agency_portal', 'as400_life',
      'payment_gateway', 'bpm', 'data_warehouse',
    ],
    technicalSurface: [
      'Vendor screening API (Fircosoft, LexisNexis, Dow Jones Risk)',
      'In-house rules engine on transaction stream (Kafka)',
      'Case-management UI for compliance officers',
    ],
    complianceHotspots: [
      'HK AMLO (Cap 615) — CDD, record-keeping, STR to JFIU',
      'EU 6AMLD; US BSA/FinCEN',
      'Sanctions: OFAC, UN, EU, HKMA — must screen on each list update',
      'False-positive handling SLAs — must not block legitimate customer beyond regulator-allowed time',
    ],
    agentNotes: [
      'Never auto-clear a sanctions match programmatically — always requires a human compliance officer sign-off.',
      'Rule changes that loosen screening must go through compliance approval, never just code review.',
      'Test data must use synthetic names; using real names (even in tests) can trigger an audit finding.',
    ],
  },
];

export function searchInsuranceSystems(query: string): InsuranceSystemEntry[] {
  const q = query.toLowerCase();
  return INSURANCE_SYSTEMS.filter(s =>
    s.id.includes(q) ||
    s.name.toLowerCase().includes(q) ||
    s.aliases.some(a => a.toLowerCase().includes(q)) ||
    s.summary.toLowerCase().includes(q) ||
    s.responsibilities.some(r => r.toLowerCase().includes(q)) ||
    s.ownedEntities.some(e => e.toLowerCase().includes(q)),
  );
}

export function getSystem(id: string): InsuranceSystemEntry | undefined {
  return INSURANCE_SYSTEMS.find(s => s.id === id);
}
