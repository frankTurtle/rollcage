/** Demo driver: runs the real CLI on a SYNTHETIC history with fixed dates and a fixed seed. */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli.ts';
import { parseDate } from '../src/dates.ts';
import { generateSynthetic } from '../src/synthetic.ts';

const SEED = 8;
const SINCE = '2025-10-06';
const UNTIL = '2026-07-06';
const ROLLOUT = '2026-04-06';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
const tty = process.stdout.isTTY;
const bold = (t: string) => (tty ? `\u001b[1m${t}\u001b[0m` : t);
const header = (t: string) => console.log(`\n${bold(`== ${t} ==`)}`);

const ARGS = [
  'report',
  ...['--source', 'synthetic', '--seed', String(SEED)],
  ...['--since', SINCE, '--until', UNTIL, '--compare-at', ROLLOUT],
];

async function report(extra: string[]): Promise<void> {
  const code = await runCli([...ARGS, ...extra], {
    env: {},
    out: (t) => console.log(t),
    err: (t) => console.error(t),
  });
  if (code !== 0) process.exitCode = code;
}

function before(): void {
  header('BEFORE: no measurement');
  const { changes } = generateSynthetic({
    seed: SEED,
    range: { since: parseDate(SINCE, 'since'), until: parseDate(UNTIL, 'until') },
    rolloutAt: parseDate(ROLLOUT, 'rollout'),
  });
  console.log(`Merged pull requests in the period: ${changes.length}`);
  console.log('That number goes up after a rollout. It says nothing about delivery.');
}

async function run(): Promise<void> {
  header(`RUN: the five DORA metrics, before and after ${ROLLOUT} (SYNTHETIC data)`);
  await report(['--out', out]);
}

async function after(): Promise<void> {
  if (!existsSync(join(out, 'summary.md'))) await run();
  header('AFTER: the CFO summary');
  console.log(readFileSync(join(out, 'summary.md'), 'utf8'));
  console.log(
    `Open the dashboard in a browser (one file, no server):\n  ${join(out, 'dora.html')}`,
  );
}

async function metric(): Promise<void> {
  header('METRIC: the five numbers');
  await report([]);
}

const stage = process.argv[2] ?? 'all';
if (stage === 'all' || stage === 'run') rmSync(out, { recursive: true, force: true });
if (stage === 'all') {
  before();
  await run();
  await after();
  await metric();
} else if (stage === 'before') before();
else if (stage === 'run') await run();
else if (stage === 'after') await after();
else if (stage === 'metric') await metric();
else {
  console.error(`unknown stage: ${stage}`);
  process.exitCode = 2;
}
