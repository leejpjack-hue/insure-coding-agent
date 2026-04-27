import fs from 'fs';
import path from 'path';
import { ToolDefinition, SafetyLevel } from '../core/types.js';
import { ToolRegistry } from '../core/tool-registry.js';

export interface FileReadParams {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface FileWriteParams {
  path: string;
  content: string;
  createDirs?: boolean;
}

export interface FileEditParams {
  path: string;
  oldContent: string;
  newContent: string;
}

export interface CodeSearchParams {
  query: string;
  dir?: string;
  fileType?: string;
  maxResults?: number;
}

export function createFileTools(registry: ToolRegistry): void {
  // file_read
  registry.register({
    definition: {
      name: 'file_read',
      description: 'Read file content with optional line range',
      safetyLevel: 'auto_approve' as SafetyLevel,
      params: [
        { name: 'path', type: 'string', required: true, description: 'File path relative to project root' },
        { name: 'startLine', type: 'number', required: false, description: 'Start line (1-based)' },
        { name: 'endLine', type: 'number', required: false, description: 'End line (inclusive)' },
      ],
    },
    execute: async (params) => {
      const p = params as unknown as FileReadParams;
      const fullPath = path.resolve(p.path);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${p.path}`);
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const start = (p.startLine || 1) - 1;
      const end = p.endLine || lines.length;
      const selected = lines.slice(start, end);
      return `File: ${p.path} (lines ${start + 1}-${end} of ${lines.length})\n${selected.join('\n')}`;
    },
  });

  // file_write
  registry.register({
    definition: {
      name: 'file_write',
      description: 'Write content to file, creating directories if needed',
      safetyLevel: 'need_confirmation' as SafetyLevel,
      params: [
        { name: 'path', type: 'string', required: true, description: 'File path relative to project root' },
        { name: 'content', type: 'string', required: true, description: 'Content to write' },
        { name: 'createDirs', type: 'boolean', required: false, description: 'Create parent directories' },
      ],
    },
    execute: async (params) => {
      const p = params as unknown as FileWriteParams;
      const fullPath = path.resolve(p.path);
      if (p.createDirs) {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      }
      fs.writeFileSync(fullPath, p.content, 'utf-8');
      return `Written ${p.content.length} bytes to ${p.path}`;
    },
  });

  // file_edit
  registry.register({
    definition: {
      name: 'file_edit',
      description: 'Edit file by replacing old content with new content',
      safetyLevel: 'need_confirmation' as SafetyLevel,
      params: [
        { name: 'path', type: 'string', required: true, description: 'File path' },
        { name: 'oldContent', type: 'string', required: true, description: 'Exact text to find' },
        { name: 'newContent', type: 'string', required: true, description: 'Replacement text' },
      ],
    },
    execute: async (params) => {
      const p = params as unknown as FileEditParams;
      const fullPath = path.resolve(p.path);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${p.path}`);
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      const idx = content.indexOf(p.oldContent);
      if (idx === -1) {
        throw new Error(`oldContent not found in ${p.path}`);
      }
      const count = content.split(p.oldContent).length - 1;
      if (count > 1) {
        throw new Error(`oldContent found ${count} times in ${p.path}, must be unique`);
      }
      const newContent = content.substring(0, idx) + p.newContent + content.substring(idx + p.oldContent.length);
      fs.writeFileSync(fullPath, newContent, 'utf-8');
      return `Edited ${p.path}: replaced ${p.oldContent.length} chars with ${p.newContent.length} chars`;
    },
  });

  // code_search
  registry.register({
    definition: {
      name: 'code_search',
      description: 'Search for text in files using substring matching',
      safetyLevel: 'auto_approve' as SafetyLevel,
      params: [
        { name: 'query', type: 'string', required: true, description: 'Search text' },
        { name: 'dir', type: 'string', required: false, description: 'Directory to search (default: project root)' },
        { name: 'fileType', type: 'string', required: false, description: 'File extension filter (e.g. "ts")' },
        { name: 'maxResults', type: 'number', required: false, description: 'Max results (default 20)' },
      ],
    },
    execute: async (params) => {
      const p = params as unknown as CodeSearchParams;
      const searchDir = p.dir ? path.resolve(p.dir) : process.cwd();
      const maxResults = p.maxResults || 20;
      const results: string[] = [];

      function searchFiles(dir: string): void {
        if (results.length >= maxResults) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (results.length >= maxResults) break;
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            searchFiles(fullPath);
          } else if (entry.isFile()) {
            if (p.fileType && !entry.name.endsWith(`.${p.fileType}`)) continue;
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                if (lines[i].toLowerCase().includes(p.query.toLowerCase())) {
                  const relPath = path.relative(searchDir, fullPath);
                  results.push(`${relPath}:${i + 1}: ${lines[i].trim()}`);
                }
              }
            } catch { /* skip unreadable files */ }
          }
        }
      }

      searchFiles(searchDir);
      return results.length > 0
        ? `Found ${results.length} matches:\n${results.join('\n')}`
        : `No matches found for "${p.query}"`;
    },
  });
}
