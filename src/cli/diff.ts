import fs from 'fs';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const GRAY = '\x1b[90m';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** Simple patience-style LCS diff on lines. */
export function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const n = oldLines.length;
  const m = newLines.length;

  // LCS DP table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = n, j = m;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'unchanged', content: oldLines[i - 1], oldLineNo: i, newLineNo: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', content: newLines[j - 1], newLineNo: j });
      j--;
    } else {
      stack.push({ type: 'removed', content: oldLines[i - 1], oldLineNo: i });
      i--;
    }
  }

  stack.reverse();
  return stack;
}

/** Group diff lines into hunks with context. */
export function groupIntoHunks(lines: DiffLine[], contextLines = 3): Array<{ header: string; lines: DiffLine[] }> {
  if (lines.length === 0) return [];

  // Find indices of changed lines
  const changeIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== 'unchanged') changeIndices.push(i);
  }
  if (changeIndices.length === 0) return [];

  // Build hunks by merging overlapping context windows
  const hunks: Array<{ start: number; end: number }> = [];
  let hunkStart = Math.max(0, changeIndices[0] - contextLines);
  let hunkEnd = Math.min(lines.length - 1, changeIndices[0] + contextLines);

  for (let ci = 1; ci < changeIndices.length; ci++) {
    const cs = Math.max(0, changeIndices[ci] - contextLines);
    const ce = Math.min(lines.length - 1, changeIndices[ci] + contextLines);
    if (cs <= hunkEnd + 1) {
      hunkEnd = ce;
    } else {
      hunks.push({ start: hunkStart, end: hunkEnd });
      hunkStart = cs;
      hunkEnd = ce;
    }
  }
  hunks.push({ start: hunkStart, end: hunkEnd });

  return hunks.map(h => {
    const hunkLines = lines.slice(h.start, h.end + 1);
    const firstOld = hunkLines.find(l => l.oldLineNo !== undefined);
    const firstNew = hunkLines.find(l => l.newLineNo !== undefined);
    const oldStart = firstOld?.oldLineNo ?? 0;
    const newStart = firstNew?.newLineNo ?? 0;
    const oldCount = hunkLines.filter(l => l.type !== 'added').length;
    const newCount = hunkLines.filter(l => l.type !== 'removed').length;
    return {
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      lines: hunkLines,
    };
  });
}

/** Format a colored diff string for terminal display. */
export function formatColoredDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const diff = diffLines(oldLines, newLines);
  const hunks = groupIntoHunks(diff);

  if (hunks.length === 0) return '';

  const added = diff.filter(d => d.type === 'added').length;
  const removed = diff.filter(d => d.type === 'removed').length;

  const parts: string[] = [];
  parts.push(`${BOLD}${CYAN}diff -- ${filePath}${RESET}`);
  parts.push(`${DIM}${added} addition(s), ${removed} deletion(s)${RESET}`);

  for (const hunk of hunks) {
    parts.push(`${DIM}${hunk.header}${RESET}`);
    for (const line of hunk.lines) {
      if (line.type === 'added') {
        parts.push(`${GREEN}+${line.content}${RESET}`);
      } else if (line.type === 'removed') {
        parts.push(`${RED}-${line.content}${RESET}`);
      } else {
        parts.push(`${GRAY} ${line.content}${RESET}`);
      }
    }
  }

  return parts.join('\n');
}

/** Read file content, returning empty string if not found. */
export function readFileSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/** Show a colored diff for a file change. Returns the formatted string. */
export function showFileDiff(beforeContent: string, afterContent: string, filePath: string): string {
  if (beforeContent === afterContent) return '';
  if (!beforeContent) {
    // New file — show all lines as green
    const lines = afterContent.split('\n');
    const display = lines.slice(0, 40).map(l => `${GREEN}+${l}${RESET}`).join('\n');
    const truncated = lines.length > 40 ? `\n${DIM}... ${lines.length - 40} more lines${RESET}` : '';
    return `${BOLD}${CYAN}new file: ${filePath}${RESET}\n${display}${truncated}`;
  }
  return formatColoredDiff(beforeContent, afterContent, filePath);
}
