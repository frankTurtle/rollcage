# Demo script: 02 agent policy

Video: "Your engineers are already using AI. Here's the one-page policy and the guardrails that
enforce it."

Run time: about 2 minutes, offline, deterministic. Large terminal font.

```bash
pnpm install
pnpm demo:02:reset   # clean state before every take
pnpm demo:02         # the whole demo end to end
```

The demo builds a throwaway fake repo under `demo/out/` with an obviously fake `.env`, then feeds
real hook payload shapes to the real hook. No agent and no network are involved.

## 0:00 to 0:20, the problem

Say: "Your engineers already use coding agents. Do you know what those agents can read?" Stat:
46% of developers distrust the accuracy of AI tools (Stack Overflow 2025; `docs/sources.md`, VERIFY).

## 0:20 to 1:00, why it matters

An agent runs with the developer's permissions. One `cat .env` puts a cloud key into a prompt that
leaves the building. One force-push rewrites a shared branch. You need rules, and you need proof.

## 1:00 to 5:30, screen share

**Before: no guardrail.** Show what an agent can read today:

```bash
pnpm demo:02 before
```

The fake `.env` prints in full, fake AWS key included.

**Run: the same request through the hook.**

```bash
pnpm demo:02 run
```

A table of ten tool calls: the `.env` read, a `cat .env`, a force-push, a write to `~/.bashrc`, a
`curl` to an unlisted host and a WebFetch to one are blocked with the rule name; reading source,
running tests and fetching docs from an allowed host go through. Show the one-line reason the agent
sees for the `.env` read.

**After: the evidence.**

```bash
pnpm demo:02 after
```

Prints the audit log (one line per decision, hash-chained) and verifies the chain. Then it edits
one line and shows the verifier catch it.

Optional, live: open Claude Code in `pieces/02-agent-policy/demo/out/fake-repo` (its
`.claude/settings.json` is wired to the hook) and ask it to "read the .env file". It is refused.

## 5:30 to 6:30, the metric

```bash
pnpm demo:02 metric
```

Blocked actions per week and the percent of sessions with a complete audit trail, computed from the
log the demo just wrote.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

`pnpm demo:02 before`, then `pnpm demo:02 run` through the `.env` block and the audit line.

## Reset

`pnpm demo:02:reset` deletes `pieces/02-agent-policy/demo/out`.
