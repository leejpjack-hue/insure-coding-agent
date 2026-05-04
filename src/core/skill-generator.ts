import fs from 'fs';
import path from 'path';
import { TFIDFIndex } from '../knowledge/embeddings.js';

export interface SkillDoc {
  id: string;
  title: string;
  summary: string;
  created_at: number;
  source_session: string;
  tools_used: string[];
  when_to_use: string;
  steps: string[];
  gotchas: string[];
}

const SKILLS_DIR = 'data/skills';

export class SkillGenerator {
  private dir: string;
  private index: TFIDFIndex<SkillDoc>;

  constructor(baseDir: string = SKILLS_DIR) {
    this.dir = baseDir;
    this.index = new TFIDFIndex<SkillDoc>(doc =>
      `${doc.title} ${doc.summary} ${doc.when_to_use} ${doc.tools_used.join(' ')}`,
    );
    this.loadIndex();
  }

  private loadIndex(): void {
    const skills = this.listSkills();
    if (skills.length > 0) {
      this.index.build(skills);
    }
  }

  generateSkillDoc(opts: {
    task: string;
    toolsUsed: string[];
    sessionId: string;
    outcome: string;
  }): SkillDoc | null {
    // Only generate for complex tasks (3+ tools)
    if (opts.toolsUsed.length < 3) return null;

    const id = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const title = this.deriveTitle(opts.task);
    const summary = this.deriveSummary(opts.task, opts.outcome);

    const doc: SkillDoc = {
      id,
      title,
      summary,
      created_at: Date.now(),
      source_session: opts.sessionId,
      tools_used: [...new Set(opts.toolsUsed)],
      when_to_use: this.deriveWhenToUse(opts.task),
      steps: this.deriveSteps(opts.toolsUsed),
      gotchas: [],
    };

    this.saveSkillDoc(doc);
    // Rebuild index
    const all = this.listSkills();
    if (all.length > 0) this.index.build(all);

    return doc;
  }

  searchSkills(query: string, limit = 3): Array<{ doc: SkillDoc; score: number }> {
    if (this.index.size() === 0) return [];
    return this.index.search(query, limit);
  }

  listSkills(): SkillDoc[] {
    if (!fs.existsSync(this.dir)) return [];
    try {
      return fs.readdirSync(this.dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8')) as SkillDoc;
          } catch { return null; }
        })
        .filter((d): d is SkillDoc => d !== null);
    } catch { return []; }
  }

  buildSkillsContext(task: string): string {
    const hits = this.searchSkills(task, 3);
    if (hits.length === 0) return '';

    const lines = hits.map(h =>
      `### ${h.doc.title}\n${h.doc.summary}\nTools: ${h.doc.tools_used.join(', ')}`,
    );
    return `## Relevant Skills (auto-learned)\n` +
      `_Patterns learned from previous complex tasks that may help here._\n\n` +
      lines.join('\n\n');
  }

  private saveSkillDoc(doc: SkillDoc): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    const slug = doc.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    const filePath = path.join(this.dir, `${slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf-8');
  }

  private deriveTitle(task: string): string {
    // Take first meaningful sentence, cap at 80 chars
    const first = task.split(/[.!?\n]/)[0].trim();
    if (first.length <= 80) return first;
    return first.slice(0, 77) + '...';
  }

  private deriveSummary(task: string, outcome: string): string {
    const taskSnippet = task.length > 100 ? task.slice(0, 97) + '...' : task;
    const outcomeSnippet = outcome.length > 100 ? outcome.slice(0, 97) + '...' : outcome;
    return `Task: ${taskSnippet}\nResult: ${outcomeSnippet}`;
  }

  private deriveWhenToUse(task: string): string {
    // Extract key terms for retrieval
    const lower = task.toLowerCase();
    const keywords: string[] = [];
    const patterns = [
      /commission/i, /license/i, /agent/i, /policy/i, /compliance/i,
      /override/i, /renewal/i, /suspend/i, /calculate/i, /validate/i,
      /ams/i, /schema/i, /database/i, /api/i, /report/i,
    ];
    for (const p of patterns) {
      if (p.test(lower)) keywords.push(p.source.replace(/\\/g, ''));
    }
    return keywords.length > 0
      ? `When working with: ${keywords.join(', ')}`
      : 'Similar tasks';
  }

  private deriveSteps(toolsUsed: string[]): string[] {
    const seen = new Set<string>();
    return toolsUsed.filter(t => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    }).map(t => `Used ${t}`);
  }
}
