import fs from 'fs';
import path from 'path';

export interface MemoryFact {
  id: string;
  category: MemoryCategory;
  content: string;
  source: string;
  created_at: number;
  last_accessed: number;
  access_count: number;
}

export type MemoryCategory = 'user_preference' | 'project_fact' | 'domain_knowledge' | 'learned_pattern' | 'feedback';

interface MemoryStore {
  facts: MemoryFact[];
  version: number;
}

const MAX_FACTS = 200;
const FLUSH_DELAY_MS = 500;

export class MemoryManager {
  private filePath: string;
  private data: MemoryStore;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string) {
    this.filePath = filePath.replace(/\.db$/i, '.json');
    this.data = this.load();
  }

  private load(): MemoryStore {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw) as MemoryStore;
      }
    } catch { /* ignore corrupt file */ }
    return { facts: [], version: 1 };
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch { /* non-critical */ }
  }

  addFact(category: MemoryCategory, content: string, source: string): MemoryFact {
    // Dedup: exact content match in same category
    const existing = this.data.facts.find(
      f => f.category === category && f.content === content,
    );
    if (existing) {
      existing.last_accessed = Date.now();
      existing.access_count++;
      this.scheduleFlush();
      return existing;
    }

    const fact: MemoryFact = {
      id: `fact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      category,
      content,
      source,
      created_at: Date.now(),
      last_accessed: Date.now(),
      access_count: 1,
    };
    this.data.facts.push(fact);
    this.pruneFacts(MAX_FACTS);
    this.scheduleFlush();
    return fact;
  }

  removeFact(query: string): boolean {
    const idx = this.data.facts.findIndex(f =>
      f.id === query || f.content.toLowerCase().includes(query.toLowerCase()),
    );
    if (idx === -1) return false;
    this.data.facts.splice(idx, 1);
    this.scheduleFlush();
    return true;
  }

  queryFacts(query?: string, category?: MemoryCategory, limit = 10): MemoryFact[] {
    let results = this.data.facts;

    if (category) {
      results = results.filter(f => f.category === category);
    }

    if (query) {
      const lower = query.toLowerCase();
      const terms = lower.split(/\s+/);
      const scored = results.map(f => {
        const text = f.content.toLowerCase();
        const score = terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
        return { fact: f, score };
      });
      results = scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(s => s.fact);
    } else {
      results = [...results].sort((a, b) => b.last_accessed - a.last_accessed);
    }

    const limited = results.slice(0, limit);
    // Touch access stats
    for (const f of limited) {
      f.last_accessed = Date.now();
      f.access_count++;
    }
    this.scheduleFlush();
    return limited;
  }

  listFacts(): MemoryFact[] {
    return [...this.data.facts].sort((a, b) => b.created_at - a.created_at);
  }

  listByCategory(category: MemoryCategory): MemoryFact[] {
    return this.data.facts.filter(f => f.category === category);
  }

  private pruneFacts(max: number): void {
    if (this.data.facts.length <= max) return;
    // Remove least-recently-accessed facts
    const sorted = [...this.data.facts].sort((a, b) => a.last_accessed - b.last_accessed);
    const toRemove = sorted.slice(0, this.data.facts.length - max);
    const removeIds = new Set(toRemove.map(f => f.id));
    this.data.facts = this.data.facts.filter(f => !removeIds.has(f.id));
  }

  /** Extract key facts from session messages for persistence. */
  summarizeSession(messages: Array<{ role: string; content: string }>, sessionId: string): void {
    // Heuristic: look for assistant messages that contain key findings,
    // user preferences, or learned patterns. We extract from the last
    // few substantial exchanges.
    const recent = messages.slice(-30);
    for (const msg of recent) {
      if (msg.role !== 'assistant') continue;
      const content = msg.content;
      if (content.length < 50) continue;

      // Detect preference statements
      this.extractPreferences(content, sessionId);
      // Detect learned patterns from tool results
      this.extractPatterns(content, sessionId);
    }
  }

  private extractPreferences(content: string, sessionId: string): void {
    const patterns = [
      /(?:user prefers?|preference|I prefer|I like|I want) (.+?)(?:\.|$)/gi,
      /(?:always|never|must|should) (?:use|do|avoid) (.+?)(?:\.|$)/gi,
    ];
    for (const pat of patterns) {
      let match;
      while ((match = pat.exec(content)) !== null) {
        const text = match[1].trim();
        if (text.length > 10 && text.length < 300) {
          this.addFact('user_preference', text, `session:${sessionId}`);
        }
      }
    }
  }

  private extractPatterns(content: string, sessionId: string): void {
    // Detect factual findings from tool results
    const patterns = [
      /(?:found|discovered|note that|important:) (.+?)(?:\.|$)/gi,
      /(?:the (?:schema|database|config|structure) (?:has|is|contains)) (.+?)(?:\.|$)/gi,
    ];
    for (const pat of patterns) {
      let match;
      while ((match = pat.exec(content)) !== null) {
        const text = match[1].trim();
        if (text.length > 15 && text.length < 300) {
          this.addFact('learned_pattern', text, `session:${sessionId}`);
        }
      }
    }
  }

  /** Build context string for injection into the system prompt. */
  buildMemoryContext(task: string): string {
    const facts = this.queryFacts(task, undefined, 5);
    if (facts.length === 0) return '';

    const lines = facts.map(f =>
      `- [${f.category}] ${f.content}`,
    );
    return `## Relevant Memory (cross-session)\n` +
      `_Facts and preferences remembered from previous sessions that seem relevant to this task._\n\n` +
      lines.join('\n');
  }

  close(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}
