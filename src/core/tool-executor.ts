import { ToolResult, ToolCall } from './types.js';
import path from 'path';
import { ToolRegistry } from './tool-registry.js';
import { CheckpointManager } from './checkpoint.js';
import { eventBus } from './events.js';

const HKID_REGEX = /[A-Z]{1,2}\d{6}[A-Z0-9]?/g;
const PHONE_REGEX = /(\+?852[-\s]?)?\d{4}[-\s]?\d{4}/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const POLICY_REGEX = /[A-Z]{2,4}\d{6,10}/g;
const DANGEROUS_COMMANDS = ['rm -rf', 'rm -r /', 'drop table', 'drop database', 'truncate table', 'shutdown', 'reboot', 'mkfs', 'dd if=', ':(){:|:&};:', '> /dev/sda'];

export interface ExecutorOptions {
  sessionId: string;
  projectRoot: string;
  registry: ToolRegistry;
  checkpointManager: CheckpointManager;
  requireConfirmation?: (toolName: string, params: Record<string, unknown>) => Promise<boolean>;
}

export class ToolExecutor {
  private registry: ToolRegistry;
  private checkpointManager: CheckpointManager;
  private sessionId: string;
  private projectRoot: string;
  private requireConfirmation?: (toolName: string, params: Record<string, unknown>) => Promise<boolean>;

  constructor(opts: ExecutorOptions) {
    this.registry = opts.registry;
    this.checkpointManager = opts.checkpointManager;
    this.sessionId = opts.sessionId;
    this.projectRoot = path.resolve(opts.projectRoot);
    this.requireConfirmation = opts.requireConfirmation;
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    const callId = toolCall.id;

    // 1. Check tool exists
    const tool = this.registry.get(toolCall.name);
    if (!tool) {
      return {
        callId,
        status: 'error',
        content: `Tool "${toolCall.name}" not found`,
        duration: Date.now() - start,
      };
    }

    // 2. Validate params
    const validation = this.registry.validateParams(toolCall.name, toolCall.params);
    if (!validation.valid) {
      return {
        callId,
        status: 'error',
        content: `Invalid params: ${validation.errors.join(', ')}`,
        duration: Date.now() - start,
      };
    }

    // 3. Sandbox — reject paths outside project root
    const pathViolation = this.checkPathSandbox(toolCall);
    if (pathViolation) {
      return { callId, status: 'denied', content: pathViolation, duration: Date.now() - start };
    }

    // 4. Safety check — dangerous commands
    if (toolCall.name === 'bash_execute') {
      const cmd = String(toolCall.params.command || '');
      if (isDangerousCommand(cmd)) {
        if (this.requireConfirmation) {
          const approved = await this.requireConfirmation(toolCall.name, toolCall.params);
          if (!approved) {
            return { callId, status: 'denied', content: 'User denied dangerous command', duration: Date.now() - start };
          }
        } else {
          return { callId, status: 'denied', content: `Dangerous command detected: "${cmd}". Requires confirmation.`, duration: Date.now() - start };
        }
      }
    }

    // 5. Safety check — need_confirmation level
    if (tool.definition.safetyLevel === 'need_confirmation' && this.requireConfirmation) {
      const approved = await this.requireConfirmation(toolCall.name, toolCall.params);
      if (!approved) {
        return { callId, status: 'denied', content: 'User denied this operation', duration: Date.now() - start };
      }
    }

    // 6. Save checkpoint before execution
    const filesToSnapshot = extractFilePaths(toolCall);
    if (filesToSnapshot.length > 0) {
      this.checkpointManager.createCheckpoint(
        this.sessionId,
        0, // iteration set by agent loop
        filesToSnapshot,
        this.projectRoot,
        `Before ${toolCall.name}`
      );
    }

    // 7. Execute
    try {
      const timeout = typeof toolCall.params.timeout === 'number' ? toolCall.params.timeout : 30000;
      const result = await withTimeout(tool.execute(toolCall.params), timeout);

      const content = typeof result === 'string' ? maskPII(result) : maskPII(JSON.stringify(result));

      const toolResult: ToolResult = {
        callId,
        status: 'success',
        content,
        duration: Date.now() - start,
      };

      eventBus.emit({ type: 'tool_executed', tool: toolCall.name, result: toolResult });
      return toolResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const toolResult: ToolResult = {
        callId,
        status: 'error',
        content: maskPII(msg),
        duration: Date.now() - start,
      };

      eventBus.emit({ type: 'tool_executed', tool: toolCall.name, result: toolResult });
      return toolResult;
    }
  }

  /** Reject file/bash operations that target paths outside the project root.
   *  Also normalises relative paths to absolute paths rooted at projectRoot. */
  private checkPathSandbox(toolCall: ToolCall): string | null {
    const root = normalizePath(this.projectRoot);

    // File tools: validate and normalise path parameters
    const filePaths = ['path', 'filePath', 'dir'] as const;
    for (const key of filePaths) {
      const raw = toolCall.params[key];
      if (typeof raw === 'string' && raw.length > 0) {
        const resolved = normalizePath(path.resolve(this.projectRoot, raw));
        if (!isInside(resolved, root)) {
          return `Access denied: path "${raw}" resolves to "${resolved}", which is outside the project root "${root}".`;
        }
        // Normalise so the tool receives an absolute path within projectRoot
        toolCall.params[key] = resolved;
      }
    }

    // Bash: validate cwd parameter
    if (toolCall.name === 'bash_execute' && typeof toolCall.params.cwd === 'string') {
      const resolved = normalizePath(path.resolve(this.projectRoot, toolCall.params.cwd));
      if (!isInside(resolved, root)) {
        return `Access denied: cwd "${toolCall.params.cwd}" is outside the project root "${root}".`;
      }
    }

    return null;
  }
}

function isDangerousCommand(cmd: string): boolean {
  const lower = cmd.toLowerCase().trim();
  return DANGEROUS_COMMANDS.some(d => lower.includes(d));
}

/** Normalize a path for cross-platform comparison:
 *  - Replace backslashes with forward slashes (Windows)
 *  - Lowercase for case-insensitive filesystems (macOS, Windows)
 *  - Resolve common macOS symlinks (/tmp → /private/tmp, /var → /private/var) */
function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, '/');
  // macOS symlinks: /tmp → /private/tmp, /var → /private/var
  if (process.platform === 'darwin') {
    if (normalized.startsWith('/tmp/') || normalized === '/tmp') {
      normalized = normalized.replace('/tmp', '/private/tmp');
    }
    if (normalized.startsWith('/var/') || normalized === '/var') {
      normalized = normalized.replace('/var', '/private/var');
    }
  }
  return normalized;
}

function isInside(target: string, root: string): boolean {
  const a = normalizePath(target).toLowerCase();
  const b = normalizePath(root).toLowerCase();
  if (a === b) return true;
  // Check if target starts with root + separator
  if (a.startsWith(b + '/')) return true;
  // Fallback: use path.relative for edge cases
  const rel = path.relative(root, target);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function maskPII(text: string): string {
  return text
    .replace(HKID_REGEX, '[HKID_REDACTED]')
    .replace(EMAIL_REGEX, '[EMAIL_REDACTED]')
    .replace(PHONE_REGEX, '[PHONE_REDACTED]')
    .replace(POLICY_REGEX, (match) => match.length >= 8 ? '[POLICY_REDACTED]' : match);
}

function extractFilePaths(toolCall: ToolCall): string[] {
  const paths: string[] = [];
  if (typeof toolCall.params.path === 'string') paths.push(toolCall.params.path);
  if (typeof toolCall.params.filePath === 'string') paths.push(toolCall.params.filePath);
  if (typeof toolCall.params.cwd === 'string') paths.push(toolCall.params.cwd);
  return paths.filter(p => !p.startsWith('/')); // only relative paths
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}
