import { basename, isAbsolute, relative, resolve } from 'node:path';
import { globToRegExp, matchesAny } from '@adl/shared';
import type { PolicyConfig } from './config.js';
import { parseShell, ShellParseError } from './shell.js';
import type { Segment } from './shell.js';

export type Rule =
  | 'secret-read'
  | 'force-push'
  | 'write-outside-repo'
  | 'network-allowlist'
  | 'unparseable'
  | 'invalid-input'
  | 'config-error'
  | 'audit-unavailable';

export interface Decision {
  allow: boolean;
  rule?: Rule;
  reason?: string;
  /** Path or host involved. Never file contents or command text. */
  target?: string;
}

export interface ToolCall {
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd: string;
}

export interface GuardContext {
  projectDir: string;
  home: string;
  config: PolicyConfig;
}

const ALLOW: Decision = { allow: true };

export function deny(rule: Rule, reason: string, target?: string): Decision {
  return { allow: false, rule, reason, ...(target ? { target } : {}) };
}

const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const FILE_TOOLS = new Set([...WRITE_TOOLS, 'Read', 'Grep', 'Glob']);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The one entry point: decide whether a tool call may run. Pure and deterministic. */
export function evaluate(call: ToolCall, ctx: GuardContext): Decision {
  const input = call.tool_input;
  if (FILE_TOOLS.has(call.tool_name)) return checkFileTool(call, ctx);
  switch (call.tool_name) {
    case 'Bash':
      return checkBash(input['command'], call.cwd, ctx, 0);
    case 'WebFetch':
      return checkWebFetch(str(input['url']), ctx);
    case 'WebSearch':
      return ctx.config.allow_web_search
        ? ALLOW
        : deny('network-allowlist', 'Web search is disabled by policy.');
    default:
      return ALLOW;
  }
}

// ---------- paths ----------

export function resolvePath(p: string, cwd: string, home: string): string {
  const expanded = p === '~' ? home : p.startsWith('~/') ? `${home}/${p.slice(2)}` : p;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

function isSecretPath(abs: string, ctx: GuardContext): boolean {
  return matchesAny(abs, ctx.config.secret_paths) && !matchesAny(abs, ctx.config.secret_exceptions);
}

/** File names the configured secret patterns would match (`*` becomes `x`), used to test wildcards. */
const secretProbes = (ctx: GuardContext): string[] =>
  ctx.config.secret_paths.filter((p) => !p.includes('/')).map((p) => p.replace(/[*?]/g, 'x'));

/** True if a wildcard such as `.env*` or `*.pem` could expand to a secret file name. */
function wildcardHitsSecret(token: string, ctx: GuardContext): boolean {
  if (!/[*?[]/.test(token)) return false;
  const glob = basename(token);
  // A bare `*` or `?` says nothing about which files are meant; require some literal text.
  if (glob.replace(/[*?[\]]/g, '').length < 2) return false;
  const re = globToRegExp(glob);
  // Shell globs skip dotfiles unless the pattern itself starts with a dot.
  return secretProbes(ctx).some(
    (p) =>
      (!p.startsWith('.') || glob.startsWith('.')) && re.test(p) && isSecretPath(`/x/${p}`, ctx),
  );
}

function insideDir(abs: string, dir: string): boolean {
  const rel = relative(dir, abs);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isWritable(abs: string, ctx: GuardContext): boolean {
  const extra = ctx.config.allow_write_dirs.map((d) => resolvePath(d, ctx.projectDir, ctx.home));
  return [ctx.projectDir, ...extra].some((d) => insideDir(abs, d));
}

const denySecret = (abs: string): Decision =>
  deny('secret-read', 'Secret and credential files are off limits to agents.', abs);
const denyOutside = (abs: string): Decision =>
  deny('write-outside-repo', 'Writing outside the repository is not allowed.', abs);

/** The token itself, plus the value after `=` for forms like `--env-file=.env`. */
const withValuePart = (t: string): string[] =>
  t.includes('=') ? [t, t.slice(t.indexOf('=') + 1)] : [t];

const SAFE_SINKS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr']);

function checkWritePath(token: string, cwd: string, ctx: GuardContext): Decision {
  if (token.includes('$')) {
    return deny(
      'write-outside-repo',
      'The target path uses a variable or substitution, so it cannot be checked. Use a literal path inside the repository.',
    );
  }
  const abs = resolvePath(token, cwd, ctx.home);
  if (SAFE_SINKS.has(abs) || isWritable(abs, ctx)) return ALLOW;
  return denyOutside(abs);
}

// ---------- file tools ----------

function checkFileTool(call: ToolCall, ctx: GuardContext): Decision {
  const input = call.tool_input;
  const raw = str(input['file_path']) ?? str(input['notebook_path']) ?? str(input['path']);
  if (raw) {
    const abs = resolvePath(raw, call.cwd, ctx.home);
    if (call.tool_name !== 'Glob' && isSecretPath(abs, ctx)) {
      return denySecret(abs);
    }
    if (WRITE_TOOLS.has(call.tool_name) && !isWritable(abs, ctx)) return denyOutside(abs);
  }
  const glob = str(input['glob']);
  if (call.tool_name === 'Grep' && glob && wildcardHitsSecret(glob, ctx)) {
    return deny('secret-read', 'This search pattern would read secret files.', glob);
  }
  return ALLOW;
}

// ---------- shell ----------

const WRAPPERS = new Set([
  'sudo',
  'doas',
  'env',
  'command',
  'builtin',
  'nohup',
  'time',
  'timeout',
  'nice',
  'ionice',
  'exec',
  'stdbuf',
  'setsid',
  'xargs',
]);
const WRAPPER_VALUE_OPTS = new Set(['-u', '-g', '-U', '-C', '-h', '-p']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const OUTPUT_OPS = new Set(['>', '>>', '>|', '&>', '&>>']);
const NO_ARG_SECRET_CHECK = new Set([
  'ls',
  'stat',
  'test',
  '[',
  '[[',
  'cd',
  'pwd',
  'echo',
  'printf',
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export function commandOf(words: string[]): { cmd: string; args: string[] } {
  let k = 0;
  while (k < words.length) {
    const w = words[k] ?? '';
    if (ASSIGNMENT.test(w)) {
      k++;
    } else if (WRAPPERS.has(basename(w))) {
      const wrapper = basename(w);
      k++;
      while (k < words.length) {
        const a = words[k] ?? '';
        if (WRAPPER_VALUE_OPTS.has(a) || (a === '-n' && /^(nice|ionice)$/.test(wrapper))) k += 2;
        else if (a.startsWith('-') || /^[0-9.]+[smhd]?$/.test(a) || ASSIGNMENT.test(a)) k++;
        else break;
      }
    } else {
      break;
    }
  }
  return { cmd: k < words.length ? basename(words[k] ?? '') : '', args: words.slice(k + 1) };
}

function checkBash(raw: unknown, cwd: string, ctx: GuardContext, depth: number): Decision {
  if (typeof raw !== 'string') return deny('unparseable', 'The Bash command is missing.');
  let segments: Segment[];
  try {
    segments = parseShell(raw);
  } catch (error) {
    const why = error instanceof ShellParseError ? error.message : 'parse error';
    return deny('unparseable', `This shell command cannot be analyzed (${why}). Simplify it.`);
  }
  let dir = cwd;
  for (const seg of segments) {
    const { cmd, args } = commandOf(seg.words);
    const decision = checkSegment(seg, cmd, args, dir, ctx, depth);
    if (!decision.allow) return decision;
    if (cmd === 'cd') dir = args[0] ? resolvePath(args[0], dir, ctx.home) : ctx.home;
  }
  return ALLOW;
}

function checkSegment(
  seg: Segment,
  cmd: string,
  args: string[],
  cwd: string,
  ctx: GuardContext,
  depth: number,
): Decision {
  for (const r of seg.redirects) {
    const secret = checkSecretToken(r.target, cwd, ctx);
    if (!secret.allow) return secret;
    if (OUTPUT_OPS.has(r.op)) {
      const write = checkWritePath(r.target, cwd, ctx);
      if (!write.allow) return write;
    }
  }
  if (!cmd) return ALLOW;

  if (depth < 3) {
    const script = shellScript(cmd, args);
    if (script !== undefined) {
      const inner = checkBash(script, cwd, ctx, depth + 1);
      if (!inner.allow) return inner;
    }
  }
  const checks = [
    () => checkGitPush(cmd, args),
    () => checkSecretArgs(cmd, args, cwd, ctx),
    () => checkWriteCommand(cmd, args, cwd, ctx),
    () => checkNetwork(cmd, args, ctx),
  ];
  for (const check of checks) {
    const decision = check();
    if (!decision.allow) return decision;
  }
  return ALLOW;
}

/** The script string for `sh -c "..."` or `eval ...`, if this is one. */
function shellScript(cmd: string, args: string[]): string | undefined {
  if (cmd === 'eval') return args.join(' ');
  if (!SHELLS.has(cmd)) return undefined;
  const i = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
  return i >= 0 ? args[i + 1] : undefined;
}

function checkSecretToken(token: string, cwd: string, ctx: GuardContext): Decision {
  if (!token || /\s/.test(token)) return ALLOW;
  for (const c of withValuePart(token)) {
    if (!c || c.includes('$')) continue;
    if (wildcardHitsSecret(c, ctx)) {
      return deny('secret-read', 'This pattern would read secret files.', c);
    }
    const abs = resolvePath(c, cwd, ctx.home);
    if (isSecretPath(abs, ctx)) return denySecret(abs);
  }
  return ALLOW;
}

function checkSecretArgs(cmd: string, args: string[], cwd: string, ctx: GuardContext): Decision {
  if (NO_ARG_SECRET_CHECK.has(cmd)) return ALLOW;
  for (const a of args) {
    if (a.startsWith('-') && !a.includes('=')) continue;
    const decision = checkSecretToken(a, cwd, ctx);
    if (!decision.allow) return decision;
  }
  return ALLOW;
}

// ---------- git ----------

const GIT_VALUE_OPTS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
]);

function gitSubcommand(args: string[]): { sub: string; rest: string[] } {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (GIT_VALUE_OPTS.has(a)) i++;
    else if (!a.startsWith('-')) return { sub: a, rest: args.slice(i + 1) };
  }
  return { sub: '', rest: [] };
}

function checkGitPush(cmd: string, args: string[]): Decision {
  if (cmd !== 'git') return ALLOW;
  const { sub, rest } = gitSubcommand(args);
  if (sub !== 'push') return ALLOW;
  const forced = rest.some(
    (a) =>
      a === '--force' ||
      a === '--mirror' ||
      a.startsWith('--force-with-lease') ||
      a === '--force-if-includes' ||
      /^-[A-Za-z]*f[A-Za-z]*$/.test(a) ||
      (a.startsWith('+') && a.length > 1),
  );
  return forced
    ? deny('force-push', 'Force-pushing is not allowed. A human must rewrite shared history.')
    : ALLOW;
}

// ---------- writes from shell commands ----------

const WRITE_ALL = new Set([
  'rm',
  'mv',
  'touch',
  'mkdir',
  'rmdir',
  'tee',
  'truncate',
  'shred',
  'unlink',
]);
const WRITE_AFTER_FIRST = new Set(['chmod', 'chown', 'chgrp']);
const WRITE_LAST = new Set(['cp', 'install', 'ln', 'rsync']);

const positionals = (args: string[]): string[] => args.filter((a) => !a.startsWith('-'));

function checkWriteCommand(cmd: string, args: string[], cwd: string, ctx: GuardContext): Decision {
  let targets: string[] = [];
  if (WRITE_ALL.has(cmd)) targets = positionals(args);
  else if (WRITE_AFTER_FIRST.has(cmd)) targets = positionals(args).slice(1);
  else if (WRITE_LAST.has(cmd)) targets = positionals(args).slice(-1);
  else if (cmd === 'dd') targets = args.filter((a) => a.startsWith('of=')).map((a) => a.slice(3));
  else if (cmd === 'sed' && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place')) {
    const pos = positionals(args);
    targets = args.some((a) => a === '-e' || a === '-f') ? pos : pos.slice(1);
  } else if (cmd === 'git') {
    const { sub, rest } = gitSubcommand(args);
    if (sub === 'clone') targets = positionals(rest).slice(1, 2);
  }
  // An rsync destination like `host:path` is remote; the network rule checks the host.
  const local = cmd === 'rsync' ? targets.filter((t) => !SCP_HOST.test(t)) : targets;
  for (const t of local) {
    const decision = checkWritePath(t, cwd, ctx);
    if (!decision.allow) return decision;
  }
  return ALLOW;
}

// ---------- network ----------

const URL_HOST = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]*@)?(\[[^\]]+\]|[^/:?#\s]+)/i;
const SCP_HOST = /^(?:[^@/\s:]+@)?([A-Za-z0-9._-]+):(?!\/\/)/;
const GIT_SCP_HOST = /^[^@/\s:]+@([A-Za-z0-9._-]+):/;
const HTTP_TOOLS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'aria2c']);
const RAW_TOOLS = new Set(['nc', 'ncat', 'netcat', 'telnet', 'socat']);
const SSH_TOOLS = new Set(['ssh', 'sftp']);
const SSH_VALUE_OPTS = new Set([
  '-p',
  '-i',
  '-o',
  '-l',
  '-F',
  '-J',
  '-L',
  '-R',
  '-D',
  '-b',
  '-c',
  '-E',
  '-m',
  '-w',
  '-W',
  '-S',
  '-B',
]);
const RAW_VALUE_OPTS = new Set(['-p', '-w', '-s', '-i', '-q']);
const GIT_NET_SUBS = new Set([
  'clone',
  'fetch',
  'pull',
  'push',
  'ls-remote',
  'remote',
  'submodule',
]);

function urlHosts(args: string[]): string[] {
  const hosts: string[] = [];
  for (const a of args) {
    for (const part of withValuePart(a)) {
      const m = URL_HOST.exec(part);
      if (m?.[1]) hosts.push(m[1]);
    }
  }
  return hosts;
}

function firstPositional(args: string[], valueOpts: Set<string>): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (valueOpts.has(a)) i++;
    else if (!a.startsWith('-')) return a;
  }
  return undefined;
}

export function hostAllowed(host: string, ctx: GuardContext): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (ctx.config.allow_loopback && ['localhost', '127.0.0.1', '::1'].includes(h)) return true;
  return ctx.config.allowed_hosts.some((p) => {
    const pattern = p.toLowerCase();
    return pattern.startsWith('*.') ? h.endsWith(pattern.slice(1)) : h === pattern;
  });
}

function denyHost(host: string): Decision {
  return deny('network-allowlist', 'This host is not on the allowed list.', host);
}

function checkHosts(hosts: string[], ctx: GuardContext): Decision {
  const bad = hosts.find((h) => !hostAllowed(h, ctx));
  return bad === undefined ? ALLOW : denyHost(bad);
}

function undeterminable(cmd: string): Decision {
  return deny(
    'network-allowlist',
    `${cmd}: the destination host cannot be determined. Use a full URL.`,
  );
}

/** Allow one host if it is known and listed; deny if the command's host could not be found. */
function checkHost(cmd: string, host: string | undefined, ctx: GuardContext): Decision {
  return host ? checkHosts([host], ctx) : undeterminable(cmd);
}

function checkNetwork(cmd: string, args: string[], ctx: GuardContext): Decision {
  if (HTTP_TOOLS.has(cmd)) {
    const hosts = urlHosts(args);
    return hosts.length === 0 ? undeterminable(cmd) : checkHosts(hosts, ctx);
  }
  if (RAW_TOOLS.has(cmd)) {
    const tcp = args.map((a) => /^(?:TCP|UDP)[46]?:([^:]+)/i.exec(a)?.[1]).find(Boolean);
    const host = tcp ?? (cmd === 'socat' ? undefined : firstPositional(args, RAW_VALUE_OPTS));
    return checkHost(cmd, host, ctx);
  }
  if (SSH_TOOLS.has(cmd)) {
    const target = firstPositional(args, SSH_VALUE_OPTS);
    const host = target?.replace(/^[^@]*@/, '').replace(/:.*$/, '');
    return checkHost(cmd, host, ctx);
  }
  if (cmd === 'scp' || cmd === 'rsync') {
    const hosts = [
      ...urlHosts(args),
      ...args.filter((a) => !a.startsWith('-')).flatMap((a) => SCP_HOST.exec(a)?.[1] ?? []),
    ];
    return checkHosts(hosts, ctx);
  }
  if (cmd === 'git') {
    const { sub, rest } = gitSubcommand(args);
    if (!GIT_NET_SUBS.has(sub)) return ALLOW;
    const hosts = [...urlHosts(rest), ...rest.flatMap((a) => GIT_SCP_HOST.exec(a)?.[1] ?? [])];
    return checkHosts(hosts, ctx);
  }
  return ALLOW;
}

function checkWebFetch(raw: string | undefined, ctx: GuardContext): Decision {
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    return deny('network-allowlist', 'WebFetch needs a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return deny('network-allowlist', 'Only http and https URLs are allowed.');
  }
  return hostAllowed(url.hostname, ctx) ? ALLOW : denyHost(url.hostname);
}
