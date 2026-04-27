import { SafetyLevel } from './types.js';

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation: boolean;
}

const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+(-rf?|-fr?)\s+[\/~]/, reason: 'Destructive rm command targeting root or home' },
  { pattern: /drop\s+(table|database|schema)/i, reason: 'SQL DROP statement' },
  { pattern: /truncate\s+table/i, reason: 'SQL TRUNCATE statement' },
  { pattern: /shutdown|reboot/i, reason: 'System shutdown/reboot command' },
  { pattern: /mkfs/i, reason: 'Filesystem format command' },
  { pattern: /dd\s+if=/i, reason: 'Disk dump command' },
  { pattern: /:\(\)\{.*\|.*&\}/, reason: 'Fork bomb pattern' },
  { pattern: />\s*\/dev\/sd/i, reason: 'Writing directly to disk device' },
];

const PII_PATTERNS = [
  { pattern: /[A-Z]{1,2}\d{6}[A-Z0-9]?/, type: 'HKID' },
  { pattern: /\d{3}-\d{3}-\d{3}/, type: 'SSN-like' },
];

export class SafetyManager {
  private autoApproveTools: Set<string>;
  private needConfirmationTools: Set<string>;
  private deniedTools: Set<string>;

  constructor() {
    this.autoApproveTools = new Set(['file_read', 'code_search', 'git']);
    this.needConfirmationTools = new Set(['file_write', 'file_edit', 'bash_execute']);
    this.deniedTools = new Set();
  }

  checkTool(toolName: string, params: Record<string, unknown>): SafetyCheckResult {
    // Explicitly denied
    if (this.deniedTools.has(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" is denied`, requiresConfirmation: false };
    }

    // Check for dangerous commands in bash
    if (toolName === 'bash_execute') {
      const cmd = String(params.command || '');
      for (const { pattern, reason } of DANGEROUS_PATTERNS) {
        if (pattern.test(cmd)) {
          return { allowed: false, reason, requiresConfirmation: false };
        }
      }
    }

    // Check PII in params
    const paramsStr = JSON.stringify(params);
    for (const { pattern, type } of PII_PATTERNS) {
      if (pattern.test(paramsStr)) {
        return {
          allowed: true,
          reason: `Warning: Possible ${type} detected in parameters`,
          requiresConfirmation: true,
        };
      }
    }

    // Check safety level
    if (this.autoApproveTools.has(toolName)) {
      return { allowed: true, requiresConfirmation: false };
    }

    if (this.needConfirmationTools.has(toolName)) {
      return { allowed: true, requiresConfirmation: true };
    }

    // Unknown tools need confirmation
    return { allowed: true, requiresConfirmation: true };
  }

  denyTool(toolName: string): void {
    this.deniedTools.add(toolName);
  }

  allowTool(toolName: string): void {
    this.deniedTools.delete(toolName);
    this.autoApproveTools.add(toolName);
  }

  setToolSafetyLevel(toolName: string, level: SafetyLevel): void {
    this.autoApproveTools.delete(toolName);
    this.needConfirmationTools.delete(toolName);
    this.deniedTools.delete(toolName);

    switch (level) {
      case 'auto_approve': this.autoApproveTools.add(toolName); break;
      case 'need_confirmation': this.needConfirmationTools.add(toolName); break;
      case 'deny': this.deniedTools.add(toolName); break;
    }
  }
}
