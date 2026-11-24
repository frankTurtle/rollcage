/**
 * Writes the replay fixtures the demo uses (demo/llm-fixtures).
 *
 * By default the "live" model is a scripted stand-in, so these fixtures are HAND-AUTHORED, not real
 * model output. With DEMO_LIVE=1 and ANTHROPIC_API_KEY set, it records real responses instead.
 * Re-run this whenever the prompt in src/review.ts changes; the integration test fails if the
 * fixtures are stale.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnthropicLlm, FakeLlm, RecordReplayLlm, isLiveMode } from '@adl/shared';
import type { LlmClient } from '@adl/shared';
import { loadConfig } from '../src/config.ts';
import { parseDiff } from '../src/diff.ts';
import { prescore } from '../src/prescore.ts';
import { reviewPr } from '../src/review.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const config = loadConfig(readFileSync(join(here, 'risk-gate.demo.yml'), 'utf8'));
const live = isLiveMode(process.env);

function scripted(name: string, addedLines: Record<string, number[]>): string {
  const session = addedLines['src/auth/session.ts'] ?? [];
  const discount = addedLines['src/cart/discount.ts'] ?? [];
  if (name === 'pr1-docs') {
    return JSON.stringify({
      risk_level: 'low',
      reasons: [],
      required_checks: [],
      assumptions: ['Only documentation files changed.'],
    });
  }
  if (name === 'pr2-feature') {
    return JSON.stringify({
      risk_level: 'medium',
      reasons: [
        {
          file: 'src/cart/discount.ts',
          line: discount[13] ?? 1,
          text: 'Discount rules are hard-coded and the percent is not bounded; a bad rule could produce a negative total.',
        },
      ],
      required_checks: ['Add a test for a rule with a percent above 100.'],
      assumptions: ['Assumed RULES is only edited by developers, not loaded from user input.'],
    });
  }
  return JSON.stringify({
    risk_level: 'high',
    reasons: [
      {
        file: 'src/auth/session.ts',
        line: session[5] ?? 1,
        text: 'Token is decoded but its signature is no longer verified, so a forged token with a future expiry would be accepted.',
      },
      {
        file: 'src/auth/session.ts',
        line: session[2] ?? 1,
        text: 'Sessions are cached by raw token and served until the token expiry, so revoking a session has no effect until it expires.',
      },
    ],
    required_checks: [
      'Add a test that a token with an invalid signature is rejected.',
      'Add a test that an expired token is rejected.',
    ],
    assumptions: [
      'Assumed the removed verifyToken call was the only signature check on this path.',
      'Exploitability is not confirmed; this is a reading of the diff, not a test.',
    ],
  });
}

for (const name of ['pr1-docs', 'pr2-feature', 'pr3-auth-no-tests', 'pr3-auth-with-tests']) {
  const diff = readFileSync(join(fixtures, `${name}.diff`), 'utf8');
  const meta = JSON.parse(readFileSync(join(fixtures, `${name}.meta.json`), 'utf8')) as {
    number: number;
    title: string;
    author: string;
    labels: string[];
  };
  const files = parseDiff(diff);
  const addedLines = Object.fromEntries(files.map((f) => [f.path, f.addedLines]));
  const backend: LlmClient = live
    ? new AnthropicLlm(process.env)
    : new FakeLlm([scripted(name.replace('-no-tests', '').replace('-with-tests', ''), addedLines)]);
  const llm = new RecordReplayLlm(join(here, 'llm-fixtures'), 'record', backend);
  const pre = prescore(files, config);
  const review = await reviewPr({ llm, meta, diffText: diff, files, pre, config });
  console.log(`${name}: recorded (${review.source}, ${review.riskLevel})`);
}
