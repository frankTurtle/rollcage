#!/usr/bin/env bash
# Rollcage installer: adds the rollcage guardrails to the git repository you run it in.
#
#   curl -fsSL https://raw.githubusercontent.com/frankTurtle/rollcage/<ref>/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --dry-run
#   bash install.sh --pieces risk-gate,secrets --ref <sha>
#
# It fetches rollcage at a ref into a temporary folder, runs `init` on the current directory, and
# deletes the folder. It writes only new files under .github/ and risk-gate.yml, never overwrites,
# never commits, never pushes. Read it before you pipe it: it is short. Pin <ref> to a commit SHA.
#
# Options (all passed to `init`): --pieces a,b  --extras --owner <login>  --dry-run
# Environment: ROLLCAGE_REF (default main), ROLLCAGE_REPO (default the GitHub repository; a local
# path works, which the tests use).
set -euo pipefail

REPO="${ROLLCAGE_REPO:-https://github.com/frankTurtle/rollcage.git}"
REF="${ROLLCAGE_REF:-main}"

die() { printf 'rollcage install: %s\n' "$*" >&2; exit 1; }

for tool in git node pnpm; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required and was not found on PATH"
done
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 24 ] || die "Node 24 or newer is required (found $(node -v))"

target="$(pwd)"
[ -d "$target/.git" ] || printf 'warning: %s is not the root of a git repository\n' "$target" >&2

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

printf 'Fetching rollcage at %s ...\n' "$REF"
git -C "$work" init -q
git -C "$work" fetch -q --depth 1 "$REPO" "$REF" || die "could not fetch $REF from $REPO"
git -C "$work" checkout -q FETCH_HEAD
sha="$(git -C "$work" rev-parse HEAD)"

# Pin the installed workflows to the exact commit that was fetched, unless --ref is given.
ref_args=(--ref "$sha")
for arg in "$@"; do
  case "$arg" in --ref|--ref=*) ref_args=() ;; esac
done

(cd "$work" && pnpm install --frozen-lockfile --silent --filter "@adl/golden-path-template...")
(cd "$work/pieces/12-golden-path-template" && pnpm exec tsx src/bin.ts init "$target" ${ref_args[@]+"${ref_args[@]}"} "$@")
