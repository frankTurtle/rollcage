import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesAny } from '../src/index.js';

describe('glob', () => {
  it.each([
    ['**/auth/**', 'src/auth/session.ts', true],
    ['**/auth/**', 'auth/x.ts', true],
    ['**/auth/**', 'src/author/x.ts', false],
    ['*.md', 'docs/guide.md', true],
    ['*.md', 'README.md', true],
    ['*.md', 'a.mdx', false],
    ['.github/workflows/**', '.github/workflows/ci.yml', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['src/**', 'src/a/b.ts', true],
    ['a?c', 'abc', true],
    ['**/*.tf', 'infra/main.tf', true],
    ['**/*iam*.json', 'x/my-iam-role.json', true],
    ['package-lock.json', 'web/package-lock.json', true],
  ])('%s vs %s -> %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });

  it('matchesAny', () => {
    expect(matchesAny('a.ts', ['*.md', '*.ts'])).toBe(true);
    expect(matchesAny('a.ts', [])).toBe(false);
  });
});
