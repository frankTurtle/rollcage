# Demo script: 04 Secrets guard

Video: "The leaked AWS key that costs $40K overnight, and the 3-layer guard that stops it."
The $40K figure is not sourced; see `docs/sources.md` for sourced alternatives before you record.

Run time: about 1 minute, offline, deterministic. Large terminal font.

```bash
pnpm install
pnpm demo:04:reset   # clean state before every take
pnpm demo:04         # the whole demo end to end
```

The demo uses a **random, fake** access key id generated at run time. It looks like an AWS key to
gitleaks but is not a credential, and the demo masks it on screen. Nothing touches AWS or GitHub.

## 0:00 to 0:20, the problem

Say: "One AWS key in a public repo, and automated scanners find it in minutes." (Sources:
`docs/sources.md`, VERIFY.) Then: "Here are three layers that stop that, and the last one reacts
when the first two fail."

## 0:20 to 1:00, why it matters

A leaked key is not a theoretical risk. The cost is the bill, the incident, and the days spent
working out what the key did. The earlier a layer stops it, the cheaper.

## 1:00 to 5:30, screen share

**Before: nothing in the way.** A temporary repository, a file with a key-shaped string, and a
plain `git commit`:

```bash
pnpm demo:04 before
```

The commit goes through. The key is now in history.

**Run, layer 1: the pre-commit hook.**

```bash
pnpm demo:04 run
```

The same commit with the hook installed is blocked. gitleaks shows the rule and file with the value
masked, and the wrapper writes a record that contains no secret.

**Run, layer 3: the webhook.** The demo then sends a signed `secret_scanning_alert` to the real
handler, wired to fake AWS clients:

1. A request with a wrong signature: 401, no AWS calls.
2. The same alert in dry-run (the default): "would deactivate", one audit record.
3. The same alert with dry-run off and an in-scope user: key set to `Inactive`, user tagged,
   notification sent, audit record with the seconds from alert to deactivation.
4. A user outside the guarded path: skipped.

**After: the evidence.**

```bash
pnpm demo:04 after
```

Prints the audit records from both layers. No secret value appears in either.

## 5:30 to 6:30, the metric

```bash
pnpm demo:04 metric
```

Leaks blocked at pre-commit, and time from alert to deactivation (median and p90), from the records
the demo just wrote. The alert times are simulated; say so.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

`pnpm demo:04 run` from the blocked commit through the dry-run and the deactivation lines.

## Reset

`pnpm demo:04:reset` deletes `pieces/04-secrets-guard/demo/out`.
