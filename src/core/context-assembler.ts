import { Message, ModelConfig, ToolDefinition } from './types.js';
import { ToolRegistry } from './tool-registry.js';
import { LSPClient } from './lsp-client.js';

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
- Read files before modifying them
- Write unit tests for all commission calculations
- Validate inputs on all API endpoints
- Encrypt PII data (HKID, policy numbers, medical data)
- Every change must pass compliance checks
- Commission formula changes require audit trail entries
- Be concise, no filler words
- Fix errors immediately when detected

### Constraints
- All commission calculations must have unit tests
- APIs must have input validation
- PII data must be encrypted
- Changes must pass compliance check
- Never modify production data without approval`;
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
