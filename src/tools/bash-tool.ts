import { exec } from 'child_process';
import { ToolDefinition, SafetyLevel } from '../core/types.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { maskPII } from '../core/tool-executor.js';

export interface BashExecuteParams {
  command: string;
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export function createBashTool(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: 'bash_execute',
      description: 'Execute a shell command with timeout and output capture',
      safetyLevel: 'need_confirmation' as SafetyLevel,
      params: [
        { name: 'command', type: 'string', required: true, description: 'Shell command to execute' },
        { name: 'cwd', type: 'string', required: false, description: 'Working directory' },
        { name: 'timeout', type: 'number', required: false, description: 'Timeout in ms (default 30000)' },
        { name: 'env', type: 'object', required: false, description: 'Additional environment variables' },
      ],
    },
    execute: async (params) => {
      const p = params as unknown as BashExecuteParams;
      const timeout = p.timeout || 30000;

      return new Promise((resolve, reject) => {
        const child = exec(
          p.command,
          {
            cwd: p.cwd,
            timeout,
            maxBuffer: 1024 * 1024, // 1MB
            env: p.env ? { ...process.env, ...p.env } : process.env,
          },
          (error, stdout, stderr) => {
            const out = maskPII(stdout?.toString() || '');
            const err = maskPII(stderr?.toString() || '');
            const exitCode = error ? (error as any).code || 1 : 0;

            let result = `Exit code: ${exitCode}\n`;
            if (out) result += `\n[stdout]\n${out}\n`;
            if (err) result += `\n[stderr]\n${err}\n`;

            if (error && error.killed) {
              result += `\n[TIMEOUT] Command timed out after ${timeout}ms`;
            }

            resolve(result);
          }
        );
      });
    },
  });
}
