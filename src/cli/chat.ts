#!/usr/bin/env node
import "../core/env.js";
import * as readline from 'node:readline';
import { loadConfig } from '../core/config.js';
import { initDatabase } from '../core/database.js';
import { AgentLoop, AgentEvent } from '../core/agent-loop.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { SessionManager } from '../core/session.js';
import { ModelRouter } from '../core/model-router.js';
import { createFileTools } from '../tools/file-tools.js';
import { createBashTool } from '../tools/bash-tool.js';
import { createGitTool } from '../tools/git-tool.js';
import { createCommissionTool } from '../tools/commission-validator.js';
import { createLicenseChecker } from '../tools/license-checker.js';
import { createSchemaReader } from '../tools/schema-reader.js';
import { createApiTester } from '../tools/api-tester.js';
import { createComplianceChecker } from '../tools/compliance-checker.js';
import { ModelConfig } from '../core/types.js';
import { MarkdownRenderer } from './markdown.js';

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
  createGitTool(registry);
  createCommissionTool(registry);
  createLicenseChecker(registry);
  createSchemaReader(registry);
  createApiTester(registry);
  createComplianceChecker(registry);
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

  constructor(private config: ReturnType<typeof loadConfig>) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${BOLD}${CYAN}❯${RESET} `,
    });

    this.registry = setupRegistry();
    this.sessionManager = new SessionManager(config.dbPath);
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
      if (input === '/steps') {
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
      if (input === '/model') {
        process.stdout.write(`${GRAY}Current model:${RESET} ${BOLD}${this.modelConfig.model}${RESET} ${GRAY}(${this.modelConfig.provider})${RESET}\n`);
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
    process.stdout.write(`  ${CYAN}/steps${RESET}       List all tool-call steps in this session\n`);
    process.stdout.write(`  ${CYAN}/show N${RESET}      Expand step N (full output)\n`);
    process.stdout.write(`  ${CYAN}/last${RESET}        Expand the most recent step\n`);
    process.stdout.write(`  ${CYAN}/model${RESET}       Show current model/provider\n`);
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
        process.stdout.write(`\n${CYAN}${BOLD}▸${RESET} ${BOLD}#${stepNum}${RESET} ${CYAN}${event.name}${RESET}${GRAY}${paramStr}${RESET}\n`);
        this.startSpinner(`  Running ${event.name}`);
        break;
      }

      case 'tool_result': {
        this.stopSpinner();
        const icon = event.status === 'success' ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
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
