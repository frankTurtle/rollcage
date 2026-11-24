export interface Redirect {
  op: string;
  target: string;
}

export interface Segment {
  words: string[];
  redirects: Redirect[];
}

export class ShellParseError extends Error {}

/** Placeholder word for a command substitution; the substituted commands become their own segments. */
const SUBSTITUTION = '$SUB';

/**
 * Split a shell command into simple commands (segments) with words and redirects.
 * Heuristic, not a full shell: it handles quotes, escapes, separators, redirects, heredocs,
 * `$( )` and backticks (their contents become extra segments), and `#` comments.
 * Anything it cannot parse throws ShellParseError so callers can fail closed.
 */
export function parseShell(command: string): Segment[] {
  const parser = new Parser(command);
  parser.run(false);
  return parser.segments;
}

class Parser {
  i = 0;
  readonly segments: Segment[] = [];

  constructor(private readonly s: string) {}

  /** Parse commands until the end, or until the `)` that closes a `$(`. */
  run(untilParen: boolean): void {
    const s = this.s;
    let words: string[] = [];
    let redirects: Redirect[] = [];
    let cur = '';
    let has = false;
    let pending: string | null = null;
    const heredocs: { delim: string; strip: boolean }[] = [];
    let closed = !untilParen;

    const endWord = () => {
      if (!has) return;
      if (pending !== null) {
        if (pending === '<<' || pending === '<<-') {
          heredocs.push({ delim: cur, strip: pending === '<<-' });
        } else if (pending !== '<<<') {
          redirects.push({ op: pending, target: cur });
        }
        pending = null;
      } else {
        words.push(cur);
      }
      cur = '';
      has = false;
    };
    const endSegment = () => {
      endWord();
      if (words.length > 0 || redirects.length > 0) this.segments.push({ words, redirects });
      words = [];
      redirects = [];
    };
    const substitute = (inner: Parser) => {
      this.segments.push(...inner.segments);
      cur += SUBSTITUTION;
      has = true;
    };

    while (this.i < s.length) {
      const c = s[this.i] as string;
      const next = s[this.i + 1];

      if (c === '\\') {
        cur += next ?? '\\';
        has = true;
        this.i += 2;
      } else if (c === "'") {
        const end = s.indexOf("'", this.i + 1);
        if (end < 0) throw new ShellParseError('unbalanced single quote');
        cur += s.slice(this.i + 1, end);
        has = true;
        this.i = end + 1;
      } else if (c === '"') {
        this.i++;
        has = true;
        let done = false;
        while (this.i < s.length && !done) {
          const d = s[this.i] as string;
          if (d === '\\') {
            const e = s[this.i + 1] ?? '';
            cur += '"\\$`'.includes(e) ? e : `\\${e}`;
            this.i += 2;
          } else if (d === '"') {
            done = true;
            this.i++;
          } else if (d === '$' && s[this.i + 1] === '(') {
            substitute(this.paren());
          } else if (d === '`') {
            substitute(this.backtick());
          } else {
            cur += d;
            this.i++;
          }
        }
        if (!done) throw new ShellParseError('unbalanced double quote');
      } else if (c === '$' && next === '(') {
        substitute(this.paren());
      } else if (c === '`') {
        substitute(this.backtick());
      } else if (c === '#' && !has) {
        while (this.i < s.length && s[this.i] !== '\n') this.i++;
      } else if (c === ' ' || c === '\t') {
        endWord();
        this.i++;
      } else if (c === '\n') {
        endSegment();
        this.i++;
        for (const doc of heredocs.splice(0)) this.skipHeredoc(doc);
      } else if (c === ';' || c === '(') {
        endSegment();
        this.i++;
      } else if (c === ')') {
        endSegment();
        this.i++;
        if (untilParen) {
          closed = true;
          break;
        }
      } else if (c === '|') {
        endSegment();
        this.i += next === '|' || next === '&' ? 2 : 1;
      } else if (c === '&' && next === '>') {
        endWord();
        const append = s[this.i + 2] === '>';
        pending = append ? '&>>' : '&>';
        this.i += append ? 3 : 2;
      } else if (c === '&') {
        endSegment();
        this.i += next === '&' ? 2 : 1;
      } else if (c === '>' || c === '<') {
        if (has && /^\d+$/.test(cur)) {
          cur = '';
          has = false;
        }
        endWord();
        let op = c;
        let len = 1;
        if (c === '>' && (next === '>' || next === '|')) {
          op = `>${next}`;
          len = 2;
        } else if (c === '<' && next === '<') {
          const third = s[this.i + 2];
          op = third === '<' ? '<<<' : third === '-' ? '<<-' : '<<';
          len = op.length;
        }
        this.i += len;
        const dup = /^&(\d+|-)/.exec(s.slice(this.i));
        if (dup) {
          this.i += dup[0].length;
        } else {
          pending = op;
        }
      } else {
        cur += c;
        has = true;
        this.i++;
      }
    }

    if (!closed) throw new ShellParseError('unbalanced parenthesis');
    endSegment();
  }

  private paren(): Parser {
    const inner = new Parser(this.s);
    inner.i = this.i + 2;
    inner.run(true);
    this.i = inner.i;
    return inner;
  }

  private backtick(): Parser {
    const end = this.s.indexOf('`', this.i + 1);
    if (end < 0) throw new ShellParseError('unbalanced backtick');
    const inner = new Parser(this.s.slice(this.i + 1, end));
    inner.run(false);
    this.i = end + 1;
    return inner;
  }

  /** Skip heredoc body lines up to and including the delimiter line. */
  private skipHeredoc(doc: { delim: string; strip: boolean }): void {
    while (this.i < this.s.length) {
      const nl = this.s.indexOf('\n', this.i);
      const end = nl < 0 ? this.s.length : nl;
      const line = this.s.slice(this.i, end);
      this.i = nl < 0 ? this.s.length : nl + 1;
      if ((doc.strip ? line.replace(/^\t+/, '') : line) === doc.delim) return;
    }
  }
}
