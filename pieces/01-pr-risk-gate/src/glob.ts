/**
 * Minimal glob matcher: `**` crosses directories, `*` and `?` do not.
 * A pattern with no `/` matches the file name in any directory (like .gitignore).
 */
export function globToRegExp(glob: string): RegExp {
  const cached = CACHE.get(glob);
  if (cached) return cached;
  const compiled = compile(glob);
  CACHE.set(glob, compiled);
  return compiled;
}

const CACHE = new Map<string, RegExp>();

function compile(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(glob.includes('/') ? `^${re}$` : `(?:^|/)${re}$`);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
