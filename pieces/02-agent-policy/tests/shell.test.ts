import { describe, expect, it } from 'vitest';
import { parseShell, ShellParseError } from '../src/shell.ts';

const words = (cmd: string) => parseShell(cmd).map((s) => s.words);

describe('parseShell', () => {
  it('splits words, quotes and escapes', () => {
    expect(words(`git commit -m "a b" 'c d' e\\ f`)).toEqual([
      ['git', 'commit', '-m', 'a b', 'c d', 'e f'],
    ]);
    expect(words('echo "say \\"hi\\" \\$HOME"')).toEqual([['echo', 'say "hi" $HOME']]);
    expect(words(`echo ''`)).toEqual([['echo', '']]);
  });

  it('splits on separators and pipes', () => {
    expect(words('a && b || c; d | e |& f & g\nh')).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['d'],
      ['e'],
      ['f'],
      ['g'],
      ['h'],
    ]);
    expect(words('(cd x && ls)')).toEqual([['cd', 'x'], ['ls']]);
  });

  it('records redirects with targets and drops fd duplication', () => {
    const [seg] = parseShell('cmd > out.txt 2>&1 >> log 2> err &> all < in');
    expect(seg?.words).toEqual(['cmd']);
    expect(seg?.redirects).toEqual([
      { op: '>', target: 'out.txt' },
      { op: '>>', target: 'log' },
      { op: '>', target: 'err' },
      { op: '&>', target: 'all' },
      { op: '<', target: 'in' },
    ]);
    expect(parseShell('a >| f &>> g')[0]?.redirects.map((r) => r.op)).toEqual(['>|', '&>>']);
    expect(parseShell('cmd >&2 <&-')[0]?.redirects).toEqual([]);
  });

  it('treats command substitutions as their own segments', () => {
    expect(words('echo $(cat .env)')).toEqual([
      ['cat', '.env'],
      ['echo', '$SUB'],
    ]);
    expect(words('echo `cat .env`')).toEqual([
      ['cat', '.env'],
      ['echo', '$SUB'],
    ]);
    expect(words('echo "x $(whoami) y"')).toEqual([['whoami'], ['echo', 'x $SUB y']]);
    expect(words('echo "x `id` y"')).toEqual([['id'], ['echo', 'x $SUB y']]);
  });

  it('skips heredoc bodies, including apostrophes inside them', () => {
    const cmd = `git commit -m "$(cat <<'EOF'\nfix: don't break\nsecond line\nEOF\n)"`;
    expect(words(cmd)).toEqual([['cat'], ['git', 'commit', '-m', '$SUB']]);
    expect(parseShell('cat <<-X > f\n\tbody\n\tX\nls')[0]?.redirects).toEqual([
      { op: '>', target: 'f' },
    ]);
    expect(words('cat <<EOF\nnever closed')).toEqual([['cat']]);
  });

  it('ignores herestrings as file targets and skips comments', () => {
    expect(parseShell('cat <<< "hello"')[0]?.redirects).toEqual([]);
    expect(words('ls # comment here\npwd')).toEqual([['ls'], ['pwd']]);
    expect(words('echo a#b')).toEqual([['echo', 'a#b']]);
  });

  it.each([
    ['echo "open', 'unbalanced double quote'],
    ["echo 'open", 'unbalanced single quote'],
    ['echo $(ls', 'unbalanced parenthesis'],
    ['echo `ls', 'unbalanced backtick'],
  ])('rejects %s', (cmd, message) => {
    expect(() => parseShell(cmd)).toThrow(ShellParseError);
    expect(() => parseShell(cmd)).toThrow(message);
  });

  it('handles a trailing backslash and an empty command', () => {
    expect(words('echo a\\')).toEqual([['echo', 'a\\']]);
    expect(parseShell('')).toEqual([]);
    expect(parseShell('   ;  ')).toEqual([]);
  });
});
