#!/usr/bin/env node
import { loadConfig } from '../core/config.js';
import { createServer } from '../server/index.js';
import { initDatabase } from '../core/database.js';
import { Orchestrator } from '../core/orchestrator.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { createFileTools } from '../tools/file-tools.js';
import { createBashTool } from '../tools/bash-tool.js';
import { createGitTool } from '../tools/git-tool.js';
import { createCommissionTool } from '../tools/commission-validator.js';
import { createLicenseChecker } from '../tools/license-checker.js';
import { createSchemaReader } from '../tools/schema-reader.js';
import { createApiTester } from '../tools/api-tester.js';
import { createComplianceChecker } from '../tools/compliance-checker.js';

function printUsage(): void {
  console.log(`
InsureAgent — Insurance AMS Coding Agent v0.1.0

Usage:
  insure-agent serve                          Start API server
  insure-agent run <task>                     Run a one-shot task
  insure-agent session list                   List sessions
  insure-agent session show <id>              Show session details
  insure-agent tools list                     List available tools
  insure-agent tools run <name> <json>        Execute a tool directly
  insure-agent validate commission            Validate commission formulas
  insure-agent check compliance <file>        Run compliance check on file
  insure-agent license check <agentId>        Check agent license status
  insure-agent license expiring [days]         List expiring licenses

Options:
  --port <number>      Server port (default: 7008)
  --db <path>          Database path (default: ./data/insure-agent.db)
  --help               Show this help
`);
}

function setupRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  createFileTools(registry);
  createBashTool(registry);
  createGitTool(registry);
  createCommissionTool(registry);
  createLicenseChecker(registry);
  createSchemaReader(registry);
  createApiTester(registry);
  createComplianceChecker(registry);
  return registry;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1]) : undefined;
  const dbIdx = args.indexOf('--db');
  const dbPath = dbIdx >= 0 ? args[dbIdx + 1] : undefined;

  const config = loadConfig({
    ...(port ? { port } : {}),
    ...(dbPath ? { dbPath } : {}),
  } as any);

  const command = args[0];

  // === serve ===
  if (command === 'serve') {
    const { app, orchestrator } = createServer(config);
    const db = initDatabase(config.dbPath);
    app.listen(config.port, config.host, () => {
      console.log(`InsureAgent server running on http://${config.host}:${config.port}`);
      console.log(`Database: ${config.dbPath}`);
      console.log(`API: http://${config.host}:${config.port}/api/health`);
    });
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      orchestrator.close();
      db.close();
      process.exit(0);
    });
    return;
  }

  // === run ===
  if (command === 'run') {
    const task = args.slice(1).join(' ');
    if (!task) {
      console.error('Error: Missing task. Usage: insure-agent run <task>');
      process.exit(1);
    }
    const registry = setupRegistry();
    const orchestrator = new Orchestrator({
      projectRoot: process.cwd(),
      dbPath: config.dbPath,
      registry,
      defaultModel: config.defaultModel,
    });
    try {
      console.log(`Running task: ${task}`);
      const result = await orchestrator.runTask(task);
      console.log('\n=== Result ===');
      console.log(`Session: ${result.sessionId}`);
      console.log(result.result);
    } catch (err) {
      console.error('Error:', (err as Error).message);
      process.exit(1);
    } finally {
      orchestrator.close();
    }
    return;
  }

  // === session ===
  if (command === 'session') {
    const subCommand = args[1];
    const registry = setupRegistry();
    const orchestrator = new Orchestrator({
      projectRoot: process.cwd(),
      dbPath: config.dbPath,
      registry,
      defaultModel: config.defaultModel,
    });

    if (subCommand === 'list') {
      const sessions = orchestrator.listSessions();
      if (sessions.length === 0) {
        console.log('No sessions found.');
      } else {
        console.log(`Sessions (${sessions.length}):`);
        for (const s of sessions) {
          console.log(`  ${s.id} [${s.status}] ${s.projectRoot} — ${new Date(s.updatedAt).toISOString()}`);
        }
      }
    } else if (subCommand === 'show') {
      const id = args[2];
      if (!id) { console.error('Usage: insure-agent session show <id>'); process.exit(1); }
      const history = orchestrator.getSessionHistory(id);
      if (!history) { console.error('Session not found'); process.exit(1); }
      for (const msg of history) {
        const time = new Date(msg.timestamp).toISOString().substring(11, 19);
        console.log(`[${time}] ${msg.role}: ${msg.content.substring(0, 200)}`);
      }
    } else {
      console.error('Usage: insure-agent session list|show <id>');
    }
    orchestrator.close();
    return;
  }

  // === tools ===
  if (command === 'tools') {
    const subCommand = args[1];

    if (subCommand === 'list') {
      const registry = setupRegistry();
      const tools = registry.list();
      console.log(`Tools (${tools.length}):`);
      for (const t of tools) {
        console.log(`  ${t.name} [${t.safetyLevel}] — ${t.description}`);
      }
      return;
    }

    if (subCommand === 'run') {
      const toolName = args[2];
      const jsonArgs = args[3] || '{}';
      if (!toolName) { console.error('Usage: insure-agent tools run <name> [json]'); process.exit(1); }
      const registry = setupRegistry();
      const tool = registry.get(toolName);
      if (!tool) { console.error(`Tool "${toolName}" not found`); process.exit(1); }
      try {
        const params = JSON.parse(jsonArgs);
        const result = await tool.execute(params);
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
      }
      return;
    }

    console.error('Usage: insure-agent tools list|run <name> [json]');
    return;
  }

  // === validate commission ===
  if (command === 'validate' && args[1] === 'commission') {
    const registry = setupRegistry();
    const tool = registry.get('commission_validator')!;
    const result = await tool.execute({
      action: 'simulate',
      agentLevel: 'gold',
      productType: 'life',
      premiumAmount: 100000,
    });
    console.log('Commission validation (sample):');
    console.log(result);
    return;
  }

  // === check compliance ===
  if (command === 'check' && args[1] === 'compliance') {
    const filePath = args[2];
    if (!filePath) { console.error('Usage: insure-agent check compliance <file>'); process.exit(1); }
    const fs = await import('fs');
    const content = fs.readFileSync(filePath, 'utf-8');
    const registry = setupRegistry();
    const tool = registry.get('compliance_checker')!;
    const result = await tool.execute({ content, filePath, jurisdiction: 'HK' });
    console.log(result);
    return;
  }

  // === license ===
  if (command === 'license') {
    const registry = setupRegistry();
    const tool = registry.get('license_checker')!;

    if (args[1] === 'check') {
      const agentId = args[2];
      if (!agentId) { console.error('Usage: insure-agent license check <agentId>'); process.exit(1); }
      const result = await tool.execute({ action: 'check_status', agentId });
      console.log(result);
    } else if (args[1] === 'expiring') {
      const days = parseInt(args[2]) || 30;
      const result = await tool.execute({ action: 'list_expiring', daysUntilExpiry: days });
      console.log(result);
    } else {
      console.error('Usage: insure-agent license check|expiring');
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
