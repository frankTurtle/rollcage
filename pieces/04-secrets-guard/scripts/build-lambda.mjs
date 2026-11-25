// Bundles the Lambda handler (including the AWS SDK clients) into dist/lambda/index.mjs.
// `sam build` then only copies that folder. We bundle ourselves because the SAM esbuild builder
// runs `npm install` on the package, which cannot resolve this monorepo's workspace dependency.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/lambda/index.ts'],
  outfile: 'dist/lambda/index.mjs',
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('wrote dist/lambda/index.mjs');
