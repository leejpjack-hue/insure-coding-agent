import { Message, ModelConfig, ToolDefinition } from './types.js';
import { ToolRegistry } from './tool-registry.js';
import { LSPClient } from './lsp-client.js';
import { getKnowledgeBase, KBHit } from '../knowledge/knowledge-base.js';
import { MemoryManager } from './memory.js';
import { SkillGenerator } from './skill-generator.js';
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
  /** Disable automatic KB retrieval (e.g. for tests). */
  skipKnowledgeRetrieval?: boolean;
  memoryManager?: MemoryManager;
  skillGenerator?: SkillGenerator;
}

export class ContextAssembler {
  assemble(opts: ContextOptions): string {
    const sections: string[] = [];

    sections.push(this.buildSystemPrompt());
    sections.push(this.buildProjectContext(opts.projectRoot));
    sections.push(this.buildAgentMd(opts.projectRoot));

    // Cross-session memory (facts + skills)
    if (opts.memoryManager) {
      const memCtx = opts.memoryManager.buildMemoryContext(opts.task);
      if (memCtx) sections.push(memCtx);
    }
    if (opts.skillGenerator) {
      const skillCtx = opts.skillGenerator.buildSkillsContext(opts.task);
      if (skillCtx) sections.push(skillCtx);
    }

    sections.push(this.buildToolList(opts.registry));
    if (!opts.skipKnowledgeRetrieval) {
      const kb = this.buildKnowledgeBaseHits(opts.task, opts.history);
      if (kb) sections.push(kb);
    }
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

  /**
   * Auto-retrieve the most relevant entries from the AMS knowledge base for
   * the current task. This is the "think like a domain expert" lever — without
   * it the model only knows what the static system prompt mentions; with it,
   * the model has structured reference material on AS400 quirks, AMS
   * compliance hot-spots, AML rules, etc., right when it's planning.
   *
   * Query is the current task plus the last user turn (catches follow-ups
   * like "now do the same for renewals" that don't repeat the topic).
   */
  private buildKnowledgeBaseHits(task: string, history: Message[]): string {
    const lastUser = [...history].reverse().find(m => m.role === 'user');
    const query = `${task}\n${lastUser?.content ?? ''}`.trim();
    if (!query) return '';

    let hits: KBHit[];
    try {
      hits = getKnowledgeBase().search(query, 5);
    } catch {
      return '';   // KB initialisation problems shouldn't kill the agent
    }
    if (hits.length === 0) return '';

    const lines = hits.map((h) => this.renderHit(h));
    return `## Relevant Domain Knowledge (auto-retrieved)\n` +
      `_The following entries from the AMS knowledge base look most relevant to this task. ` +
      `Use them when designing — they encode domain rules and compliance hot-spots that are easy to forget._\n\n` +
      lines.join('\n\n');
  }

  private renderHit(hit: KBHit): string {
    switch (hit.kind) {
      case 'system':
        return `### [System] ${hit.entry.name} (${hit.entry.id})\n` +
          `${hit.entry.summary}\n` +
          `- **Owns:** ${hit.entry.ownedEntities.slice(0, 6).join(', ')}\n` +
          `- **Integrates with:** ${hit.entry.integratesWith.slice(0, 6).join(', ')}\n` +
          `- **Compliance hot-spots:** ${hit.entry.complianceHotspots.slice(0, 3).join('; ')}\n` +
          `- **Agent caveats:** ${hit.entry.agentNotes.slice(0, 2).join('; ')}`;
      case 'knowledge':
        return `### [Knowledge] ${hit.entry.topic}\n${hit.entry.content}`;
      case 'compliance':
        return `### [Compliance] ${hit.rule.title} — ${hit.rule.reference} (${hit.rule.jurisdiction})\n` +
          `${hit.rule.description}\n→ ${hit.rule.recommendation}`;
      case 'commission':
        return `### [Commission disclosure] ${hit.rule.reference} (${hit.rule.jurisdiction})\n` +
          `Applies to: ${hit.rule.appliesTo.join(', ')}; must disclose: ${hit.rule.mustDisclose.join(', ')}`;
      case 'licensing':
        return `### [Licensing] ${hit.rule.regulator} — ${hit.rule.reference} (${hit.rule.jurisdiction})\n` +
          `Renewal cycle ${hit.rule.renewalCycleYears}y, CPD ${hit.rule.continuingEducation.annualHours}h/y.`;
      case 'pii':
        return `### [PII rule] ${hit.rule.type} (${hit.rule.severity}, ${hit.rule.jurisdictions.join('/')})\n` +
          `${hit.rule.description} → ${hit.rule.remediation}`;
    }
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
- IMPORTANT: When creating design docs or any file, call file_write EARLY. Do NOT plan the entire document content in your thinking before calling the tool. Start writing, then edit if needed. Keep thinking/reasoning brief — under 500 tokens. Prioritize ACTION over analysis.
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

**Step 2 — UI Design Document**
For every design document that involves user-facing screens, produce a detailed UI design:
- Save to \`docs/designs/<feature-name>-ui.md\`
- For each screen/page, include:
  - Screen name and purpose
  - Complete field list with: field name, label, type (text/number/dropdown/date/checkbox etc.), required/optional, default value, placeholder, max length
  - Screen flow diagram (ASCII or numbered steps): which screen leads to which, navigation paths, back/cancel behavior
  - Validation rules per field: format, range, cross-field dependencies, error messages
  - Action buttons: label, behavior, confirmation dialogs
  - State transitions: loading, empty, error, success states with messages
  - Responsive behavior: layout changes for mobile/tablet/desktop
  - Accessibility notes: ARIA labels, tab order, keyboard navigation

**Step 2.5 — Requirement Gap Analysis**
Before generating requirements, run the \`requirement_gap_analyzer\` tool:
- Call: \`requirement_gap_analyzer\` with \`content\` = the design document text (or your current understanding of the feature)
- Review the readiness score and the list of missing questions
- If readiness is below 100%, present the missing questions to the user and ask:
  - Do you want to answer these questions now, OR
  - Should the agent fill in reasonable assumptions based on insurance domain expertise?
- If the user chooses to skip, proceed with best-practice assumptions and clearly mark them as \`[Assumption]\` in the requirements
- Either way, proceed to Step 3 after this analysis

**Step 3 — JIRA Requirement Files**
For every design document, generate requirement files:
- Save to \`docs/requirements/<feature-name>/\`
- One file per requirement: \`REQ-<NNN>-<title>.md\`
- Each file contains: ID, Title, Description, Acceptance Criteria (Gherkin Given/When/Then), Priority, Story Points
- Include a summary file \`docs/requirements/<feature-name>/BACKLOG.md\` listing all requirements for JIRA import

**Step 4 — Test Case Files**
For each requirement file, generate corresponding test cases:
- Save to \`docs/test-cases/<feature-name>/\`
- One file per requirement: \`TC-<NNN>-<title>.md\`
- Each file contains: Test Case ID, Linked Requirement ID, Pre-conditions, Test Steps, Expected Results, Test Data

**Step 5 — Implementation**
Only after Steps 1-4 are complete and the user approves the design:
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
- NEVER implement code without first producing a UI design document (Step 2)
- NEVER implement code without first producing requirement files (Step 3)
- NEVER implement code without first producing test case files (Step 4)`;
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
