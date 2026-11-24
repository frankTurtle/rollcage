import { enableCompileCache } from 'node:module';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { runCli } from './cli.js';

// Reuse compiled code across the two hook processes that run for every tool call.
enableCompileCache();

process.exitCode = runCli(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  stdin: () => readFileSync(0, 'utf8'),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});
