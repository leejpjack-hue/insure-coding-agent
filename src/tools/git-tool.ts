import { exec } from 'child_process';
import { ToolDefinition, SafetyLevel } from '../core/types.js';
import { ToolRegistry } from '../core/tool-registry.js';

export interface GitParams {
  action: 'status' | 'diff' | 'log' | 'add' | 'commit' | 'branch' | 'checkout';
  args?: string[];
  cwd?: string;
}

export function createGitTool(registry: ToolRegistry): void {
  registry.register({
    definition: {
      name: 'git',
      description: 'Execute git operations (status, diff, log, add, commit, branch, checkout)',
      safetyLevel: 'auto_approve' as SafetyLevel,
      params: [
        { name: 'action', type: 'string', required: true, description: 'Git action to perform' },
        { name: 'args', type: 'array', required: false, description: 'Additional arguments' },
        { name: 'cwd', type: 'string', required: false, description: 'Working directory' },
      ],
    },
    execute: async (params) => {
      const p = params as unknown as GitParams;
      const cwd = p.cwd || process.cwd();
      const args = (p.args || []).join(' ');

      const commandMap: Record<string, string> = {
        status: 'git status --porcelain',
        diff: `git diff ${args}`,
        log: `git log --oneline -${args || '20'}`,
        add: `git add ${args || '-A'}`,
        commit: `git commit -m ${args ? `"${args}"` : '"auto-commit"'}`,
        branch: `git branch ${args || '-a'}`,
        checkout: `git checkout ${args}`,
      };

      const cmd = commandMap[p.action];
      if (!cmd) {
        throw new Error(`Unknown git action: ${p.action}. Supported: ${Object.keys(commandMap).join(', ')}`);
      }

      return new Promise((resolve, reject) => {
        exec(cmd, { cwd, timeout: 10000 }, (error, stdout, stderr) => {
          if (error && !stdout) {
            reject(new Error(`git ${p.action} failed: ${stderr || error.message}`));
            return;
          }
          const output = (stdout || '') + (stderr ? `\n[stderr] ${stderr}` : '');
          resolve(output.trim() || `git ${p.action} completed (no output)`);
        });
      });
    },
  });
}
