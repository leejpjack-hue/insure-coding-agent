import { Message, ModelConfig, ToolDefinition } from './types.js';
import { ToolRegistry } from './tool-registry.js';
import { LSPClient } from './lsp-client.js';
import fs from 'fs';
import path from 'path';

export interface ContextOptions {
  sessionId: string;
  projectRoot: string;
  task: string;
  history: Message[];
  registry: ToolRegistry;
  lspClient?: LSPClient;
  amsContext?: string;
}

export class ContextAssembler {
  assemble(opts: ContextOptions): string {
    const sections: string[] = [];

    sections.push(this.buildSystemPrompt());
    sections.push(this.buildProjectContext(opts.projectRoot));
    sections.push(this.buildAgentMd(opts.projectRoot));
    sections.push(this.buildToolList(opts.registry));
    sections.push(this.buildConversationHistory(opts.history));
    sections.push(this.buildCurrentTask(opts.task));

    if (opts.lspClient) {
      sections.push(this.buildLSPContext());
    }

    if (opts.amsContext) {
      sections.push(`\n## AMS Domain Context\n${opts.amsContext}`);
    }

    return sections.join('\n\n');
  }

  /** Load AGENT.MD from the project root (case-insensitive). */
  private buildAgentMd(projectRoot: string): string {
    const candidates = ['AGENT.MD', 'agent.md', 'Agent.md'];
    for (const name of candidates) {
      const fullPath = path.join(projectRoot, name);
      try {
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8').trim();
          if (content) {
            return `## AGENT.MD (Project Instructions)\n${content}`;
          }
        }
      } catch { /* ignore unreadable files */ }
    }
    return '';
  }

  private buildSystemPrompt(): string {
    return `## System Prompt
You are InsureAgent, an expert coding agent specializing in Insurance Agency Management Systems (AMS).

### Role
You help IT teams develop, maintain, and optimize AMS software. You understand insurance domain deeply.

### Domain Knowledge
- Commission calculations: flat rate, tiered, override, bonus, renewal structures
- Agent licensing: registration, renewal, suspension, continuing education requirements
- Insurance products: Life, Health, Property, Motor, Travel, Group Life, Group Health
- Team hierarchy: Agent → Unit Manager → Branch Manager → Regional Director
- Compliance: HK IA GL20/21, Solvency II, IFRS 17, MAS, PDPO/GDPR
- Regulatory jurisdictions: HK, SG, EU, US

### Working Style
- ALWAYS read files before modifying them (use file_read first)
- When editing existing files, use file_edit (NOT file_write) — this gives a precise, reviewable diff
- Only use file_write for creating brand-new files that don't exist yet
- Write unit tests for all commission calculations
- Validate inputs on all API endpoints
- Encrypt PII data (HKID, policy numbers, medical data)
- Every change must pass compliance checks
- Commission formula changes require audit trail entries
- Be concise, no filler words
- Fix errors immediately when detected

### Mandatory Workflow (Design-First)
Every feature request, change, or new implementation MUST follow this strict sequence. Do NOT skip steps.

**Step 1 — Design Document**
Before writing ANY implementation code, produce a design document:
- Save to \`docs/designs/<feature-name>.md\`
- Include: Overview, Requirements, Data Model, API Endpoints, UI Screens, Validation Rules, Edge Cases, Non-Functional Requirements
- Present the design to the user for review before proceeding

**Step 2 — JIRA Requirement Files**
For every design document, generate requirement files:
- Save to \`docs/requirements/<feature-name>/\`
- One file per requirement: \`REQ-<NNN>-<title>.md\`
- Each file contains: ID, Title, Description, Acceptance Criteria (Gherkin Given/When/Then), Priority, Story Points
- Include a summary file \`docs/requirements/<feature-name>/BACKLOG.md\` listing all requirements for JIRA import

**Step 3 — Test Case Files**
For each requirement file, generate corresponding test cases:
- Save to \`docs/test-cases/<feature-name>/\`
- One file per requirement: \`TC-<NNN>-<title>.md\`
- Each file contains: Test Case ID, Linked Requirement ID, Pre-conditions, Test Steps, Expected Results, Test Data

**Step 4 — Implementation**
Only after Steps 1-3 are complete and the user approves the design:
- Implement the code changes
- Write automated tests
- Verify compliance

### Constraints
- All commission calculations must have unit tests
- APIs must have input validation
- PII data must be encrypted
- Changes must pass compliance check
- Never modify production data without approval
- NEVER implement code without first producing a design document (Step 1)
- NEVER implement code without first producing requirement files (Step 2)
- NEVER implement code without first producing test case files (Step 3)`;
  }

  private buildProjectContext(projectRoot: string): string {
    return `## Project Context
Project root: ${projectRoot}
Current working directory: ${process.cwd()}
Node.js: ${process.version}
Platform: ${process.platform}`;
  }

  private buildToolList(registry: ToolRegistry): string {
    const tools = registry.list();
    const lines = tools.map(t => {
      const params = t.params.map(p => `    ${p.name}: ${p.type}${p.required ? ' (required)' : ''} — ${p.description}`).join('\n');
      return `- ${t.name} [${t.safetyLevel}]: ${t.description}\n${params}`;
    });
    return `## Available Tools\n${lines.join('\n')}`;
  }

  private buildConversationHistory(messages: Message[]): string {
    if (messages.length === 0) return '## Conversation History\n(empty)';
    const lines = messages.slice(-20).map(m => {
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content;
      let line = `[${m.role}] ${content}`;
      if (m.toolCall) line += `\n  Tool call: ${m.toolCall.name}(${JSON.stringify(m.toolCall.params).substring(0, 200)})`;
      if (m.toolResult) line += `\n  Tool result: [${m.toolResult.status}] ${m.toolResult.content.substring(0, 200)}`;
      return line;
    });
    return `## Conversation History\n${lines.join('\n')}`;
  }

  private buildCurrentTask(task: string): string {
    return `## Current Task\n${task}`;
  }

  private buildLSPContext(): string {
    return `## LSP Status\nLanguage server connected. Diagnostics available on file changes.`;
  }
}
