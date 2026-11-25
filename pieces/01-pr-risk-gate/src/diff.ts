import type { DiffFile } from './types.js';

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const HEADER = /^diff --git a\/(.+) b\/(.+)$/;
/** git quotes a path that has special or non-ASCII characters: "a/caf\303\251.ts". */
const QUOTED_HEADER = /^diff --git ("a\/(?:[^"\\]|\\.)*") ("b\/(?:[^"\\]|\\.)*")$/;

const ESCAPES: Record<string, number> = {
  n: 10,
  t: 9,
  r: 13,
  '"': 34,
  '\\': 92,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
};

/** Decode a path as git prints it: plain, or in double quotes with C escapes (octal bytes for UTF-8). */
export function unquotePath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i] as string;
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(inner.slice(i + 1))?.[0];
    if (octal) {
      bytes.push(parseInt(octal, 8));
      i += octal.length;
    } else {
      bytes.push(ESCAPES[inner[i + 1] ?? ''] ?? (inner.charCodeAt(i + 1) || 92));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Old and new path from a `diff --git` line, or empty strings if it cannot be read. */
function parseHeader(line: string): { oldPath: string; newPath: string } {
  const q = QUOTED_HEADER.exec(line);
  if (q?.[1] && q[2])
    return { oldPath: unquotePath(q[1]).slice(2), newPath: unquotePath(q[2]).slice(2) };
  const m = HEADER.exec(line);
  return { oldPath: m?.[1] ?? '', newPath: m?.[2] ?? '' };
}

/** Parse a unified diff (as produced by `git diff` or GitHub) into per-file stats. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | undefined;
  let newLine = 0;
  let inHunk = false;

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const { oldPath, newPath } = parseHeader(line);
      cur = {
        path: newPath,
        status: 'modified',
        added: 0,
        removed: 0,
        addedLines: [],
        binary: false,
      };
      if (oldPath && oldPath !== newPath) {
        cur.oldPath = oldPath;
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
      if (line.startsWith('+++ ') && cur.path === '' && line !== '+++ /dev/null') {
        // The header could not be read; the +++ line still names the new path.
        cur.path = unquotePath(line.slice(4)).replace(/^b\//, '');
      }
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
