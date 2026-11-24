/** Small helpers the pieces' demo scripts share: colors only where they mean something, and stages. */

const paint = (code: string, text: string): string =>
  process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text;

export const bold = (t: string): string => paint('1', t);
export const red = (t: string): string => paint('31', t);
export const green = (t: string): string => paint('32', t);

export const header = (t: string): void => console.log(`\n${bold(`== ${t} ==`)}`);

/**
 * Run a demo's named stages. `requested` is one stage name, or "all" for every stage in the order
 * given. Returns a process exit code: 0, or 2 for an unknown stage name.
 */
export async function runStages(
  stages: Record<string, () => void | Promise<void>>,
  requested = 'all',
): Promise<number> {
  const names = requested === 'all' ? Object.keys(stages) : [requested];
  for (const name of names) {
    const stage = stages[name];
    if (!stage) {
      console.error(`unknown stage: ${name} (use all or ${Object.keys(stages).join(', ')})`);
      return 2;
    }
    await stage();
  }
  return 0;
}
