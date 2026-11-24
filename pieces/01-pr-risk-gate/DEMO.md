# Demo script: 01 PR risk gate

Video: "AI made your team faster. DORA says it also made you break more. Here's the fix."
(The DORA instability claim is not yet confirmed in `docs/sources.md`. Verify before recording,
or open with the Stack Overflow figure below.)

Run time: under 3 minutes, offline, deterministic. Set a large terminal font.

```bash
pnpm install
pnpm demo:01:reset     # clean state before every take
pnpm demo:01           # the whole demo end to end
```

`DEMO_LIVE=1 pnpm demo:01` calls the live model instead of the recorded responses and needs
`ANTHROPIC_API_KEY`. Live wording will differ from the recording.

## 0:00 to 0:20, the problem

Say: "AI makes changes faster. Reviewers get 'almost right, but not quite' code, and the risky
changes look just like the safe ones." Stat: 66% of developers cite "almost right, but not
quite" as their biggest frustration (Stack Overflow 2025; `docs/sources.md`, VERIFY).

## 0:20 to 1:00, why it matters

An auth change with no tests merges at the same speed as a docs fix. The cost shows up later as
incidents and rework, which is what change failure rate measures (piece 03).

## 1:00 to 5:30, screen share

Three PRs live in `demo/fixtures`: a docs-only change, a medium feature, and an auth change with
no tests.

**Before (no gate).** Observe mode reports but never blocks, which is what happens today:

```bash
pnpm demo:01 before
```

All three exit 0. The third prints "would block" but merges.

**Run.** Enforce mode on the same three PRs:

```bash
pnpm demo:01 run
```

PR 1 and PR 2 pass. PR 3 fails, with reasons that cite `file:line`, and the check exits 1.

**After.** Add tests to PR 3, then add approvals:

```bash
pnpm demo:01 after
```

First run: tests present, still fails because it needs a second human approval. Second run with
two approvers: passes. Point out that the gate never approved anything; people did.

Show the audit log (`demo/out/audit.jsonl`): one line per decision, each linked to the one
before it.

## 5:30 to 6:30, the metric

```bash
pnpm demo:01 metric
```

Prints "high-risk PRs that shipped with tests" for a before period and an after period. These
two logs are synthetic, generated with a fixed seed. Say so on camera. The point is how the
number is read, not a measured result. Run `metrics` on your own audit log for a real one.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

From `pnpm demo:01 run` showing PR 3 failing with cited reasons, through the `after` run
passing once tests and approvals exist. Skip the metric.

## Reset

`pnpm demo:01:reset` deletes `pieces/01-pr-risk-gate/demo/out`.
