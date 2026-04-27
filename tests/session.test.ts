import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionManager } from '../src/core/session.js';
import { ModelConfig } from '../src/core/types.js';

const MODEL: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
};

describe('SessionManager', () => {
  let tmp: string;
  let mgr: SessionManager;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'insure-session-'));
    mgr = new SessionManager(path.join(tmp, 'sess.db'));
  });

  after(() => {
    try { mgr.close(); } catch { /* ignore */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('creates a session with a unique id', () => {
    const a = mgr.createSession('/tmp/projA', MODEL);
    const b = mgr.createSession('/tmp/projB', MODEL);
    assert.notEqual(a.id, b.id);
    assert.equal(a.status, 'active');
    assert.equal(a.projectRoot, '/tmp/projA');
  });

  it('lists sessions', () => {
    const list = mgr.listSessions();
    assert.ok(list.length >= 2);
    assert.ok(list.every(s => typeof s.id === 'string'));
  });

  it('retrieves a session by id', () => {
    const created = mgr.createSession('/tmp/projC', MODEL);
    const fetched = mgr.getSession(created.id);
    assert.ok(fetched);
    assert.equal(fetched!.projectRoot, '/tmp/projC');
  });

  it('returns null for unknown id', () => {
    const missing = mgr.getSession('does_not_exist');
    assert.equal(missing, null);
  });

  it('appends and reads back messages', () => {
    const s = mgr.createSession('/tmp/projD', MODEL);
    mgr.addMessage({
      sessionId: s.id,
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    });
    mgr.addMessage({
      sessionId: s.id,
      role: 'assistant',
      content: 'world',
      timestamp: Date.now() + 1,
    });
    const history = mgr.getHistory(s.id);
    assert.equal(history.length, 2);
    assert.equal(history[0].content, 'hello');
    assert.equal(history[1].content, 'world');
  });

  it('pauses and resumes a session', () => {
    const s = mgr.createSession('/tmp/projE', MODEL);
    assert.equal(mgr.pauseSession(s.id), true);
    assert.equal(mgr.getSession(s.id)!.status, 'paused');
    assert.equal(mgr.resumeSession(s.id), true);
    assert.equal(mgr.getSession(s.id)!.status, 'active');
  });

  it('forks a session into a new id with the same project root', () => {
    const s = mgr.createSession('/tmp/projF', MODEL);
    const forked = mgr.forkSession(s.id);
    assert.ok(forked);
    assert.notEqual(forked!.id, s.id);
    assert.equal(forked!.projectRoot, '/tmp/projF');
  });

  it('deletes a session and its messages', () => {
    const s = mgr.createSession('/tmp/projG', MODEL);
    mgr.addMessage({ sessionId: s.id, role: 'user', content: 'gone soon', timestamp: Date.now() });
    assert.equal(mgr.deleteSession(s.id), true);
    assert.equal(mgr.getSession(s.id), null);
    assert.equal(mgr.getHistory(s.id).length, 0);
  });
});
