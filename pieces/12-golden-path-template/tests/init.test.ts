import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli, type Io } from '../src/cli.ts';
import { CALLER, DEFAULT_PIECES, init } from '../src/init.ts';
import { checkPins } from '../src/pins.ts';
import { ScaffoldError } from '../src/scaffold.ts';
import { tempDir, writeFile } from './helpers.ts';

const SHA = 'a'.repeat(40);
const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf8');

function repo(): string {
  const dir = tempDir();
  mkdirSync(join(dir, '.git'));
  return dir;
}

describe('init: add guardrails to an existing repository', () => {
  it('writes the default pieces, wired to the ref, and reports the check names', () => {
    const dir = repo();
    const result = init({ targetDir: dir, ref: SHA });
    expect(result.created).toContain(CALLER);
    expect(result.created).toContain('risk-gate.yml');
    expect(result.checks).toEqual([
      'risk-gate / gate',
      'secrets / gitleaks',
      'sbom / sbom',
      'policy / policy',
    ]);
    expect(result.warnings).toEqual([]);
    expect(read(dir, '.github/workflows/rollcage-sbom-vuln.yml')).toContain(
      `frankTurtle/rollcage/pieces/05-sbom-vuln-triage@${SHA}`,
    );
    expect(read(dir, CALLER).match(/uses: \.\/\.github/g)).toHaveLength(DEFAULT_PIECES.length);
  });

  it('writes workflows that pass the pin check', () => {
    const dir = repo();
    init({ targetDir: dir, ref: SHA });
    const files = Object.fromEntries(
      ['rollcage', 'rollcage-gate-pr-risk', 'rollcage-secrets-scan'].map((n) => [
        n,
        read(dir, `.github/workflows/${n}.yml`),
      ]),
    );
    expect(checkPins(files, SHA).errors).toEqual([]);
  });

  it('drops the pnpm setup step, which fails in a repository with no pnpm version', () => {
    const dir = repo();
    init({ targetDir: dir, ref: SHA });
    expect(read(dir, '.github/workflows/rollcage-gate-pr-risk.yml')).not.toContain('pnpm');
  });

  it('never overwrites: existing files are skipped and left byte for byte', () => {
    const dir = repo();
    writeFile(dir, 'risk-gate.yml', 'mode: enforce\n');
    const result = init({ targetDir: dir, ref: SHA });
    expect(result.skipped).toEqual(['risk-gate.yml']);
    expect(result.created).not.toContain('risk-gate.yml');
    expect(read(dir, 'risk-gate.yml')).toBe('mode: enforce\n');
  });

  it('running twice creates nothing the second time', () => {
    const dir = repo();
    init({ targetDir: dir, ref: SHA });
    const again = init({ targetDir: dir, ref: SHA });
    expect(again.created).toEqual([]);
    expect(again.skipped.length).toBeGreaterThan(0);
  });

  it('--dry-run lists the files and writes nothing', () => {
    const dir = repo();
    const result = init({ targetDir: dir, ref: SHA, dryRun: true });
    expect(result.created).toContain(CALLER);
    expect(existsSync(join(dir, '.github'))).toBe(false);
  });

  it('honors the chosen pieces and warns that provenance needs an artifact', () => {
    const dir = repo();
    const result = init({ targetDir: dir, ref: SHA, pieces: ['secrets', 'provenance'] });
    expect(result.checks).toEqual(['secrets / gitleaks', 'provenance / provenance']);
    expect(existsSync(join(dir, 'risk-gate.yml'))).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/provenance verifies a build artifact/);
  });

  it('adds governance files only with extras, and then needs an owner', () => {
    const dir = repo();
    expect(() => init({ targetDir: dir, ref: SHA, extras: true })).toThrow(ScaffoldError);
    init({ targetDir: dir, ref: SHA, extras: true, owner: 'my-org' });
    expect(read(dir, '.github/CODEOWNERS')).toContain('@my-org');
    const plain = repo();
    init({ targetDir: plain, ref: SHA });
    expect(existsSync(join(plain, '.github/CODEOWNERS'))).toBe(false);
  });

  it('warns about a movable ref and a directory with no .git', () => {
    const dir = tempDir();
    const result = init({ targetDir: dir, ref: 'v0.3.0' });
    const text = result.warnings.join('\n');
    expect(text).toMatch(/not a commit SHA/);
    expect(text).toMatch(/no \.git folder/);
  });

  it('rejects a missing directory, a bad ref and an empty piece list', () => {
    expect(() => init({ targetDir: join(tempDir(), 'nope') })).toThrow(/not a directory/);
    expect(() => init({ targetDir: repo(), ref: 'bad ref' })).toThrow(/invalid ref/);
    expect(() => init({ targetDir: repo(), pieces: [] })).toThrow(/at least one piece/);
  });
});

describe('init command', () => {
  const run = (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t) };
    return { code: runCli(argv, io), out: out.join('\n'), err: err.join('\n') };
  };

  it('creates files and prints the next step', () => {
    const dir = repo();
    const r = run(['init', dir, '--ref', SHA]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Created 6 files/);
    expect(r.out).toMatch(/require these checks on main: risk-gate \/ gate/);
  });

  it('says "Would create" for --dry-run', () => {
    const r = run(['init', repo(), '--ref', SHA, '--dry-run']);
    expect(r.out).toMatch(/Would create 6 files/);
  });

  it('exits 2 for an unknown piece and 1 for a refusal', () => {
    expect(run(['init', repo(), '--pieces', 'bogus']).code).toBe(2);
    const r = run(['init', repo(), '--extras']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--extras needs --owner/);
  });
});
