// Bundles the CLI into one file that adopters copy next to their git hooks (no pnpm, no tsx).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/bin.ts'],
  outfile: 'dist/secrets-guard.mjs',
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('wrote dist/secrets-guard.mjs');
