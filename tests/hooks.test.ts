import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HookEngine } from '../src/hooks/hook-engine.js';
import { eventBus } from '../src/core/events.js';
import { Event } from '../src/core/types.js';

describe('HookEngine', () => {
  let engine: HookEngine;

  beforeEach(() => {
    engine = new HookEngine();
  });

  it('registers and lists hooks', () => {
    engine.register({
      name: 'h1',
      description: 'first',
      triggerEvent: 'tool_executed',
      enabled: true,
      action: async () => { /* noop */ },
    });
    const list = engine.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'h1');
    assert.equal(list[0].enabled, true);
  });

  it('runs the action when the matching event is emitted', async () => {
    let fired = 0;
    engine.register({
      name: 'count',
      description: 'count tool calls',
      triggerEvent: 'tool_executed',
      enabled: true,
      action: async () => { fired++; },
    });

    eventBus.emit({
      type: 'tool_executed',
      tool: 'file_read',
      result: { callId: 'c1', status: 'success', content: 'ok', duration: 1 },
    });
    // hook actions are async; let microtasks flush
    await new Promise(r => setImmediate(r));

    assert.equal(fired, 1);
  });

  it('respects the filter predicate', async () => {
    let fired = 0;
    engine.register({
      name: 'only_commission',
      description: 'only commission files',
      triggerEvent: 'file_changed',
      enabled: true,
      filter: (e: Event) => e.type === 'file_changed' && e.path.includes('commission'),
      action: async () => { fired++; },
    });

    eventBus.emit({ type: 'file_changed', path: 'src/foo.ts', content: 'x' });
    eventBus.emit({ type: 'file_changed', path: 'src/services/commission.ts', content: 'x' });
    await new Promise(r => setImmediate(r));

    assert.equal(fired, 1);
  });

  it('disable() prevents the action from firing', async () => {
    let fired = 0;
    engine.register({
      name: 'ck',
      description: 'checkpoint',
      triggerEvent: 'checkpoint_created',
      enabled: true,
      action: async () => { fired++; },
    });
    engine.disable('ck');

    eventBus.emit({ type: 'checkpoint_created', id: 'c1', sessionId: 's1' });
    await new Promise(r => setImmediate(r));
    assert.equal(fired, 0);

    engine.enable('ck');
    eventBus.emit({ type: 'checkpoint_created', id: 'c2', sessionId: 's1' });
    await new Promise(r => setImmediate(r));
    assert.equal(fired, 1);
  });

  it('unregister() removes the hook', () => {
    engine.register({
      name: 'tmp',
      description: 'temp',
      triggerEvent: 'tool_executed',
      enabled: true,
      action: async () => { /* noop */ },
    });
    assert.equal(engine.list().length, 1);
    const removed = engine.unregister('tmp');
    assert.equal(removed, true);
    assert.equal(engine.list().length, 0);
  });
});
