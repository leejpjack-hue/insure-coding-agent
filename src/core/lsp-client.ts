import { exec, spawn, ChildProcess } from 'child_process';
import { LSPDiagnostic } from './types.js';
import { eventBus } from './events.js';
import path from 'path';

interface LSPRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class LSPClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending: Map<number, LSPRequest> = new Map();
  private buffer = '';
  private diagnostics: Map<string, LSPDiagnostic[]> = new Map();
  private rootPath: string;
  private serverCommand: string;
  private serverArgs: string[];

  constructor(rootPath: string, serverCommand = 'npx', serverArgs = ['typescript-language-server', '--stdio']) {
    this.rootPath = rootPath;
    this.serverCommand = serverCommand;
    this.serverArgs = serverArgs;
  }

  async start(): Promise<void> {
    this.process = spawn(this.serverCommand, this.serverArgs, {
      cwd: this.rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      this.processBuffer();
    });

    this.process.stderr!.on('data', (chunk: Buffer) => {
      // LSP servers sometimes log to stderr
    });

    this.process.on('error', (err) => {
      console.error('LSP process error:', err);
    });

    // Initialize
    await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri: `file://${this.rootPath}`,
      capabilities: {
        textDocument: {
          diagnostic: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
        },
      },
    });

    // Send initialized notification
    this.sendNotification('initialized', {});
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.sendNotification('shutdown', {});
      this.sendNotification('exit', {});
      this.process.kill();
      this.process = null;
    }
  }

  async getDiagnostics(filePath: string): Promise<LSPDiagnostic[]> {
    const absPath = path.resolve(filePath);
    const cached = this.diagnostics.get(absPath);
    if (cached) return cached;

    // Request diagnostics
    await this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: `file://${absPath}`,
        languageId: 'typescript',
        version: 1,
        text: '',
      },
    });

    return this.diagnostics.get(absPath) || [];
  }

  async hover(filePath: string, line: number, column: number): Promise<unknown> {
    return this.sendRequest('textDocument/hover', {
      textDocument: { uri: `file://${path.resolve(filePath)}` },
      position: { line: line - 1, character: column - 1 },
    });
  }

  async definition(filePath: string, line: number, column: number): Promise<unknown> {
    return this.sendRequest('textDocument/definition', {
      textDocument: { uri: `file://${path.resolve(filePath)}` },
      position: { line: line - 1, character: column - 1 },
    });
  }

  async references(filePath: string, line: number, column: number): Promise<unknown> {
    return this.sendRequest('textDocument/references', {
      textDocument: { uri: `file://${path.resolve(filePath)}` },
      position: { line: line - 1, character: column - 1 },
      context: { includeDeclaration: true },
    });
  }

  notifyFileChange(filePath: string, content: string): void {
    const absPath = path.resolve(filePath);
    this.sendNotification('textDocument/didChange', {
      textDocument: { uri: `file://${absPath}`, version: Date.now() },
      contentChanges: [{ text: content }],
    });
  }

  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('LSP not started'));
        return;
      }

      const id = ++this.requestId;
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;

      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timeout: ${method}`));
      }, 10000);

      this.pending.set(id, { resolve, reject, timeout });
      this.process.stdin.write(header + message);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin) return;
    const message = JSON.stringify({ jsonrpc: '2.0', method, params });
    const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
    this.process.stdin.write(header + message);
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.substring(0, headerEnd);
      const match = header.match(/Content-Length: (\d+)/);
      if (!match) break;

      const contentLength = parseInt(match[1]);
      const messageStart = headerEnd + 4;
      if (this.buffer.length < messageStart + contentLength) break;

      const messageStr = this.buffer.substring(messageStart, messageStart + contentLength);
      this.buffer = this.buffer.substring(messageStart + contentLength);

      try {
        const message = JSON.parse(messageStr);
        this.handleMessage(message);
      } catch {
        // Skip malformed messages
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    // Response to a request
    if (message.id && this.pending.has(message.id as number)) {
      const pending = this.pending.get(message.id as number)!;
      this.pending.delete(message.id as number);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(String(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    // Diagnostics notification
    if (message.method === 'textDocument/publishDiagnostics') {
      const params = message.params as { uri: string; diagnostics: Array<{ range: { start: { line: number } }; message: string; severity: number; code?: string }> };
      const filePath = params.uri.replace('file://', '');
      const diags: LSPDiagnostic[] = params.diagnostics.map(d => ({
        severity: d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info',
        message: d.message,
        file: filePath,
        line: d.range.start.line + 1,
        code: String(d.code || ''),
      }));

      this.diagnostics.set(filePath, diags);
      eventBus.emit({ type: 'lsp_diagnostic', file: filePath, diagnostics: diags });
    }
  }
}
