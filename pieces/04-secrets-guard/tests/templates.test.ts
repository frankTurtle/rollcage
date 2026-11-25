import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_PATH } from '../src/lambda/config.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('AC-12 SAM template guardrails', () => {
  const template = read('template.yaml');

  it('never allows deleting a key, or any wildcard IAM action', () => {
    expect(template).not.toMatch(/iam:Delete/i);
    expect(template).not.toMatch(/iam:\*/);
    expect(template).not.toMatch(/Action:\s*['"]?\*/);
    expect(template).not.toMatch(/AdministratorAccess|PowerUser/);
  });

  it('defaults to dry run and has no default account allowlist', () => {
    expect(template).toMatch(/DryRun:\s*\n\s*Type: String\s*\n\s*Default: 'true'/);
    const params = template.slice(
      template.indexOf('AllowedAccountIds:'),
      template.indexOf('UserPath:'),
    );
    expect(params).not.toContain('Default:');
  });

  it('scopes the key-changing actions to the guarded user path', () => {
    const block = template.slice(template.indexOf('iam:GetUser'), template.indexOf('sns:Publish'));
    expect(block).toContain('iam:UpdateAccessKey');
    expect(block).toContain('iam:ListAccessKeys');
    expect(block).toContain('iam:TagUser');
    expect(block).toContain('user${UserPath}*');
    expect(template.match(/Resource: '\*'/g)).toHaveLength(1);
  });

  it('deploys the bundle built by build:lambda, on a supported runtime', () => {
    expect(template).toContain('CodeUri: dist/lambda');
    expect(template).toMatch(/Runtime: nodejs(22|24)\.x/);
    expect(read('scripts/build-lambda.mjs')).toContain("outfile: 'dist/lambda/index.mjs'");
  });

  it('uses the same default user path as the code', () => {
    expect(template).toContain(`Default: ${DEFAULT_USER_PATH}`);
  });

  it('keeps the audit table on stack deletion and limits concurrency', () => {
    expect(template).toContain('DeletionPolicy: Retain');
    expect(template).toContain('ReservedConcurrentExecutions: 2');
  });
});

describe('AC-12 templates ship safely', () => {
  it('the workflow pins actions by commit SHA and is read-only', () => {
    const wf = read('templates/workflows/secrets-scan.yml');
    for (const use of wf.match(/uses: \S+/g) ?? []) expect(use).toMatch(/@[0-9a-f]{40}$/);
    expect(wf).toContain('permissions:\n  contents: read');
    expect(wf).toContain('schedule:');
    expect(read('../../.github/workflows/secrets-scan.yml')).toBe(wf);
  });

  it('the gitleaks config extends the defaults', () => {
    expect(read('templates/gitleaks.toml')).toContain('useDefault = true');
  });

  it('no file in the piece contains a realistic access key other than ones ending in EXAMPLE', () => {
    const files = [
      'README.md',
      'DEPLOY.md',
      'DEMO.md',
      'template.yaml',
      'tests/fixtures/alert-created.json',
    ];
    for (const f of files) {
      for (const key of read(f).match(/\bAKIA[A-Z2-7]{16}\b/g) ?? [])
        expect(key).toMatch(/EXAMPLE$/);
    }
  });
});
