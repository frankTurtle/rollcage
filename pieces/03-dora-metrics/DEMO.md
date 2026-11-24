# Demo script: 03 DORA metrics

Video: "How to prove AI is paying off: the DORA numbers your CFO will understand." (DORA now
lists five metrics, so the title says "five" if you want it exact.)

Run time: about 1 minute, offline, deterministic. Large terminal font.

```bash
pnpm install
pnpm demo:03:reset   # clean state before every take
pnpm demo:03         # the whole demo end to end
```

The demo uses a **synthetic** history generated with a fixed seed: 26 weeks, with a made-up AI
rollout on a made-up date. Say so on camera. It shows how the numbers read, not a result.

## 0:00 to 0:20, the problem

Say: "You rolled out AI coding tools. How do you show it paid off?" Stat: 84% of developers use
or plan to use AI tools (Stack Overflow 2025; `docs/sources.md`, VERIFY). Everyone has them; few
teams can say what changed.

## 0:20 to 1:00, why it matters

Counting commits rewards volume. DORA's five metrics measure delivery: how often you ship, how
long a change takes, and how often shipping breaks. Throughput and instability together are the
honest picture.

## 1:00 to 5:30, screen share

**Before: no measurement.** Show what you have today:

```bash
pnpm demo:03 before
```

Prints the raw count of merged PRs for the period. It goes up. It tells you nothing about
delivery.

**Run: compute the five numbers either side of the rollout date.**

```bash
pnpm demo:03 run
```

Prints the five metrics before and after, with sample sizes and a better/worse label for each.
Point at the one that got worse: more throughput, and a higher change fail rate.

**After: the three outputs.**

```bash
pnpm demo:03 after
```

Lists `dora.json`, `dora.html` and `summary.md`, prints the CFO summary, and prints the path of the
HTML dashboard to open in a browser (one file, no server).

## 5:30 to 6:30, the metric

The five numbers are the metric. Re-print the comparison table:

```bash
pnpm demo:03 metric
```

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

`pnpm demo:03 run` on the before and after table, then the first lines of the CFO summary.

## Reset

`pnpm demo:03:reset` deletes `pieces/03-dora-metrics/demo/out`.
