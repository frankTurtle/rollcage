import { runCli } from './cli.js';
import { systemPrecommitDeps } from './system.js';

process.exitCode = runCli(process.argv.slice(2), {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  precommit: systemPrecommitDeps,
});
