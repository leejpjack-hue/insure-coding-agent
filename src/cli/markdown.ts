// Streaming-friendly terminal markdown renderer.
//
// Designed for chat output: takes character chunks via push() and writes ANSI-
// styled text to stdout. Buffers each line until a newline is seen so the
// per-line markdown constructs (headings, lists, code fences, blockquotes) can
// be detected. Inline constructs (**bold**, *italic*, `code`, [link](url)) are
// rewritten on flush.
//
// We deliberately do NOT use a full Markdown library — keeps the project zero
// extra deps and gives precise control over which constructs we render.

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  brightCyan: '\x1b[96m',
  bgGray: '\x1b[48;5;236m',
};

export interface MarkdownRendererOptions {
  write?: (s: string) => void;
  /** Width hint for soft line wrapping; falls back to terminal width. */
  width?: number;
}

export class MarkdownRenderer {
  private buffer = '';
  private inFence = false;
  private fenceLang = '';
  private write: (s: string) => void;
  private listIndent = 0;

  constructor(opts: MarkdownRendererOptions = {}) {
    this.write = opts.write ?? ((s) => process.stdout.write(s));
  }

  /** Push raw markdown chars from the model. Renders complete lines as they arrive. */
  push(text: string): void {
    this.buffer += text;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      this.renderLine(line);
      this.write('\n');
    }
  }

  /** Flush any unterminated line (call at text_end). */
  end(): void {
    if (this.buffer.length > 0) {
      this.renderLine(this.buffer);
      this.write('\n');
      this.buffer = '';
    }
    if (this.inFence) {
      this.inFence = false;
      this.fenceLang = '';
    }
  }

  /** Render a fully-formed markdown blob (no streaming). */
  renderBlock(text: string): void {
    for (const line of text.split('\n')) {
      this.renderLine(line);
      this.write('\n');
    }
    this.end();
  }

  // === internals ===========================================================

  private renderLine(raw: string): void {
    const fence = raw.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      if (this.inFence) {
        this.write(`${ANSI.gray}${'─'.repeat(40)}${ANSI.reset}`);
        this.inFence = false;
        this.fenceLang = '';
      } else {
        this.inFence = true;
        this.fenceLang = fence[1] || '';
        const label = this.fenceLang ? ` ${this.fenceLang} ` : '';
        this.write(`${ANSI.gray}─── ${ANSI.cyan}${label}${ANSI.gray} ${'─'.repeat(Math.max(0, 35 - label.length))}${ANSI.reset}`);
      }
      return;
    }

    if (this.inFence) {
      this.write(`${ANSI.cyan}│${ANSI.reset} ${ANSI.brightCyan}${raw}${ANSI.reset}`);
      return;
    }

    // Headings
    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const txt = this.renderInline(h[2]);
      const colour = level <= 2 ? ANSI.cyan : ANSI.blue;
      this.write(`${colour}${ANSI.bold}${'▌'.repeat(1)} ${txt}${ANSI.reset}`);
      return;
    }

    // Horizontal rule
    if (/^\s*([-*_])\s*\1\s*\1\s*$/.test(raw)) {
      this.write(`${ANSI.gray}${'─'.repeat(40)}${ANSI.reset}`);
      return;
    }

    // Block quote
    const bq = raw.match(/^\s*>\s?(.*)$/);
    if (bq) {
      this.write(`${ANSI.gray}┃${ANSI.reset} ${ANSI.dim}${this.renderInline(bq[1])}${ANSI.reset}`);
      return;
    }

    // Unordered list
    const ul = raw.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ul) {
      const indent = ul[1];
      const txt = this.renderInline(ul[3]);
      this.write(`${indent}${ANSI.cyan}•${ANSI.reset} ${txt}`);
      return;
    }

    // Ordered list
    const ol = raw.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (ol) {
      const indent = ol[1];
      const num = ol[2];
      const txt = this.renderInline(ol[3]);
      this.write(`${indent}${ANSI.cyan}${num}.${ANSI.reset} ${txt}`);
      return;
    }

    // Table row (very light styling — bold the header-divider rows)
    if (/^\s*\|.*\|.*\|/.test(raw)) {
      if (/^\s*\|[\s\-:|]+\|$/.test(raw)) {
        this.write(`${ANSI.gray}${raw}${ANSI.reset}`);
      } else {
        this.write(this.renderInline(raw));
      }
      return;
    }

    this.write(this.renderInline(raw));
  }

  private renderInline(line: string): string {
    let out = line;

    // Inline code first (so bold/italic don't apply inside)
    out = out.replace(/`([^`]+?)`/g, (_, code) => `${ANSI.brightCyan}${code}${ANSI.reset}`);

    // Bold (** or __)
    out = out.replace(/\*\*([^*]+?)\*\*/g, (_, t) => `${ANSI.bold}${t}${ANSI.reset}`);
    out = out.replace(/__([^_]+?)__/g, (_, t) => `${ANSI.bold}${t}${ANSI.reset}`);

    // Italic (* or _) — single, after bold so we don't eat it
    out = out.replace(/(?<![*\\])\*(?!\*)([^*\n]+?)\*(?!\*)/g, (_, t) => `${ANSI.italic}${t}${ANSI.reset}`);
    out = out.replace(/(?<![_\\])_(?!_)([^_\n]+?)_(?!_)/g, (_, t) => `${ANSI.italic}${t}${ANSI.reset}`);

    // Links: [text](url) → text (url in dim)
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) =>
      `${ANSI.underline}${text}${ANSI.reset} ${ANSI.gray}(${url})${ANSI.reset}`,
    );

    // Bare URLs
    out = out.replace(/(?<![("])(https?:\/\/[^\s)]+)/g, (_, url) =>
      `${ANSI.underline}${ANSI.blue}${url}${ANSI.reset}`,
    );

    return out;
  }
}

/** Render a finished markdown string (non-streaming). */
export function renderMarkdown(text: string): string {
  let buf = '';
  const r = new MarkdownRenderer({ write: (s) => { buf += s; } });
  r.renderBlock(text);
  return buf;
}
