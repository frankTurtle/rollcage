/** Demo driver: runs the real CLI on a SYNTHETIC history with fixed dates and a fixed seed. */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli.ts';
import { parseDate } from '../src/cli.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const tty = process.stdout.isTTY;
const bold = (t: string) => (tty ? `\u001b[1m${t}\u001b[0m` : t);
const header = (t: string) => console.log(`\n${bold(`== ${t} ==`)}`);

const ARGS = [
  'report',
  '--source',
  'synthetic',
  '--seed',
  '8',
  '--since',
  '2025-10-06',
  '--until',
  '2026-07-06',
  '--compare-at',
  '2026-04-06',
];

async function report(extra: string[]): Promise<void> {
  const code = await runCli([...ARGS, ...extra], {
    env: {},
    out: (t) => console.log(t),
    err: (t) => console.error(t),
  });
  if (code !== 0) process.exitCode = code;
}

async function before(): Promise<void> {
  header('BEFORE: no measurement');
  const data = JSON.parse(await readData());
  console.log(`Merged pull requests in the period: ${data.changes.length}`);
  console.log('That number goes up after a rollout. It says nothing about delivery.');
}

async function readData(): Promise<string> {
  const { generateSynthetic } = await import('../src/synthetic.ts');
  return JSON.stringify(
    generateSynthetic({
      seed: 8,
      range: {
        since: parseDate('2025-10-06', '--since'),
        until: parseDate('2026-07-06', '--until'),
      },
      rolloutAt: parseDate('2026-04-06', 'rollout'),
    }),
  );
}

async function run(): Promise<void> {
  header('RUN: the five DORA metrics, before and after 2026-04-06 (SYNTHETIC data)');
  await report(['--out', out]);
}

function after(): void {
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

const stages = { before, run, after, metric };
const requested = process.argv[2] ?? 'all';
if (requested === 'all' || requested === 'run') rmSync(out, { recursive: true, force: true });
for (const name of requested === 'all' ? Object.keys(stages) : [requested]) {
  const stage = stages[name as keyof typeof stages];
  if (!stage) {
    console.error(`unknown stage: ${name}`);
    process.exitCode = 2;
    break;
  }
  if (name === 'after' && !existsSync(join(out, 'summary.md'))) await run();
  await stage();
}
