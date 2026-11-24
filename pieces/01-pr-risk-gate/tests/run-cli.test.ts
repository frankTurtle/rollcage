import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuditLogger,
  FakeLlm,
  RecordReplayLlm,
  readAuditRecords,
  verifyAuditChain,
} from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import { loadConfig } from '../src/config.ts';
import { selectLlm, UnavailableLlm } from '../src/llm-select.ts';
import { computeMetrics, formatMetrics } from '../src/metrics.ts';
import { runGate } from '../src/run.ts';
import { writeSyntheticHistory } from '../src/synthetic.ts';
import { ctx, demoConfig, DEMO_CONFIG, FX, fixture, LLM_FX, MemoryIO } from './helpers.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'rg-'));
const modelReply = (level: string) =>
  JSON.stringify({ risk_level: level, reasons: [], required_checks: [], assumptions: [] });

describe('runGate', () => {
  const auth = fixture('pr3-auth-no-tests.diff');

  it('blocks a high-risk PR with no tests and audits the decision (AC-7, AC-11)', async () => {
    const dir = tmp();
    const log = join(dir, 'a.jsonl');
    const io = new MemoryIO(ctx(auth));
    const r = await runGate({
      io,
      llm: new FakeLlm([modelReply('high')]),
      config: demoConfig(),
      audit: new AuditLogger(log),
    });
    expect(r.exitCode).toBe(1);
    expect(io.published).toHaveLength(1);
    const [rec] = readAuditRecords(log);
    expect(rec).toMatchObject({
      actor: 'pr-risk-gate',
      action: 'evaluate',
      decision: 'fail',
      detail: {
        pr: 7,
        level: 'high',
        hasTests: false,
        violations: ['tests-required', 'approvals-required'],
        modelSource: 'model',
      },
    });
    expect(rec?.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAuditChain(log).ok).toBe(true);
  });

  it('AC-6 a model that says low cannot lower a high pre-score', async () => {
    const r = await runGate({
      io: new MemoryIO(ctx(auth)),
      llm: new FakeLlm([modelReply('low')]),
      config: demoConfig(),
    });
    expect(r.level).toBe('high');
    expect(r.exitCode).toBe(1);
  });

  it('a model can raise the level', async () => {
    const r = await runGate({
      io: new MemoryIO(ctx(fixture('pr1-docs.diff'))),
      llm: new FakeLlm([modelReply('medium')]),
      config: demoConfig(),
    });
    expect(r.level).toBe('medium');
  });

  it('fails closed on a high-risk path when the model is down', async () => {
    const r = await runGate({
      io: new MemoryIO(ctx(auth)),
      llm: new UnavailableLlm('down'),
      config: demoConfig(),
    });
    expect(r.review.source).toBe('fallback');
    expect(r.exitCode).toBe(1);
    expect(r.review.assumptions[0]).toContain('Model review unavailable');
  });

  it('passes with tests and two approvals, and still never approves anything itself', async () => {
    const io = new MemoryIO(ctx(fixture('pr3-auth-with-tests.diff'), { approvals: ['x', 'y'] }));
    const r = await runGate({ io, llm: new FakeLlm([modelReply('high')]), config: demoConfig() });
    expect(r.exitCode).toBe(0);
  });

  it('AC-8 observe mode exits 0 and audits observe-would-fail', async () => {
    const log = join(tmp(), 'o.jsonl');
    const config = loadConfig('mode: observe');
    const r = await runGate({
      io: new MemoryIO(ctx(auth)),
      llm: new FakeLlm([modelReply('high')]),
      config,
      audit: new AuditLogger(log),
    });
    expect(r.exitCode).toBe(0);
    expect(readAuditRecords(log)[0]?.decision).toBe('observe-would-fail');
  });

  it('records pass for a clean PR', async () => {
    const log = join(tmp(), 'p.jsonl');
    await runGate({
      io: new MemoryIO(ctx(fixture('pr1-docs.diff'))),
      llm: new FakeLlm([modelReply('low')]),
      config: demoConfig(),
      audit: new AuditLogger(log),
    });
    expect(readAuditRecords(log)[0]?.decision).toBe('pass');
  });
});

describe('demo fixtures stay in sync with the prompt (recorded replies are used, not the fallback)', () => {
  it.each([
    ['pr1-docs', 'pr1-docs', 'low', 0],
    ['pr2-feature', 'pr2-feature', 'medium', 0],
    ['pr3-auth-no-tests', 'pr3-auth-no-tests', 'high', 1],
    ['pr3-auth-with-tests', 'pr3-auth-with-tests', 'high', 1],
    ['pr3-auth-with-tests', 'pr3-auth-approved', 'high', 0],
  ])('%s with %s meta', async (diff, meta, level, exit) => {
    const lines: string[] = [];
    const code = await runCli(
      [
        'evaluate',
        '--diff',
        join(FX, `${diff}.diff`),
        '--meta',
        join(FX, `${meta}.meta.json`),
        '--config',
        DEMO_CONFIG,
        '--llm',
        'replay',
        '--fixtures',
        LLM_FX,
        '--summary-only',
      ],
      { env: {}, out: (t) => lines.push(t), err: (t) => lines.push(t) },
    );
    expect(lines.join('\n')).toContain(`level=${level.toUpperCase()}`);
    expect(lines.join('\n')).not.toContain('model not used');
    expect(code).toBe(exit);
  });
});

describe('selectLlm', () => {
  it('chooses by mode', () => {
    expect(selectLlm('none', {})).toBeInstanceOf(UnavailableLlm);
    expect(selectLlm('auto', {})).toBeInstanceOf(UnavailableLlm);
    expect(selectLlm('auto', { ANTHROPIC_API_KEY: 'k' }).constructor.name).toBe('AnthropicLlm');
    expect(selectLlm('live', { ANTHROPIC_API_KEY: 'k' }).constructor.name).toBe('AnthropicLlm');
    expect(selectLlm('replay', {}, LLM_FX)).toBeInstanceOf(RecordReplayLlm);
    expect(() => selectLlm('replay', {})).toThrow('--fixtures');
    expect(() => selectLlm('live', {})).toThrow('ANTHROPIC_API_KEY');
  });

  it('UnavailableLlm always rejects', async () => {
    await expect(new UnavailableLlm('why').complete()).rejects.toThrow('why');
  });
});

describe('AC-13 metrics', () => {
  it('uses each PR latest decision', () => {
    const dir = tmp();
    const log = join(dir, 'm.jsonl');
    const a = new AuditLogger(log);
    const add = (pr: number, level: string, hasTests: boolean, decision: string) =>
      a.append({
        actor: 'pr-risk-gate',
        action: 'evaluate',
        input: pr,
        decision,
        detail: { pr, level, hasTests },
      });
    add(1, 'high', false, 'fail');
    add(1, 'high', true, 'pass'); // fixed after being blocked
    add(2, 'high', false, 'fail');
    add(3, 'low', false, 'pass');
    a.append({
      actor: 'someone-else',
      action: 'evaluate',
      input: 0,
      decision: 'x',
      detail: { pr: 9 },
    });
    a.append({ actor: 'pr-risk-gate', action: 'evaluate', input: 0, decision: 'x' });
    const m = computeMetrics(readAuditRecords(log));
    expect(m).toEqual({
      prs: 3,
      highRisk: 2,
      highRiskWithTests: 1,
      pctHighRiskWithTests: 50,
      blocked: 1,
    });
    expect(formatMetrics('label', m)).toContain('50%');
  });

  it('is n/a with no high-risk PRs', () => {
    const m = computeMetrics([]);
    expect(m.pctHighRiskWithTests).toBeNull();
    expect(formatMetrics('x', m)).toContain('n/a');
  });

  it('synthetic history is deterministic and the gated one ends at 100%', () => {
    const dir = tmp();
    const [a, b, c] = ['a', 'b', 'c'].map((n) => join(dir, `${n}.jsonl`)) as [
      string,
      string,
      string,
    ];
    writeSyntheticHistory(a, { seed: 7, prs: 60, gated: false });
    writeSyntheticHistory(b, { seed: 7, prs: 60, gated: false });
    writeSyntheticHistory(c, { seed: 7, prs: 60, gated: true });
    expect(readFileSync(a, 'utf8')).toBe(readFileSync(b, 'utf8'));
    expect(verifyAuditChain(a).ok).toBe(true);
    const before = computeMetrics(readAuditRecords(a));
    const after = computeMetrics(readAuditRecords(c));
    expect(before.pctHighRiskWithTests).toBeLessThan(100);
    expect(after.pctHighRiskWithTests).toBe(100);
    expect(after.prs).toBe(60);
  });
});

describe('cli', () => {
  const run = async (argv: string[], env: Record<string, string | undefined> = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const fetchImpl = async () => {
      throw new Error('network disabled in tests');
    };
    const code = await runCli(argv, {
      env,
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      fetchImpl,
    });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const local = [
    'evaluate',
    '--diff',
    join(FX, 'pr3-auth-no-tests.diff'),
    '--meta',
    join(FX, 'pr3-auth-no-tests.meta.json'),
    '--llm',
    'none',
  ];

  it('prints usage for an unknown command and errors for bad input', async () => {
    expect((await run([])).code).toBe(2);
    expect((await run(['bogus'])).err).toContain('Usage');
    expect((await run([...local, '--mode', 'strict'])).err).toContain('--mode');
    expect((await run([...local, '--config', '/nope/risk-gate.yml'])).err).toContain(
      'config file not found',
    );
    expect((await run(['metrics'])).err).toContain('--log');
    expect((await run(['synthetic'])).err).toContain('--out');
  });

  it('evaluate without a model uses the pre-score, prints the comment and exits 1', async () => {
    const r = await run(local);
    expect(r.code).toBe(1);
    expect(r.out).toContain('PR risk gate: HIGH risk, blocked');
    expect(r.out).toContain('FAIL  level=HIGH (pre-score high, model not used)');
  });

  it('observe override reports WOULD BLOCK and exits 0', async () => {
    const r = await run([...local, '--mode', 'observe', '--summary-only']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('WOULD BLOCK');
    expect(r.out).not.toContain('<!-- pr-risk-gate');
  });

  it('metrics and synthetic commands work end to end', async () => {
    const f = join(tmp(), 's.jsonl');
    expect((await run(['synthetic', '--out', f, '--prs', '10', '--gated'])).out).toContain(
      'SYNTHETIC',
    );
    expect((await run(['metrics', '--log', f, '--label', 'L'])).out).toContain('L');
  });

  it('GitHub mode reads from the API and updates the comment; dry-run does not post', async () => {
    const eventPath = join(tmp(), 'event.json');
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 5 } }));
    const calls: string[] = [];
    const diff = fixture('pr1-docs.diff');
    const fetchImpl = async (url: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      calls.push(`${method} ${url.replace('https://api.github.com', '').split('?')[0]}`);
      if (url.endsWith('/pulls/5')) {
        return new Headers(init.headers).get('accept') === 'application/vnd.github.diff'
          ? new Response(diff)
          : new Response(
              JSON.stringify({ number: 5, title: 'Docs', user: { login: 'd' }, labels: [] }),
            );
      }
      return new Response('[]');
    };
    const env = {
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_TOKEN: 'test-token-not-real',
      GITHUB_EVENT_PATH: eventPath,
    };
    const out: string[] = [];
    const deps = { env, out: (t: string) => out.push(t), err: () => undefined, fetchImpl };
    expect(await runCli(['evaluate', '--llm', 'none'], deps)).toBe(0);
    expect(calls).toContain('POST /repos/o/r/issues/5/comments');
    calls.length = 0;
    expect(await runCli(['evaluate', '--llm', 'none', '--dry-run'], deps)).toBe(0);
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
    expect(out.join('\n')).toContain('dry-run');
  });

  it('GitHub mode explains what is missing', async () => {
    expect((await run(['evaluate'])).err).toContain('GITHUB_REPOSITORY');
    const noPr = await run(['evaluate'], { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' });
    expect(noPr.err).toContain('no PR number');
    const f = join(tmp(), 'e.json');
    writeFileSync(f, JSON.stringify({ number: 8 }));
    const viaNumber = await run(['evaluate', '--llm', 'none'], {
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_TOKEN: 't',
      GITHUB_EVENT_PATH: f,
    });
    expect(viaNumber.err).not.toContain('no PR number'); // number came from the event; the call then fails on the network stub
    const emptyEvent = join(tmp(), 'e2.json');
    writeFileSync(emptyEvent, '{}');
    expect(
      (
        await run(['evaluate', '--pr', '5'], {
          GITHUB_REPOSITORY: 'o/r',
          GITHUB_TOKEN: 't',
          GITHUB_EVENT_PATH: emptyEvent,
        })
      ).err,
    ).not.toContain('no PR number');
  });
});
