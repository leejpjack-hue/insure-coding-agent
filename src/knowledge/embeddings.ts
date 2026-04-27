// Lightweight TF-IDF style "embedding" for retrieval over the AMS knowledge base.
// Deliberately simple — no external vector DB dependency. Real deployment can swap
// this for pgvector / OpenAI embeddings behind the same interface.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'be', 'by', 'as', 'at', 'this', 'that', 'it', 'from',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

export interface EmbeddedDoc<T> {
  doc: T;
  vector: Map<string, number>;   // term → tf
  norm: number;
}

export class TFIDFIndex<T> {
  private docs: EmbeddedDoc<T>[] = [];
  private idf: Map<string, number> = new Map();
  private getText: (doc: T) => string;

  constructor(getText: (doc: T) => string) {
    this.getText = getText;
  }

  build(items: T[]): void {
    this.docs = [];
    const df = new Map<string, number>();

    for (const item of items) {
      const tokens = tokenize(this.getText(item));
      const tf = new Map<string, number>();
      for (const tok of tokens) tf.set(tok, (tf.get(tok) || 0) + 1);
      // normalise tf
      const total = tokens.length || 1;
      for (const [k, v] of tf) tf.set(k, v / total);
      // accumulate document frequency
      for (const k of tf.keys()) df.set(k, (df.get(k) || 0) + 1);

      this.docs.push({ doc: item, vector: tf, norm: 0 });
    }

    const N = this.docs.length;
    this.idf = new Map();
    for (const [term, n] of df) {
      this.idf.set(term, Math.log((N + 1) / (n + 1)) + 1);
    }

    for (const d of this.docs) {
      let sumSq = 0;
      for (const [term, tf] of d.vector) {
        const w = tf * (this.idf.get(term) || 0);
        d.vector.set(term, w);
        sumSq += w * w;
      }
      d.norm = Math.sqrt(sumSq) || 1;
    }
  }

  search(query: string, topK: number = 5): Array<{ doc: T; score: number }> {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const qVec = new Map<string, number>();
    for (const t of tokens) qVec.set(t, (qVec.get(t) || 0) + 1);
    let qNorm = 0;
    for (const [k, v] of qVec) {
      const w = v * (this.idf.get(k) || 0);
      qVec.set(k, w);
      qNorm += w * w;
    }
    qNorm = Math.sqrt(qNorm) || 1;

    const scored = this.docs.map(d => {
      let dot = 0;
      for (const [term, w] of qVec) {
        const dw = d.vector.get(term);
        if (dw) dot += w * dw;
      }
      return { doc: d.doc, score: dot / (qNorm * d.norm) };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  size(): number {
    return this.docs.length;
  }
}
