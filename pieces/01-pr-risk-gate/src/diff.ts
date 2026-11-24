import type { DiffFile } from './types.js';

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const HEADER = /^diff --git a\/(.+) b\/(.+)$/;

/** Parse a unified diff (as produced by `git diff` or GitHub) into per-file stats. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | undefined;
  let newLine = 0;
  let inHunk = false;

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = HEADER.exec(line);
      cur = {
        path: m?.[2] ?? '',
        status: 'modified',
        added: 0,
        removed: 0,
        addedLines: [],
        binary: false,
      };
      if (m?.[1] !== undefined && m[1] !== m[2]) {
        cur.oldPath = m[1];
        cur.status = 'renamed';
      }
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;

    const hunk = HUNK.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
    } else if (!inHunk) {
      if (line.startsWith('new file mode')) cur.status = 'added';
      else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
      else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
        cur.binary = true;
      }
    } else if (line.startsWith('+')) {
      cur.added++;
      cur.addedLines.push(newLine++);
    } else if (line.startsWith('-')) {
      cur.removed++;
    } else if (line === '' || line.startsWith(' ')) {
      newLine++;
    }
  }
  return files;
}
