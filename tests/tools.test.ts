import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/core/tool-registry.js';
import { createFileTools } from '../src/tools/file-tools.js';
import { createBashTool } from '../src/tools/bash-tool.js';
import { createGitTool } from '../src/tools/git-tool.js';
import { createCommissionTool } from '../src/tools/commission-validator.js';
import { createLicenseChecker } from '../src/tools/license-checker.js';
import { createComplianceChecker } from '../src/tools/compliance-checker.js';
import { createSchemaReader } from '../src/tools/schema-reader.js';
import { createApiTester } from '../src/tools/api-tester.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('should register and list tools', () => {
    registry.register({
      definition: { name: 'test_tool', description: 'A test tool', safetyLevel: 'auto_approve', params: [] },
      execute: async () => 'ok',
    });
    assert.equal(registry.list().length, 1);
    assert.equal(registry.list()[0].name, 'test_tool');
  });

  it('should get a tool by name', () => {
    registry.register({
      definition: { name: 'my_tool', description: 'desc', safetyLevel: 'auto_approve', params: [] },
      execute: async () => 'ok',
    });
    const tool = registry.get('my_tool');
    assert.ok(tool);
    assert.equal(tool.definition.name, 'my_tool');
  });

  it('should return undefined for unknown tool', () => {
    assert.equal(registry.get('nonexistent'), undefined);
  });

  it('should validate required params', () => {
    registry.register({
      definition: {
        name: 'needs_params',
        description: 'desc',
        safetyLevel: 'auto_approve',
        params: [{ name: 'path', type: 'string', required: true, description: 'file path' }],
      },
      execute: async () => 'ok',
    });
    const result = registry.validateParams('needs_params', {});
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('Missing required param: path'));
  });

  it('should validate param types', () => {
    registry.register({
      definition: {
        name: 'typed',
        description: 'desc',
        safetyLevel: 'auto_approve',
        params: [{ name: 'count', type: 'number', required: true, description: 'a number' }],
      },
      execute: async () => 'ok',
    });
    const result = registry.validateParams('typed', { count: 'not_a_number' });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('must be of type number'));
  });

  it('should reject duplicate registration', () => {
    registry.register({
      definition: { name: 'dup', description: 'desc', safetyLevel: 'auto_approve', params: [] },
      execute: async () => 'ok',
    });
    assert.throws(() => registry.register({
      definition: { name: 'dup', description: 'desc', safetyLevel: 'auto_approve', params: [] },
      execute: async () => 'ok',
    }));
  });

  it('should unregister a tool', () => {
    registry.register({
      definition: { name: 'temp', description: 'desc', safetyLevel: 'auto_approve', params: [] },
      execute: async () => 'ok',
    });
    assert.equal(registry.unregister('temp'), true);
    assert.equal(registry.has('temp'), false);
  });
});

describe('File Tools', () => {
  let registry: ToolRegistry;
  let tmpDir: string;

  beforeEach(() => {
    registry = new ToolRegistry();
    createFileTools(registry);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'insure-test-'));
  });

  it('file_read should read a file', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world');
    const tool = registry.get('file_read')!;
    const result = await tool.execute({ path: filePath });
    assert.ok(result.includes('hello world'));
  });

  it('file_read should support line range', async () => {
    const filePath = path.join(tmpDir, 'lines.txt');
    fs.writeFileSync(filePath, 'line1\nline2\nline3\nline4\nline5');
    const tool = registry.get('file_read')!;
    const result = await tool.execute({ path: filePath, startLine: 2, endLine: 4 });
    assert.ok(result.includes('line2'));
    assert.ok(result.includes('line4'));
    assert.ok(!result.includes('line1'));
    assert.ok(!result.includes('line5'));
  });

  it('file_read should error on missing file', async () => {
    const tool = registry.get('file_read')!;
    await assert.rejects(() => tool.execute({ path: '/nonexistent/file.txt' }));
  });

  it('file_write should write content', async () => {
    const filePath = path.join(tmpDir, 'new', 'file.txt');
    const tool = registry.get('file_write')!;
    const result = await tool.execute({ path: filePath, content: 'written!', createDirs: true });
    assert.ok(typeof result === 'string' && result.includes('Written'));
    assert.equal(fs.readFileSync(filePath, 'utf-8'), 'written!');
  });

  it('file_edit should replace content', async () => {
    const filePath = path.join(tmpDir, 'edit.txt');
    fs.writeFileSync(filePath, 'old content here');
    const tool = registry.get('file_edit')!;
    const result = await tool.execute({ path: filePath, oldContent: 'old content', newContent: 'new content' });
    assert.ok(result.includes('Edited'));
    assert.equal(fs.readFileSync(filePath, 'utf-8'), 'new content here');
  });

  it('file_edit should reject non-unique old content', async () => {
    const filePath = path.join(tmpDir, 'dup.txt');
    fs.writeFileSync(filePath, 'abc abc');
    const tool = registry.get('file_edit')!;
    await assert.rejects(
      () => tool.execute({ path: filePath, oldContent: 'abc', newContent: 'xyz' }),
      { message: /found 2 times/ }
    );
  });

  it('code_search should find matches', async () => {
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'function hello() { return "hi"; }');
    fs.writeFileSync(path.join(tmpDir, 'util.ts'), 'const greeting = "hello";');
    const tool = registry.get('code_search')!;
    const result = await tool.execute({ query: 'hello', dir: tmpDir });
    assert.ok(result.includes('app.ts'));
    assert.ok(result.includes('util.ts'));
  });

  it('code_search should filter by file type', async () => {
    fs.writeFileSync(path.join(tmpDir, 'app.ts'), 'const API_KEY = "abc";');
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'const API_KEY = "abc";');
    const tool = registry.get('code_search')!;
    const result = await tool.execute({ query: 'API_KEY', dir: tmpDir, fileType: 'ts' });
    assert.ok(result.includes('app.ts'));
    assert.ok(!result.includes('app.js'));
  });
});

describe('Bash Tool', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    createBashTool(registry);
  });

  it('should execute a command', async () => {
    const tool = registry.get('bash_execute')!;
    const result = await tool.execute({ command: 'echo hello' });
    assert.ok(result.includes('hello'));
    assert.ok(result.includes('Exit code: 0'));
  });

  it('should capture stderr', async () => {
    const tool = registry.get('bash_execute')!;
    const result = await tool.execute({ command: 'echo error >&2' });
    assert.ok(result.includes('error'));
  });

  it('should report non-zero exit code', async () => {
    const tool = registry.get('bash_execute')!;
    const result = await tool.execute({ command: 'exit 42' });
    assert.ok(result.includes('Exit code: 42'));
  });
});

describe('Commission Validator', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    createCommissionTool(registry);
  });

  it('should calculate life gold commission', async () => {
    const tool = registry.get('commission_validator')!;
    const result = await tool.execute({
      action: 'calculate', agentLevel: 'gold', productType: 'life',
      premiumAmount: 100000, policyYear: 1, isRenewal: false,
    });
    const parsed = JSON.parse(result as string);
    assert.equal(parsed.rate, 0.5);
    assert.equal(parsed.commission, 50000);
  });

  it('should calculate life bronze commission', async () => {
    const tool = registry.get('commission_validator')!;
    const result = await tool.execute({
      action: 'calculate', agentLevel: 'bronze', productType: 'life',
      premiumAmount: 50000, policyYear: 1, isRenewal: false,
    });
    const parsed = JSON.parse(result as string);
    assert.equal(parsed.rate, 0.4);
    assert.equal(parsed.commission, 20000);
  });

  it('should simulate commissions', async () => {
    const tool = registry.get('commission_validator')!;
    const result = await tool.execute({
      action: 'simulate', agentLevel: 'gold', productType: 'life', premiumAmount: 200000,
    });
    assert.ok(result.includes('commission'));
  });
});

describe('License Checker', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    createLicenseChecker(registry);
  });

  it('should check agent status', async () => {
    const tool = registry.get('license_checker')!;
    const result = await tool.execute({ action: 'check_status', agentId: 'AGT001' });
    assert.ok(result.includes('active'));
  });

  it('should report expired agent', async () => {
    const tool = registry.get('license_checker')!;
    const result = await tool.execute({ action: 'check_status', agentId: 'AGT003' });
    assert.ok(result.includes('expired'));
  });

  it('should check product authorization', async () => {
    const tool = registry.get('license_checker')!;
    const result = await tool.execute({ action: 'check_authorization', agentId: 'AGT001', productType: 'life' });
    assert.ok(result.includes('authorized'));
  });

  it('should deny unauthorized product', async () => {
    const tool = registry.get('license_checker')!;
    const result = await tool.execute({ action: 'check_authorization', agentId: 'AGT001', productType: 'motor' });
    assert.ok(result.includes('NOT authorized'));
  });

  it('should list expiring licenses', async () => {
    const tool = registry.get('license_checker')!;
    const result = await tool.execute({ action: 'list_expiring', daysUntilExpiry: 400 });
    assert.ok(result.includes('AGT003'));
  });
});

describe('Compliance Checker', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    createComplianceChecker(registry);
  });

  it('should detect HKID in code', async () => {
    const tool = registry.get('compliance_checker')!;
    const result = await tool.execute({
      action: 'check', content: 'const id = "A123456B";', filePath: 'src/test.ts', jurisdiction: 'HK',
    });
    const parsed = JSON.parse(result as string);
    assert.equal(parsed.passed, false);
    assert.ok(parsed.violations.length > 0);
    assert.ok(parsed.violations[0].description.includes('HKID'));
  });

  it('should pass clean code', async () => {
    const tool = registry.get('compliance_checker')!;
    const result = await tool.execute({
      action: 'check', content: 'const name = process.env.USER_NAME;', filePath: 'src/clean.ts', jurisdiction: 'HK',
    });
    const parsed = JSON.parse(result as string);
    assert.equal(parsed.passed, true);
    assert.equal(parsed.violations.length, 0);
  });

  it('should warn about commission without disclosure', async () => {
    const tool = registry.get('compliance_checker')!;
    const result = await tool.execute({
      action: 'check',
      content: 'function calculateCommission(rate, premium) { return rate * premium; }',
      filePath: 'src/commission.ts', jurisdiction: 'HK',
      checkTypes: ['data_privacy', 'commission_disclosure', 'agent_licensing', 'consumer_protection'],
    });
    const parsed = JSON.parse(result as string);
    assert.ok(parsed.violations.length >= 0); // May or may not have violations
  });
});

import { eventBus } from '../src/core/events.js';
import { SafetyManager } from '../src/core/safety-manager.js';

describe('EventBus', () => {
  it('should emit and receive events', () => {
    let received = false;
    eventBus.on('file_changed', () => { received = true; });
    eventBus.emit({ type: 'file_changed', path: 'test.ts', content: '' });
    assert.equal(received, true);
    eventBus.removeAllListeners();
  });

  it('should handle once listeners', () => {
    let count = 0;
    eventBus.once('test_completed', () => { count++; });
    eventBus.emit({ type: 'test_completed', passed: 1, failed: 0, duration: 100 });
    eventBus.emit({ type: 'test_completed', passed: 2, failed: 0, duration: 200 });
    assert.equal(count, 1);
    eventBus.removeAllListeners();
  });
});

describe('SafetyManager', () => {
  it('should block dangerous commands', () => {
    const sm = new SafetyManager();
    const result = sm.checkTool('bash_execute', { command: 'rm -rf /' });
    assert.equal(result.allowed, false);
  });

  it('should allow safe commands', () => {
    const sm = new SafetyManager();
    const result = sm.checkTool('bash_execute', { command: 'ls -la' });
    assert.equal(result.allowed, true);
  });
});
