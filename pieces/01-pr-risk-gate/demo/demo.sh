#!/usr/bin/env bash
# PR risk gate demo. Usage: demo.sh [all|before|run|after|metric]
# Offline and deterministic by default. DEMO_LIVE=1 uses the live model (needs ANTHROPIC_API_KEY).
set -u
cd "$(dirname "$0")/.."

STAGE="all"
for arg in "$@"; do [ "$arg" = "--" ] || STAGE="$arg"; done

FX=demo/fixtures
OUT=demo/out
CFG=demo/risk-gate.demo.yml
mkdir -p "$OUT"

if [ -t 1 ]; then RED=$'\033[31m'; GREEN=$'\033[32m'; BOLD=$'\033[1m'; OFF=$'\033[0m'; else RED=; GREEN=; BOLD=; OFF=; fi
LLM_ARGS=(--llm replay --fixtures demo/llm-fixtures)
[ "${DEMO_LIVE:-0}" = "1" ] && LLM_ARGS=(--llm live)

rg() { pnpm --silent exec tsx src/bin.ts "$@"; }
header() { printf '\n%s== %s ==%s\n' "$BOLD" "$1" "$OFF"; }
# evaluate <diff-name> <meta-name> <mode> [extra args]
evaluate() {
  local diff="$1" meta="$2" mode="$3"; shift 3
  rg evaluate --diff "$FX/$diff.diff" --meta "$FX/$meta.meta.json" --config "$CFG" \
    --mode "$mode" --audit "$OUT/audit.jsonl" "${LLM_ARGS[@]}" "$@"
  local code=$?
  if [ $code -eq 0 ]; then printf '%sexit 0%s\n' "$GREEN" "$OFF"; else printf '%sexit %s%s\n' "$RED" "$code" "$OFF"; fi
}

before() {
  header "BEFORE: observe mode (reports, never blocks)"
  for pr in pr1-docs pr2-feature pr3-auth-no-tests; do
    printf '\n%s\n' "$pr"; evaluate "$pr" "$pr" observe --summary-only
  done
  printf '\nAll three exit 0. All three merge.\n'
}

run() {
  header "RUN: enforce mode"
  evaluate pr1-docs pr1-docs enforce --summary-only
  evaluate pr2-feature pr2-feature enforce --summary-only
  header "PR 3: auth change, no tests (full PR comment)"
  evaluate pr3-auth-no-tests pr3-auth-no-tests enforce
}

after() {
  header "AFTER 1: tests added, no second approval yet"
  evaluate pr3-auth-with-tests pr3-auth-with-tests enforce --summary-only
  header "AFTER 2: tests added, two human approvals"
  evaluate pr3-auth-with-tests pr3-auth-approved enforce --summary-only
  printf '\nAudit log (one line per decision, each linked to the one before):\n'
  cut -c1-150 "$OUT/audit.jsonl"
}

metric() {
  header "METRIC: high-risk PRs that shipped with tests (SYNTHETIC data)"
  rg synthetic --out "$OUT/before.audit.jsonl" --seed 7 --prs 60 >/dev/null
  rg synthetic --out "$OUT/after.audit.jsonl" --seed 7 --prs 60 --gated >/dev/null
  rg metrics --log "$OUT/before.audit.jsonl" --label "Before gate (synthetic)"
  printf '\n'
  rg metrics --log "$OUT/after.audit.jsonl" --label "After gate (synthetic)"
}

case "$STAGE" in
  before) before ;;
  run) run ;;
  after) after ;;
  metric) metric ;;
  all) rm -f "$OUT/audit.jsonl"; before; run; after; metric ;;
  *) echo "unknown stage: $STAGE (use all|before|run|after|metric)" >&2; exit 2 ;;
esac
