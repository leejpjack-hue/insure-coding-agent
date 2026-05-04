import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MemoryManager, MemoryCategory } from '../src/core/memory.js';

describe('MemoryManager', () => {
  let tmp: string;
  let mgr: MemoryManager;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'insure-memory-'));
    mgr = new MemoryManager(path.join(tmp, 'memory.json'));
  });

  after(() => {
    try { mgr.close(); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('adds a fact and retrieves it', () => {
    const fact = mgr.addFact('user_preference', 'Always use HKD for commissions', 'session:s1');
    assert.ok(fact.id.startsWith('fact_'));
    assert.equal(fact.category, 'user_preference');
    assert.equal(fact.content, 'Always use HKD for commissions');

    const facts = mgr.listFacts();
    assert.equal(facts.length, 1);
    assert.equal(facts[0].content, 'Always use HKD for commissions');
  });

  it('deduplicates identical facts', () => {
    mgr.addFact('user_preference', 'dedup test', 'session:s1');
    mgr.addFact('user_preference', 'dedup test', 'session:s2');
    const facts = mgr.listByCategory('user_preference');
    const match = facts.filter(f => f.content === 'dedup test');
    assert.equal(match.length, 1);
    assert.equal(match[0].access_count, 2);
  });

  it('queries facts by keyword', () => {
    mgr.addFact('project_fact', 'The database has 5 agent tables', 'session:s1');
    mgr.addFact('domain_knowledge', 'Commission rates vary by product type', 'session:s1');
    mgr.addFact('learned_pattern', 'Always validate input at API boundaries', 'session:s1');

    const results = mgr.queryFacts('commission');
    assert.ok(results.length >= 1);
    assert.ok(results.some(f => f.content.includes('commission') || f.content.includes('Commission')));
  });

  it('queries facts by category', () => {
    mgr.addFact('feedback', 'User likes terse responses', 'session:s1');
    const results = mgr.queryFacts(undefined, 'feedback');
    assert.ok(results.length >= 1);
    assert.ok(results.every(f => f.category === 'feedback'));
  });

  it('removes a fact by content match', () => {
    mgr.addFact('user_preference', 'remove me please', 'session:s1');
    const removed = mgr.removeFact('remove me please');
    assert.equal(removed, true);

    const facts = mgr.listFacts();
    assert.ok(!facts.some(f => f.content === 'remove me please'));
  });

  it('returns false when removing non-existent fact', () => {
    const removed = mgr.removeFact('does not exist at all');
    assert.equal(removed, false);
  });

  it('summarizes a session extracting patterns', () => {
    const messages = [
      { role: 'user', content: 'check my commission' },
      { role: 'assistant', content: 'The database has 5 agent tables and 9 commission tiers' },
      { role: 'assistant', content: 'I prefer to use JSON format for all responses' },
    ];
    mgr.summarizeSession(messages, 'session:summarize-test');
    const facts = mgr.listFacts();
    // Should have extracted some facts from the messages
    assert.ok(facts.length >= 1);
  });

  it('persists facts to disk', () => {
    const mgr2 = new MemoryManager(path.join(tmp, 'persist-test.json'));
    mgr2.addFact('project_fact', 'persist test', 'session:s1');
    mgr2.close();

    const mgr3 = new MemoryManager(path.join(tmp, 'persist-test.json'));
    const facts = mgr3.listFacts();
    assert.ok(facts.some(f => f.content === 'persist test'));
    mgr3.close();
  });

  it('builds memory context string for injection', () => {
    const ctx = mgr.buildMemoryContext('commission calculation');
    // Should contain a section header and at least one fact
    if (mgr.listFacts().length > 0) {
      assert.ok(ctx.includes('## Relevant Memory'));
    }
  });

  it('prunes facts when exceeding max limit', () => {
    const mgr4 = new MemoryManager(path.join(tmp, 'prune-test.json'));
    for (let i = 0; i < 210; i++) {
      mgr4.addFact('project_fact', `fact number ${i} about testing prune behavior`, 'session:s1');
    }
    const facts = mgr4.listFacts();
    assert.ok(facts.length <= 200, `Expected <= 200 facts, got ${facts.length}`);
    mgr4.close();
  });
});
