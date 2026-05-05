import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server/index.js';
import { loadConfig } from '../src/core/config.js';
import http from 'http';

async function fetchJSON(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const options = {
    hostname: '127.0.0.1',
    port: 17008,
    path,
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode || 0, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('API Endpoints', () => {
  let server: http.Server;
  let closeOrchestrator: () => void;

  before(async () => {
    const config = loadConfig({ port: 17008, host: '127.0.0.1', dbPath: ':memory:' } as Partial<InsureAgentConfig>);
    const { app, orchestrator } = createServer(config);
    closeOrchestrator = () => orchestrator.close();
    server = app.listen(17008);
    await new Promise<void>(resolve => server.on('listening', resolve));
  });

  after(() => {
    server.close();
    closeOrchestrator();
  });

  it('GET /api/health should return ok', async () => {
    const { status, data } = await fetchJSON('GET', '/api/health');
    assert.equal(status, 200);
    const d = data as Record<string, unknown>;
    assert.equal(d.status, 'ok');
    assert.equal(d.version, '0.1.0');
  });

  it('GET /api/tools should list all registered tools', async () => {
    const { status, data } = await fetchJSON('GET', '/api/tools');
    assert.equal(status, 200);
    const tools = data as Array<{ name: string }>;
    assert.ok(tools.length >= 10, `Expected at least 10 tools, got ${tools.length}`);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('file_read'));
    assert.ok(names.includes('commission_validator'));
    assert.ok(names.includes('license_checker'));
    assert.ok(names.includes('compliance_checker'));
    assert.ok(names.includes('requirement_gap_analyzer'));
  });

  it('POST /api/tools/commission_validator should calculate', async () => {
    const { status, data } = await fetchJSON('POST', '/api/tools/commission_validator', {
      action: 'calculate', agentLevel: 'gold', productType: 'life',
      premiumAmount: 100000, policyYear: 1, isRenewal: false,
    });
    assert.equal(status, 200);
    const d = data as Record<string, unknown>;
    assert.equal(d.tool, 'commission_validator');
    const result = JSON.parse(d.result as string);
    assert.equal(result.commission, 50000);
  });

  it('POST /api/tools/license_checker should check status', async () => {
    const { status, data } = await fetchJSON('POST', '/api/tools/license_checker', {
      action: 'check_status', agentId: 'AGT001',
    });
    assert.equal(status, 200);
    const d = data as Record<string, unknown>;
    const result = JSON.parse(d.result as string);
    assert.equal(result.status, 'active');
  });

  it('POST /api/tools/compliance_checker should detect PII', async () => {
    const { status, data } = await fetchJSON('POST', '/api/tools/compliance_checker', {
      content: 'const id = "A123456B";', filePath: 'test.ts', jurisdiction: 'HK',
    });
    assert.equal(status, 200);
    const d = data as Record<string, unknown>;
    const result = JSON.parse(d.result as string);
    assert.equal(result.passed, false);
    assert.ok(result.violations.length > 0);
  });

  it('POST /api/tools/:name should 404 for unknown tool', async () => {
    const { status } = await fetchJSON('POST', '/api/tools/nonexistent', {});
    assert.equal(status, 404);
  });

  it('POST /api/sessions should create session', async () => {
    const { status, data } = await fetchJSON('POST', '/api/sessions', { projectRoot: '/tmp' });
    assert.equal(status, 200);
    const d = data as Record<string, unknown>;
    assert.ok(d.id);
    assert.equal(d.status, 'active');
  });

  it('GET /api/sessions should list sessions', async () => {
    const { status, data } = await fetchJSON('GET', '/api/sessions');
    assert.equal(status, 200);
    const sessions = data as Array<unknown>;
    assert.ok(sessions.length >= 1);
  });

  it('GET /api/hooks should list hooks', async () => {
    const { status, data } = await fetchJSON('GET', '/api/hooks');
    assert.equal(status, 200);
    const hooks = data as Array<{ name: string }>;
    assert.ok(hooks.length >= 5);
  });
});
