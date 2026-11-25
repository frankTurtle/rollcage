import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { parseDiff, unquotePath } from '../src/diff.ts';
import { prescore } from '../src/prescore.ts';
import { maxLevel } from '../src/types.ts';
import { fixture } from './helpers.ts';

describe('AC-1 parseDiff', () => {
  it('reports adds, removes and new-file line numbers for a modification', () => {
    const [file] = parseDiff(fixture('pr3-auth-no-tests.diff'));
    expect(file).toMatchObject({
      path: 'src/auth/session.ts',
      status: 'modified',
      added: 10,
      removed: 2,
    });
    expect(file?.addedLines[0]).toBe(14);
    expect(file?.addedLines.at(-1)).toBe(23);
  });

  it('handles several files, new files, deletes, renames and binaries', () => {
    const diff = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-x',
      '-y',
      'diff --git a/from.ts b/to.ts',
      'similarity index 90%',
      'rename from from.ts',
      'rename to to.ts',
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
      'diff --git a/ctx.ts b/ctx.ts',
      '@@ -5,3 +5,3 @@',
      ' keep',
      '',
      '-gone',
      '+new',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const files = parseDiff(diff);
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['new.ts', 'added'],
      ['old.ts', 'deleted'],
      ['to.ts', 'renamed'],
      ['img.png', 'modified'],
      ['ctx.ts', 'modified'],
    ]);
    expect(files[0]?.addedLines).toEqual([1, 2]);
    expect(files[1]).toMatchObject({ removed: 2, added: 0 });
    expect(files[2]?.oldPath).toBe('from.ts');
    expect(files[3]?.binary).toBe(true);
    expect(files[4]?.addedLines).toEqual([7]);
  });

  it('ignores text before the first file and tolerates a malformed header', () => {
    expect(parseDiff('hello\nworld')).toEqual([]);
    expect(parseDiff('diff --git weird')[0]?.path).toBe('');
  });
});

describe('config', () => {
  it('uses defaults for empty input and a yaml null', () => {
    expect(loadConfig().mode).toBe('enforce');
    expect(loadConfig('# nothing').thresholds.large_diff_lines).toBe(400);
    expect(Object.keys(loadConfig('').risk_paths)).toContain('auth');
  });

  it('merges partial settings with defaults', () => {
    const c = loadConfig(
      'mode: observe\nthresholds:\n  medium_diff_lines: 5\n  large_diff_lines: 9\n',
    );
    expect(c.mode).toBe('observe');
    expect(c.thresholds).toMatchObject({ medium_diff_lines: 5, min_test_ratio: 0.25 });
    expect(c.second_approval.required).toBe(2);
  });

  it('rejects unknown keys, bad values and inverted thresholds', () => {
    expect(() => loadConfig('modee: x')).toThrow();
    expect(() => loadConfig('mode: maybe')).toThrow();
    expect(() =>
      loadConfig('thresholds:\n  medium_diff_lines: 50\n  large_diff_lines: 10\n'),
    ).toThrow('large_diff_lines');
  });

  it('maxLevel picks the higher level', () => {
    expect(maxLevel('low', 'high')).toBe('high');
    expect(maxLevel('medium', 'low')).toBe('medium');
    expect(maxLevel('high', 'high')).toBe('high');
  });
});

describe('review fix: quoted and unreadable paths', () => {
  const quoted = (path: string, body = ' x\n+y\n') =>
    `diff --git "a/${path}" "b/${path}"\nindex 1..2 100644\n--- "a/${path}"\n+++ "b/${path}"\n@@ -1,1 +1,2 @@\n${body}`;

  it('decodes git-quoted paths with octal UTF-8 bytes and escapes', () => {
    const [f] = parseDiff(quoted('src/auth/caf\\303\\251.ts'));
    expect(f?.path).toBe('src/auth/café.ts');
    expect(f?.addedLines).toEqual([2]);
    expect(parseDiff(quoted('a\\tb\\"c\\\\d.ts'))[0]?.path).toBe('a\tb"c\\d.ts');
    expect(unquotePath('plain/path.ts')).toBe('plain/path.ts');
    expect(unquotePath('"x\\q"')).toBe('xq');
    expect(unquotePath('"')).toBe('"');
  });

  it('a quoted rename keeps both paths', () => {
    const d = 'diff --git "a/old caf\\303\\251.ts" "b/new caf\\303\\251.ts"\nrename from x\n';
    expect(parseDiff(d)[0]).toMatchObject({
      oldPath: 'old café.ts',
      path: 'new café.ts',
      status: 'renamed',
    });
  });

  it('falls back to the +++ line when the header cannot be read', () => {
    const d =
      'diff --git weird header\n--- a/src/auth/x.ts\n+++ b/src/auth/x.ts\n@@ -1 +1,2 @@\n x\n+y\n';
    expect(parseDiff(d)[0]?.path).toBe('src/auth/x.ts');
    const deleted = 'diff --git weird\n+++ /dev/null\n';
    expect(parseDiff(deleted)[0]?.path).toBe('');
  });

  it('a file under an auth directory with a non-ASCII name is high risk', () => {
    const p = prescore(parseDiff(quoted('src/auth/caf\\303\\251.ts')), loadConfig());
    expect(p.level).toBe('high');
    expect(p.categories['auth']).toEqual(['src/auth/café.ts']);
  });

  it('a file whose path cannot be read at all is high risk (fail closed)', () => {
    const p = prescore(parseDiff('diff --git ???\n@@ -1 +1,2 @@\n x\n+y\n'), loadConfig());
    expect(p.level).toBe('high');
    expect(p.categories['unreadable_path']).toBeDefined();
  });
});
