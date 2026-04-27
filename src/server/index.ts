import express from 'express';
import { Orchestrator } from '../core/orchestrator.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { InsureAgentConfig } from '../core/types.js';
import { createFileTools } from '../tools/file-tools.js';
import { createBashTool } from '../tools/bash-tool.js';
import { createGitTool } from '../tools/git-tool.js';
import { createCommissionTool } from '../tools/commission-validator.js';
import { createLicenseChecker } from '../tools/license-checker.js';
import { createSchemaReader } from '../tools/schema-reader.js';
import { createApiTester } from '../tools/api-tester.js';
import { createComplianceChecker } from '../tools/compliance-checker.js';
import { HookEngine } from '../hooks/hook-engine.js';
import { registerBuiltinHooks } from '../hooks/builtin-hooks.js';

export function createServer(config: InsureAgentConfig) {
  const app = express();
  app.use(express.json());

  // Setup tools
  const registry = new ToolRegistry();
  createFileTools(registry);
  createBashTool(registry);
  createGitTool(registry);
  createCommissionTool(registry);
  createLicenseChecker(registry);
  createSchemaReader(registry);
  createApiTester(registry);
  createComplianceChecker(registry);

  // Setup hooks
  const hookEngine = new HookEngine();
  registerBuiltinHooks(hookEngine, registry);

  // Setup orchestrator
  const orchestrator = new Orchestrator({
    projectRoot: process.cwd(),
    dbPath: config.dbPath,
    registry,
    defaultModel: config.defaultModel,
  });

  // Auth middleware
  const apiKey = process.env.INSURE_AGENT_API_KEY;
  if (apiKey) {
    app.use('/api', (req, res, next) => {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${apiKey}`) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0', tools: registry.list().length, uptime: process.uptime() });
  });

  // Sessions
  app.post('/api/sessions', async (req, res) => {
    try {
      const { projectRoot, modelConfig } = req.body;
      const session = (orchestrator as any).sessionManager.createSession(
        projectRoot || process.cwd(),
        modelConfig || config.defaultModel
      );
      res.json({ id: session.id, status: session.status, createdAt: session.createdAt });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/sessions', (_req, res) => {
    res.json(orchestrator.listSessions());
  });

  app.get('/api/sessions/:id', (req, res) => {
    const history = orchestrator.getSessionHistory(req.params.id);
    if (!history) { res.status(404).json({ error: 'Session not found' }); return; }
    res.json({ history, count: history.length });
  });

  // Tasks
  app.post('/api/sessions/:id/tasks', async (req, res) => {
    try {
      const { task, taskType } = req.body;
      if (!task) { res.status(400).json({ error: 'Missing task' }); return; }
      const result = await orchestrator.runTask(task, taskType || 'general');
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Undo
  app.post('/api/sessions/:id/undo', (req, res) => {
    const ok = orchestrator.undo(req.params.id);
    res.json({ success: ok });
  });

  // Direct tool execution
  app.post('/api/tools/:name', async (req, res) => {
    try {
      const tool = registry.get(req.params.name);
      if (!tool) { res.status(404).json({ error: `Tool "${req.params.name}" not found` }); return; }
      const validation = registry.validateParams(req.params.name, req.body);
      if (!validation.valid) { res.status(400).json({ error: validation.errors }); return; }
      const result = await tool.execute(req.body);
      res.json({ tool: req.params.name, result });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List tools
  app.get('/api/tools', (_req, res) => {
    res.json(registry.list());
  });

  // List hooks
  app.get('/api/hooks', (_req, res) => {
    res.json(hookEngine.list());
  });

  return { app, orchestrator, registry, hookEngine };
}
