import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { runCli } from './cli.js';

process.exitCode = runCli(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  stdin: () => readFileSync(0, 'utf8'),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
});
