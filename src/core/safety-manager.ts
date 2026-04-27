import { SafetyLevel, SafetyLimits } from './types.js';
import { eventBus } from './events.js';

export interface SafetyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation: boolean;
}

interface RateLimitEntry {
  timestamps: number[];
}

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-[rfS]+\s)*-[rfS]+\s+[\/~]/, reason: 'Destructive rm command targeting root or home directory' },
  { pattern: /rm\s+(-[rfS]+\s)*-[rfS]+\s+\*/, reason: 'Destructive rm command with wildcard' },
  { pattern: /drop\s+(table|database|schema)\s/i, reason: 'SQL DROP statement detected' },
  { pattern: /truncate\s+table/i, reason: 'SQL TRUNCATE statement detected' },
  { pattern: /delete\s+from\s+\w+\s*;/i, reason: 'SQL DELETE without WHERE clause detected' },
  { pattern: /shutdown\b|reboot\b/i, reason: 'System shutdown/reboot command detected' },
  { pattern: /mkfs\b/i, reason: 'Filesystem format command detected' },
  { pattern: /dd\s+if=/i, reason: 'Disk dump command detected' },
  { pattern: /:\(\)\s*\{.*\|.*&\s*\}/, reason: 'Fork bomb pattern detected' },
  { pattern: />\s*\/dev\/sd/i, reason: 'Writing directly to disk device detected' },
  { pattern: /chmod\s+(-R\s+)?777/i, reason: 'Setting overly permissive file permissions' },
  { pattern: /curl.*\|\s*(ba)?sh/i, reason: 'Piping curl output to shell interpreter' },
  { pattern: /wget.*\|\s*(ba)?sh/i, reason: 'Piping wget output to shell interpreter' },
  { pattern: /\b(eval|exec)\s*\(.*/i, reason: 'Dynamic code execution detected' },
  { pattern: /os\.system\s*\(/i, reason: 'OS system call detected' },
  { pattern: /subprocess\.call\s*\(/i, reason: 'Subprocess call detected' },
];

const PII_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /[A-Z]{1,2}\d{6}[A-Z0-9]?/, type: 'HKID' },
  { pattern: /\d{3}-\d{2}-\d{4}/, type: 'SSN' },
  { pattern: /\b\d{16,19}\b/, type: 'credit_card' },
];

export class SafetyManager {
  private autoApproveTools: Set<string>;
  private needConfirmationTools: Set<string>;
  private deniedTools: Set<string>;
  private rateLimits: Map<string, RateLimitEntry>;
  private maxRatePerMinute: number;
  private maxConsecutiveFails: number;
  private dangerousCommandPatterns: RegExp[];

  constructor(limits?: Partial<SafetyLimits>) {
    this.autoApproveTools = new Set([
      'file_read', 'code_search', 'git', 'schema_reader', 'api_tester',
    ]);
    this.needConfirmationTools = new Set([
      'file_write', 'file_edit', 'bash_execute', 'commission_validator', 'license_checker',
    ]);
    this.deniedTools = new Set();
    this.rateLimits = new Map();
    this.maxRatePerMinute = limits?.rateLimitPerMinute ?? 60;
    this.maxConsecutiveFails = limits?.maxConsecutiveFails ?? 5;
    this.dangerousCommandPatterns = DANGEROUS_PATTERNS.map(dp => dp.pattern);
  }

  checkTool(toolName: string, params: Record<string, unknown>): SafetyCheckResult {
    // Explicitly denied tools
    if (this.deniedTools.has(toolName)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is explicitly denied`,
        requiresConfirmation: false,
      };
    }

    // Rate limiting check
    if (!this.checkRateLimit(toolName)) {
      return {
        allowed: false,
        reason: `Rate limit exceeded for "${toolName}" (${this.maxRatePerMinute} per minute)`,
        requiresConfirmation: false,
      };
    }

    // Dangerous command detection for bash_execute
    if (toolName === 'bash_execute') {
      const cmd = String(params.command || '');
      for (const { pattern, reason } of DANGEROUS_PATTERNS) {
        if (pattern.test(cmd)) {
          eventBus.emit({
            type: 'agent_error',
            error: `Dangerous command blocked: ${reason}`,
            iteration: 0,
          });
          return {
            allowed: false,
            reason,
            requiresConfirmation: false,
          };
        }
      }
    }

    // PII detection in parameters
    const paramsStr = JSON.stringify(params);
    for (const { pattern, type } of PII_PATTERNS) {
      if (pattern.test(paramsStr)) {
        return {
          allowed: true,
          reason: `Warning: Possible ${type} detected in parameters — requires confirmation`,
          requiresConfirmation: true,
        };
      }
    }

    // Safety level check
    if (this.autoApproveTools.has(toolName)) {
      this.recordRateLimit(toolName);
      return { allowed: true, requiresConfirmation: false };
    }

    if (this.needConfirmationTools.has(toolName)) {
      this.recordRateLimit(toolName);
      return { allowed: true, requiresConfirmation: true };
    }

    // Unknown tools require confirmation by default
    this.recordRateLimit(toolName);
    return { allowed: true, requiresConfirmation: true };
  }

  denyTool(toolName: string): void {
    this.deniedTools.add(toolName);
    this.autoApproveTools.delete(toolName);
    this.needConfirmationTools.delete(toolName);
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
      case 'auto_approve':
        this.autoApproveTools.add(toolName);
        break;
      case 'need_confirmation':
        this.needConfirmationTools.add(toolName);
        break;
      case 'deny':
        this.deniedTools.add(toolName);
        break;
    }
  }

  getToolSafetyLevel(toolName: string): SafetyLevel | null {
    if (this.deniedTools.has(toolName)) return 'deny';
    if (this.needConfirmationTools.has(toolName)) return 'need_confirmation';
    if (this.autoApproveTools.has(toolName)) return 'auto_approve';
    return null;
  }

  isAutoApproved(toolName: string): boolean {
    return this.autoApproveTools.has(toolName);
  }

  isDenied(toolName: string): boolean {
    return this.deniedTools.has(toolName);
  }

  listAutoApproved(): string[] {
    return Array.from(this.autoApproveTools);
  }

  listDenied(): string[] {
    return Array.from(this.deniedTools);
  }

  listNeedingConfirmation(): string[] {
    return Array.from(this.needConfirmationTools);
  }

  reset(): void {
    this.autoApproveTools = new Set([
      'file_read', 'code_search', 'git', 'schema_reader', 'api_tester',
    ]);
    this.needConfirmationTools = new Set([
      'file_write', 'file_edit', 'bash_execute', 'commission_validator', 'license_checker',
    ]);
    this.deniedTools = new Set();
    this.rateLimits.clear();
  }

  private checkRateLimit(toolName: string): boolean {
    const entry = this.rateLimits.get(toolName);
    if (!entry) return true;

    const now = Date.now();
    const windowStart = now - 60_000;
    const recentCount = entry.timestamps.filter(ts => ts > windowStart).length;
    return recentCount < this.maxRatePerMinute;
  }

  private recordRateLimit(toolName: string): void {
    let entry = this.rateLimits.get(toolName);
    if (!entry) {
      entry = { timestamps: [] };
      this.rateLimits.set(toolName, entry);
    }

    const now = Date.now();
    entry.timestamps.push(now);

    // Prune timestamps older than 2 minutes to prevent unbounded growth
    const cutoff = now - 120_000;
    entry.timestamps = entry.timestamps.filter(ts => ts > cutoff);
  }
}
