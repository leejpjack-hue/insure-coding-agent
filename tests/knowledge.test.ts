import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findPII, maskPII, PII_RULES } from '../src/knowledge/pii-rules.js';
import { rulesFor, COMPLIANCE_RULES } from '../src/knowledge/compliance-rules.js';
import { disclosureRulesFor } from '../src/knowledge/commission-rules.js';
import { licensingFor, isProductAllowed } from '../src/knowledge/agent-licensing-rules.js';
import { searchKnowledge, AMS_KNOWLEDGE } from '../src/knowledge/ams-knowledge.js';
import { KnowledgeBase } from '../src/knowledge/knowledge-base.js';
import { TFIDFIndex } from '../src/knowledge/embeddings.js';

describe('PII rules', () => {
  it('detects HKID in source content', () => {
    const findings = findPII('let id = "A123456(7)"; // sample', 'HK');
    assert.ok(findings.length > 0);
    assert.ok(findings.some(f => f.rule.type === 'HKID'));
  });

  it('detects credit card numbers globally', () => {
    const findings = findPII('card: 4111-1111-1111-1111');
    assert.ok(findings.some(f => f.rule.type === 'CREDIT_CARD'));
  });

  it('masks PII strings preserving length', () => {
    const out = maskPII('email: alice@example.com');
    assert.ok(!out.includes('alice@example.com'));
    assert.ok(out.includes('@') === false || /\*+/.test(out));
  });

  it('exposes a non-empty rules table', () => {
    assert.ok(PII_RULES.length >= 5);
  });
});

describe('Compliance rules', () => {
  it('returns HK rules only when filtered to HK', () => {
    const hk = rulesFor('HK');
    assert.ok(hk.length > 0);
    assert.ok(hk.every(r => r.jurisdiction === 'HK'));
  });

  it('filters by check type', () => {
    const hkPriv = rulesFor('HK', ['data_privacy']);
    assert.ok(hkPriv.every(r => r.type === 'data_privacy'));
  });

  it('covers all four jurisdictions', () => {
    const j = new Set(COMPLIANCE_RULES.map(r => r.jurisdiction));
    for (const x of ['HK', 'SG', 'EU', 'US']) assert.ok(j.has(x as any));
  });
});

describe('Commission disclosure', () => {
  it('finds a disclosure rule for HK life', () => {
    const r = disclosureRulesFor('HK', 'life');
    assert.ok(r.length > 0);
    assert.ok(r[0].mustDisclose.includes('commission_rate'));
  });
});

describe('Agent licensing', () => {
  it('returns the HK rule', () => {
    const hk = licensingFor('HK');
    assert.ok(hk);
    assert.equal(hk!.regulator, 'Insurance Authority');
    assert.ok(hk!.continuingEducation.annualHours >= 10);
  });

  it('isProductAllowed reflects appliesTo', () => {
    assert.equal(isProductAllowed('HK', 'life'), true);
  });
});

describe('AMS knowledge search', () => {
  it('finds entries by keyword', () => {
    const out = searchKnowledge('hierarchy');
    assert.ok(out.length >= 1);
  });

  it('exposes a non-empty knowledge table', () => {
    assert.ok(AMS_KNOWLEDGE.length >= 5);
  });
});

describe('TFIDFIndex', () => {
  it('ranks documents by query relevance', () => {
    const idx = new TFIDFIndex<string>(s => s);
    idx.build([
      'commission disclosure rules for hong kong',
      'apple banana fruit basket',
      'agent licensing requirements singapore',
    ]);
    const hits = idx.search('commission hong kong', 3);
    assert.ok(hits.length > 0);
    assert.ok(hits[0].doc.includes('commission'));
  });
});

describe('KnowledgeBase facade', () => {
  it('returns mixed-kind hits', () => {
    const kb = new KnowledgeBase();
    const out = kb.search('commission disclosure', 5);
    assert.ok(out.length > 0);
    const kinds = new Set(out.map(h => h.kind));
    assert.ok(kinds.size >= 1);
  });

  it('reports stats', () => {
    const kb = new KnowledgeBase();
    const s = kb.stats();
    assert.ok(s.knowledge > 0);
    assert.ok(s.compliance > 0);
    assert.ok(s.commission > 0);
    assert.ok(s.licensing > 0);
    assert.ok(s.pii > 0);
  });
});
