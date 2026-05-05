#!/usr/bin/env node
import "../core/env.js";
import * as readline from 'node:readline';
import { loadConfig } from '../core/config.js';
import { initDatabase } from '../core/database.js';
import { AgentLoop, AgentEvent } from '../core/agent-loop.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { SessionManager } from '../core/session.js';
import { MemoryManager } from '../core/memory.js';
import { SkillGenerator } from '../core/skill-generator.js';
import { ModelRouter } from '../core/model-router.js';
import { createFileTools } from '../tools/file-tools.js';
import { createBashTool } from '../tools/bash-tool.js';
import { createCommissionTool } from '../tools/commission-validator.js';
import { createLicenseChecker } from '../tools/license-checker.js';
import { createSchemaReader } from '../tools/schema-reader.js';
import { createApiTester } from '../tools/api-tester.js';
import { createComplianceChecker } from '../tools/compliance-checker.js';
import { createRequirementGapAnalyzer } from '../tools/requirement-gap-analyzer.js';
import { safeFetch } from '../core/http.js';
import { ModelConfig } from '../core/types.js';
import { MarkdownRenderer } from './markdown.js';
import { readFileSafe, showFileDiff } from './diff.js';
import { PROVIDERS } from '../models/providers.js';
import fs from 'fs';
import path from 'path';

// ANSI escape codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const CLEAR_LINE = '\x1b[2K\r';

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '...' : oneLine;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function setupRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  createFileTools(registry);
  createBashTool(registry);
  createCommissionTool(registry);
  createLicenseChecker(registry);
  createSchemaReader(registry);
  createApiTester(registry);
  createComplianceChecker(registry);
  createRequirementGapAnalyzer(registry);
  return registry;
}

const SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⏳'];
const RESULT_PREVIEW_LINES = 5;

interface Step {
  num: number;
  tool: string;
  params: Record<string, unknown>;
  status: string;
  duration: number;
  fullContent: string;
  startedAt: number;
}

class InteractiveChat {
  private rl: readline.Interface;
  private sessionManager: SessionManager;
  private memoryManager: MemoryManager;
  private skillGenerator: SkillGenerator;
  private modelRouter: ModelRouter;
  private registry: ToolRegistry;
  private modelConfig: ModelConfig;
  private sessionId: string | null = null;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private isRunning = false;
  private pendingTask: Promise<void> | null = null;

  // step tracking — survives across turns within a session
  private steps: Step[] = [];
  private currentStep: Step | null = null;

  // markdown rendering for assistant text
  private mdRenderer: MarkdownRenderer | null = null;
  private inThinking = false;
  private inAssistantText = false;

  // file diff tracking — capture before content for diff display
  private fileBeforeContent: Map<string, string> = new Map();

  constructor(private config: ReturnType<typeof loadConfig>) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${BOLD}${CYAN}❯${RESET} `,
    });

    this.registry = setupRegistry();
    this.sessionManager = new SessionManager(config.dbPath);
    this.memoryManager = new MemoryManager(config.dbPath.replace(/\.db$/i, '') + 'memory.json');
    this.skillGenerator = new SkillGenerator();
    this.modelRouter = new ModelRouter(config.defaultModel);
    this.modelConfig = config.defaultModel;
  }

  async start(): Promise<void> {
    this.printBanner();
    this.rl.prompt();

    this.rl.on('line', async (line) => {
      const input = line.trim();
      if (!input) { this.rl.prompt(); return; }

      // Slash commands and exit
      if (input === 'exit' || input === 'quit') {
        if (this.pendingTask) await this.pendingTask;
        this.shutdown();
        return;
      }
      if (input === '/clear' || input === 'clear') {
        this.sessionId = null;
        this.steps = [];
        process.stdout.write(`${GRAY}Session cleared.${RESET}\n`);
        this.rl.prompt();
        return;
      }
      if (input === '/help' || input === 'help') {
        this.printHelp();
        this.rl.prompt();
        return;
      }
      // /steps and /step (alias) — list every numbered tool call so far
      if (input === '/steps' || input === '/step') {
        this.printSteps();
        this.rl.prompt();
        return;
      }
      if (input === '/last') {
        if (this.steps.length === 0) process.stdout.write(`${GRAY}No steps yet.${RESET}\n`);
        else this.printStep(this.steps[this.steps.length - 1]);
        this.rl.prompt();
        return;
      }
      const showMatch = input.match(/^\/show(?:\s+(\d+))?$/);
      if (showMatch) {
        const n = showMatch[1] ? parseInt(showMatch[1], 10) : (this.steps.length);
        const step = this.steps.find(s => s.num === n);
        if (!step) process.stdout.write(`${GRAY}No step #${n}.${RESET}\n`);
        else this.printStep(step);
        this.rl.prompt();
        return;
      }
      // /model [provider/model] — show or switch the active model
      const modelMatch = input.match(/^\/model(?:\s+(\S+)\/(\S+))?$/);
      if (modelMatch) {
        if (modelMatch[1] && modelMatch[2]) {
          this.modelConfig = {
            ...this.modelConfig,
            provider: modelMatch[1] as any,
            model: modelMatch[2],
            apiKey: undefined,  // will be resolved by LLMClient at call time
          };
          this.persistModelChoice(modelMatch[1], modelMatch[2]);
          process.stdout.write(`${GREEN}✓${RESET} Switched to ${BOLD}${this.modelConfig.model}${RESET} ${GRAY}(${this.modelConfig.provider})${RESET} ${DIM}(saved as default)${RESET}\n`);
        } else {
          process.stdout.write(`${GRAY}Current model:${RESET} ${BOLD}${this.modelConfig.model}${RESET} ${GRAY}(${this.modelConfig.provider})${RESET}\n`);
          process.stdout.write(`${GRAY}Usage: /model <provider>/<model>  (e.g. /model zhipu/glm-5.1)${RESET}\n`);
        }
        this.rl.prompt();
        return;
      }
      if (input === '/cancel') {
        if (this.isRunning) {
          this.isRunning = false;
          this.stopSpinner();
          process.stdout.write(`${YELLOW}Cancelled.${RESET}\n`);
        } else {
          process.stdout.write(`${GRAY}Nothing to cancel.${RESET}\n`);
        }
        this.rl.prompt();
        return;
      }

      // /resume [id] — continue a previous session (default: most recent)
      const resumeMatch = input.match(/^\/resume(?:\s+(\S+))?$/);
      if (resumeMatch) {
        this.resumeSession(resumeMatch[1] || null);
        this.rl.prompt();
        return;
      }

      // /sessions — list saved sessions
      if (input === '/sessions') {
        this.listSessions();
        this.rl.prompt();
        return;
      }

      // /models — list available models (live from provider API)
      if (input === '/models') {
        this.pendingTask = this.listModels().then(() => { this.pendingTask = null; this.rl.prompt(); });
        return;
      }

      // /remember <text> — save a fact or preference
      const rememberMatch = input.match(/^\/remember\s+(.+)$/);
      if (rememberMatch) {
        const text = rememberMatch[1].trim();
        this.memoryManager.addFact('user_preference', text, `session:${this.sessionId ?? 'cli'}`);
        process.stdout.write(`${GREEN}✓${RESET} Remembered: ${GRAY}${truncate(text, 80)}${RESET}\n`);
        this.rl.prompt();
        return;
      }

      // /forget <text> — remove a fact
      const forgetMatch = input.match(/^\/forget\s+(.+)$/);
      if (forgetMatch) {
        const text = forgetMatch[1].trim();
        const removed = this.memoryManager.removeFact(text);
        if (removed) {
          process.stdout.write(`${GREEN}✓${RESET} Forgot: ${GRAY}${truncate(text, 80)}${RESET}\n`);
        } else {
          process.stdout.write(`${YELLOW}No matching fact found.${RESET}\n`);
        }
        this.rl.prompt();
        return;
      }

      // /memory — list all stored facts
      if (input === '/memory') {
        const facts = this.memoryManager.listFacts();
        if (facts.length === 0) {
          process.stdout.write(`${GRAY}No memories stored yet. Use ${RESET}${CYAN}/remember <text>${RESET}${GRAY} to save one.${RESET}\n`);
        } else {
          process.stdout.write(`\n${BOLD}Memories (${facts.length})${RESET}\n`);
          for (const f of facts.slice(0, 20)) {
            const time = new Date(f.created_at).toLocaleDateString();
            process.stdout.write(`  ${GRAY}[${f.category}]${RESET} ${f.content} ${DIM}(${time})${RESET}\n`);
          }
          if (facts.length > 20) {
            process.stdout.write(`  ${GRAY}…${facts.length - 20} more${RESET}\n`);
          }
          process.stdout.write('\n');
        }
        this.rl.prompt();
        return;
      }

      // /skills — list learned skill documents
      if (input === '/skills') {
        const skills = this.skillGenerator.listSkills();
        if (skills.length === 0) {
          process.stdout.write(`${GRAY}No skills learned yet. Complex tasks (3+ tools) are auto-saved.${RESET}\n`);
        } else {
          process.stdout.write(`\n${BOLD}Skills (${skills.length})${RESET}\n`);
          for (const s of skills) {
            const time = new Date(s.created_at).toLocaleDateString();
            process.stdout.write(`  ${CYAN}${s.title}${RESET} ${GRAY}(${time})${RESET}\n`);
            process.stdout.write(`    ${DIM}${truncate(s.summary, 80)}${RESET}\n`);
          }
          process.stdout.write('\n');
        }
        this.rl.prompt();
        return;
      }

      // Unknown slash command — do NOT forward to the LLM. The model gets
      // confused by stray "/foo" tokens and goes into a re-read loop.
      if (input.startsWith('/')) {
        process.stdout.write(`${YELLOW}Unknown command: ${RESET}${BOLD}${input}${RESET}\n`);
        process.stdout.write(`${GRAY}Type ${RESET}${CYAN}/help${RESET}${GRAY} for the list of valid commands.${RESET}\n`);
        this.rl.prompt();
        return;
      }

      this.pendingTask = this.handleInput(input).then(() => { this.pendingTask = null; });
    });

    this.rl.on('close', async () => {
      if (this.pendingTask) await this.pendingTask;
      this.shutdown();
    });

    process.on('SIGINT', () => {
      if (this.isRunning) {
        this.isRunning = false;
        this.stopSpinner();
        process.stdout.write(`\n${YELLOW}Interrupted${RESET}\n\n`);
        this.rl.prompt(true);
      } else {
        this.shutdown();
      }
    });
  }

  private printBanner(): void {
    const model = this.modelConfig.model;
    const provider = this.modelConfig.provider;
    process.stdout.write(`\n${BOLD}${CYAN}InsureAgent${RESET} ${GRAY}v0.1.0${RESET} — ${BOLD}${model}${RESET} ${GRAY}(${provider})${RESET}\n`);
    process.stdout.write(`${GRAY}Type a question, or ${RESET}${CYAN}/help${RESET}${GRAY} for commands.${RESET}\n`);
    process.stdout.write(`${GRAY}${'─'.repeat(60)}${RESET}\n\n`);
  }

  private printHelp(): void {
    process.stdout.write(`\n${BOLD}Commands${RESET}\n`);
    process.stdout.write(`  ${CYAN}/help${RESET}        Show this help\n`);
    process.stdout.write(`  ${CYAN}/clear${RESET}       Reset the session and step history\n`);
    process.stdout.write(`  ${CYAN}/sessions${RESET}    List saved sessions\n`);
    process.stdout.write(`  ${CYAN}/resume${RESET}      Resume the most recent session ${GRAY}(or: /resume <id>)${RESET}\n`);
    process.stdout.write(`  ${CYAN}/steps${RESET}       List all tool-call steps in this session ${GRAY}(alias: /step)${RESET}\n`);
    process.stdout.write(`  ${CYAN}/show N${RESET}      Expand step N (full output)\n`);
    process.stdout.write(`  ${CYAN}/last${RESET}        Expand the most recent step\n`);
    process.stdout.write(`  ${CYAN}/model${RESET}       Show or switch model ${GRAY}(/model zhipu/glm-5.1)${RESET}\n`);
    process.stdout.write(`  ${CYAN}/models${RESET}      List available models (live from provider)${RESET}\n`);
    process.stdout.write(`  ${CYAN}/remember${RESET}    Save a fact or preference ${GRAY}(/remember text)${RESET}\n`);
    process.stdout.write(`  ${CYAN}/forget${RESET}      Remove a saved fact ${GRAY}(/forget text)${RESET}\n`);
    process.stdout.write(`  ${CYAN}/memory${RESET}      List all saved memories${RESET}\n`);
    process.stdout.write(`  ${CYAN}/skills${RESET}      List auto-learned skill documents${RESET}\n`);
    process.stdout.write(`  ${CYAN}/cancel${RESET}      Cancel the running task ${GRAY}(also Ctrl+C)${RESET}\n`);
    process.stdout.write(`  ${CYAN}exit${RESET}         Quit\n\n`);
  }

  private printSteps(): void {
    if (this.steps.length === 0) {
      process.stdout.write(`${GRAY}No steps yet.${RESET}\n`);
      return;
    }
    process.stdout.write(`\n${BOLD}Steps (${this.steps.length})${RESET}\n`);
    for (const s of this.steps) {
      const icon = s.status === 'success' ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      const dur = formatDuration(s.duration);
      process.stdout.write(`  ${icon} ${BOLD}#${s.num}${RESET} ${CYAN}${s.tool}${RESET} ${GRAY}${dur}${RESET} ${GRAY}${truncate(s.fullContent, 60)}${RESET}\n`);
    }
    process.stdout.write(`\n${GRAY}Use ${RESET}${CYAN}/show N${RESET}${GRAY} to expand any step.${RESET}\n\n`);
  }

  private printStep(step: Step): void {
    const icon = step.status === 'success' ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    process.stdout.write(`\n${icon} ${BOLD}Step #${step.num}${RESET} ${CYAN}${step.tool}${RESET} ${GRAY}(${formatDuration(step.duration)})${RESET}\n`);
    if (Object.keys(step.params).length > 0) {
      process.stdout.write(`${GRAY}params:${RESET} ${truncate(JSON.stringify(step.params), 200)}\n`);
    }
    process.stdout.write(`${GRAY}${'─'.repeat(60)}${RESET}\n`);
    process.stdout.write(step.fullContent || `${GRAY}(empty)${RESET}`);
    if (!step.fullContent.endsWith('\n')) process.stdout.write('\n');
    process.stdout.write(`${GRAY}${'─'.repeat(60)}${RESET}\n\n`);
  }

  private listSessions(): void {
    const sessions = this.sessionManager.listSessions();
    if (sessions.length === 0) {
      process.stdout.write(`${GRAY}No sessions found.${RESET}\n`);
      return;
    }
    process.stdout.write(`\n${BOLD}Sessions (${sessions.length})${RESET}\n`);
    for (const s of sessions.slice(0, 20)) {
      const time = new Date(s.updatedAt).toLocaleString();
      const msgs = this.sessionManager.getHistory(s.id).length;
      const active = s.id === this.sessionId ? ` ${GREEN}(current)${RESET}` : '';
      process.stdout.write(`  ${GRAY}${s.id}${RESET} ${GRAY}${time}${RESET} ${GRAY}${msgs} msg(s)${RESET}${active}\n`);
    }
    process.stdout.write(`\n${GRAY}Use ${RESET}${CYAN}/resume <id>${RESET}${GRAY} to continue a session.${RESET}\n\n`);
  }

  private resumeSession(sessionId: string | null): void {
    if (!sessionId) {
      // Find the most recent session that isn't the current one
      const sessions = this.sessionManager.listSessions();
      const other = sessions.find(s => s.id !== this.sessionId);
      if (!other) {
        process.stdout.write(`${GRAY}No previous sessions to resume.${RESET}\n`);
        return;
      }
      sessionId = other.id;
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      process.stdout.write(`${RED}Session not found: ${sessionId}${RESET}\n`);
      return;
    }

    this.sessionManager.resumeSession(sessionId);
    this.sessionId = sessionId;
    this.steps = [];

    const history = this.sessionManager.getHistory(sessionId);
    const userMsgs = history.filter(m => m.role === 'user');
    const toolMsgs = history.filter(m => m.role === 'tool');
    const time = new Date(session.updatedAt).toLocaleString();

    process.stdout.write(`${GREEN}✓${RESET} Resumed session ${GRAY}${sessionId}${RESET}\n`);
    process.stdout.write(`  ${GRAY}Last active: ${time}${RESET}\n`);
    process.stdout.write(`  ${GRAY}${userMsgs.length} user message(s), ${toolMsgs.length} tool call(s)${RESET}\n`);

    // Show a compact summary of the last few exchanges
    if (userMsgs.length > 0) {
      process.stdout.write(`\n${DIM}Recent messages:${RESET}\n`);
      const recent = userMsgs.slice(-3);
      for (const m of recent) {
        const preview = truncate(m.content, 80);
        process.stdout.write(`  ${GRAY}→${RESET} ${preview}${RESET}\n`);
      }
    }
    process.stdout.write('\n');
  }

  /** Fetch and display available models from the current provider's API. */
  private async listModels(): Promise<void> {
    const provider = this.modelConfig.provider;
    const currentModel = this.modelConfig.model;

    // Show static list first
    const staticModels = PROVIDERS.find(p => p.name === provider)?.models ?? [];
    if (staticModels.length > 0) {
      process.stdout.write(`\n${BOLD}Known models for ${provider}:${RESET}\n`);
      for (const m of staticModels) {
        const marker = m.model === currentModel ? ` ${GREEN}(active)${RESET}` : '';
        process.stdout.write(`  ${CYAN}${m.model}${RESET}${marker}\n`);
      }
    }

    // Live fetch from provider
    process.stdout.write(`\n${GRAY}Fetching live models from ${provider}...${RESET}\n`);
    try {
      const models = await this.fetchLiveModels(provider);
      if (models.length > 0) {
        process.stdout.write(`\n${BOLD}Live models (${models.length}):${RESET}\n`);
        for (const m of models) {
          const marker = m.id === currentModel ? ` ${GREEN}(active)${RESET}` : '';
          const enabled = m.enabled ? '' : ` ${DIM}(hidden)${RESET}`;
          process.stdout.write(`  ${CYAN}${m.id}${RESET}${marker}${enabled}\n`);
        }
      } else {
        process.stdout.write(`${GRAY}No models returned.${RESET}\n`);
      }
    } catch (err) {
      process.stdout.write(`${YELLOW}Could not fetch: ${(err as Error).message}${RESET}\n`);
      process.stdout.write(`${GRAY}Use the known models listed above.${RESET}\n`);
    }

    process.stdout.write(`\n${GRAY}Switch with: ${RESET}${CYAN}/model ${provider}/<model>${RESET}\n\n`);
  }

  private async fetchLiveModels(provider: string): Promise<Array<{ id: string; enabled: boolean }>> {
    // GitHub Copilot — use /models endpoint
    if (provider === 'copilot') {
      const { getCopilotToken } = await import('../core/copilot-auth.js');
      const token = await getCopilotToken();
      const r = await safeFetch('https://api.githubcopilot.com/models', {
        headers: {
          'authorization': `Bearer ${token}`,
          'editor-version': 'vscode/1.95.0',
          'editor-plugin-version': 'copilot-chat/0.22.0',
          'copilot-integration-id': 'vscode-chat',
          'user-agent': 'GitHubCopilotChat/0.22.0',
          'openai-intent': 'conversation-panel',
        },
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json() as { data: Array<{ id: string; model_picker_enabled?: boolean }> };
      return (data.data || []).map(m => ({ id: m.id, enabled: !!m.model_picker_enabled }));
    }

    // OpenAI-compatible providers — use /v1/models
    const endpoints: Record<string, string> = {
      openai: 'https://api.openai.com/v1/models',
      deepseek: 'https://api.deepseek.com/v1/models',
      zhipu: 'https://api.z.ai/api/coding/paas/v4/models',
    };

    const url = this.modelConfig.baseUrl
      ? this.modelConfig.baseUrl.replace(/\/chat\/completions.*$/, '/models')
      : endpoints[provider];

    if (!url) {
      // Anthropic / Google — no public /models endpoint
      return PROVIDERS.find(p => p.name === provider)?.models.map(m => ({ id: m.model, enabled: true })) ?? [];
    }

    const apiKey = await this.resolveApiKey(provider);
    const r = await safeFetch(url, {
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
    });
    if (!r.ok) throw new Error(`${r.status}`);
    const data = await r.json() as { data: Array<{ id: string }> };
    return (data.data || []).map(m => ({ id: m.id, enabled: true }));
  }

  private async resolveApiKey(provider: string): Promise<string> {
    if (this.modelConfig.apiKey) return this.modelConfig.apiKey;
    if (provider === 'copilot') {
      const { getCopilotToken } = await import('../core/copilot-auth.js');
      return getCopilotToken();
    }
    const env = process.env[`${provider.toUpperCase()}_API_KEY`];
    if (!env) throw new Error(`No API key for ${provider}`);
    return env;
  }

  /** Write DEFAULT_MODEL_PROVIDER and DEFAULT_MODEL to .env so the choice persists. */
  private persistModelChoice(provider: string, model: string): void {
    try {
      const envPath = path.join(process.cwd(), '.env');
      let content = '';
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, 'utf-8');
      }

      const providerLine = `DEFAULT_MODEL_PROVIDER=${provider}`;
      const modelLine = `DEFAULT_MODEL=${model}`;

      // Replace existing (commented or uncommented) lines, or append
      let updated = content;
      if (/^#?\s*DEFAULT_MODEL_PROVIDER=.*$/m.test(updated)) {
        updated = updated.replace(/^#?\s*DEFAULT_MODEL_PROVIDER=.*$/m, providerLine);
      } else {
        updated += `\n${providerLine}`;
      }

      if (/^#?\s*DEFAULT_MODEL=.*$/m.test(updated)) {
        updated = updated.replace(/^#?\s*DEFAULT_MODEL=.*$/m, modelLine);
      } else {
        updated += `\n${modelLine}`;
      }

      fs.writeFileSync(envPath, updated, 'utf-8');
    } catch {
      // Non-critical — the switch still works for this session
    }
  }

  private async handleInput(input: string): Promise<void> {
    this.isRunning = true;
    const startTime = Date.now();

    try {
      if (!this.sessionId) {
        const session = this.sessionManager.createSession(process.cwd(), this.modelConfig);
        this.sessionId = session.id;
      }

      const loop = new AgentLoop({
        sessionId: this.sessionId,
        projectRoot: process.cwd(),
        registry: this.registry,
        sessionManager: this.sessionManager,
        memoryManager: this.memoryManager,
        skillGenerator: this.skillGenerator,
        onEvent: (event) => this.displayEvent(event),
      });

      this.inThinking = false;
      this.inAssistantText = false;
      this.mdRenderer = null;

      await loop.run(input);

      const renderer = this.mdRenderer as MarkdownRenderer | null;
      if (renderer) { renderer.end(); this.mdRenderer = null; }
      this.inAssistantText = false;

      const elapsed = Date.now() - startTime;
      process.stdout.write(`\n${GRAY}${'─'.repeat(60)}${RESET}\n`);
      process.stdout.write(`${GRAY}Done in ${formatDuration(elapsed)} · ${this.steps.length} step(s) · ${CYAN}/steps${RESET}${GRAY} to review${RESET}\n\n`);
    } catch (err) {
      this.stopSpinner();
      process.stdout.write(`\n${RED}Error: ${(err as Error).message}${RESET}\n\n`);
    } finally {
      this.isRunning = false;
      this.rl.prompt();
    }
  }

  private displayEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'thinking_start':
        this.stopSpinner();
        this.inThinking = true;
        process.stdout.write(`\n${DIM}${ITALIC}${GRAY}┃ thinking${RESET}\n${DIM}${ITALIC}${GRAY}┃ ${RESET}${DIM}${ITALIC}`);
        break;

      case 'thinking_delta': {
        this.stopSpinner();
        const text = event.text || '';
        for (const ch of text) {
          if (ch === '\n') process.stdout.write(`${RESET}\n${DIM}${ITALIC}${GRAY}┃ ${RESET}${DIM}${ITALIC}`);
          else process.stdout.write(ch);
        }
        break;
      }

      case 'thinking_end':
        process.stdout.write(`${RESET}\n`);
        this.inThinking = false;
        break;

      case 'text_delta':
        this.stopSpinner();
        if (!this.inAssistantText) {
          this.inAssistantText = true;
          this.mdRenderer = new MarkdownRenderer();
          process.stdout.write('\n');
        }
        this.mdRenderer!.push(event.text || '');
        break;

      case 'text_end':
        if (this.mdRenderer) { this.mdRenderer.end(); this.mdRenderer = null; }
        this.inAssistantText = false;
        break;

      case 'tool_call_start': {
        if (this.mdRenderer) { this.mdRenderer.end(); this.mdRenderer = null; this.inAssistantText = false; }
        this.stopSpinner();
        const params = event.params;
        const paramStr = Object.keys(params).length > 0
          ? ' ' + truncate(JSON.stringify(params), 80)
          : '';
        const stepNum = this.steps.length + 1;
        this.currentStep = {
          num: stepNum,
          tool: event.name,
          params,
          status: 'pending',
          duration: 0,
          fullContent: '',
          startedAt: Date.now(),
        };
        // Capture file content before file_write/file_edit executes.
        // Resolve to absolute path so the key matches after sandbox normalization.
        if (event.name === 'file_write' || event.name === 'file_edit') {
          const rawPath = String(params.path || params.filePath || '');
          if (rawPath) {
            const absPath = path.resolve(rawPath);
            this.fileBeforeContent.set(absPath, readFileSafe(absPath));
          }
        }
        process.stdout.write(`\n${CYAN}${BOLD}▸${RESET} ${BOLD}#${stepNum}${RESET} ${CYAN}${event.name}${RESET}${GRAY}${paramStr}${RESET}\n`);
        this.startSpinner(`  Running ${event.name}`);
        break;
      }

      case 'tool_result': {
        this.stopSpinner();
        const icon = event.status === 'success' ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
        const toolName = event.name;
        if (this.currentStep) {
          this.currentStep.status = event.status;
          this.currentStep.duration = event.duration;
          this.currentStep.fullContent = event.content;
          this.steps.push(this.currentStep);
        }
        const stepNum = this.currentStep?.num ?? this.steps.length;
        const dur = formatDuration(event.duration);
        const lines = (event.content || '').split('\n');
        const previewLines = lines.slice(0, RESULT_PREVIEW_LINES);
        const isTruncated = lines.length > RESULT_PREVIEW_LINES;

        process.stdout.write(`  ${icon} ${GRAY}${dur}${RESET}`);
        if (previewLines.length === 1 && previewLines[0].length < 100 && !isTruncated) {
          process.stdout.write(` ${GRAY}${previewLines[0]}${RESET}\n`);
        } else if (previewLines.length > 0 && previewLines[0].length > 0) {
          process.stdout.write('\n');
          for (const ln of previewLines) {
            process.stdout.write(`    ${GRAY}${truncate(ln, 110)}${RESET}\n`);
          }
          if (isTruncated) {
            process.stdout.write(`    ${GRAY}…${RESET} ${DIM}${lines.length - RESULT_PREVIEW_LINES} more line(s) — ${RESET}${CYAN}/show ${stepNum}${RESET}\n`);
          }
        } else {
          process.stdout.write('\n');
        }

        // Show colored diff for file changes
        if (event.status === 'success' && (toolName === 'file_write' || toolName === 'file_edit')) {
          const filePath = String(this.currentStep?.params?.path || this.currentStep?.params?.filePath || '');
          if (filePath) {
            const absPath = path.resolve(filePath);
            const before = this.fileBeforeContent.get(absPath) ?? '';
            const after = readFileSafe(absPath);
            const diffOutput = showFileDiff(before, after, absPath);
            if (diffOutput) {
              process.stdout.write(`\n${diffOutput}\n`);
            }
            this.fileBeforeContent.delete(absPath);
          }
        }

        this.currentStep = null;
        break;
      }

      case 'error':
        this.stopSpinner();
        process.stdout.write(`\n  ${RED}✗ ${event.error}${RESET}\n`);
        break;

      case 'iteration':
        // intentionally quiet
        break;

      case 'complete':
        this.stopSpinner();
        if (this.mdRenderer) { this.mdRenderer.end(); this.mdRenderer = null; this.inAssistantText = false; }
        break;
    }
  }

  private startSpinner(label: string): void {
    this.stopSpinner();
    this.spinnerFrame = 0;
    process.stdout.write(CURSOR_HIDE);
    this.spinnerTimer = setInterval(() => {
      const frame = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length];
      process.stdout.write(`${CLEAR_LINE}${DIM}${frame} ${label}...${RESET}`);
      this.spinnerFrame++;
    }, 80);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
      process.stdout.write(`${CLEAR_LINE}${CURSOR_SHOW}`);
    }
  }

  private shutdown(): void {
    this.stopSpinner();
    if (this.mdRenderer) { this.mdRenderer.end(); this.mdRenderer = null; }
    if (this.sessionManager) this.sessionManager.close();
    if (this.memoryManager) this.memoryManager.close();
    process.stdout.write(`\n${GRAY}Goodbye.${RESET}\n`);
    process.exit(0);
  }
}

export async function startChat(): Promise<void> {
  const config = loadConfig();
  initDatabase(config.dbPath);
  const chat = new InteractiveChat(config);
  await chat.start();
}
