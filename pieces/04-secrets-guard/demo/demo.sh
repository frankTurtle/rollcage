#!/usr/bin/env bash
# Secrets guard demo. Usage: demo.sh [all|before|run|after|metric]. Offline; nothing touches AWS or GitHub.
set -eu
cd "$(dirname "$0")/.."
STAGE="all"
for arg in "$@"; do [ "$arg" = "--" ] || STAGE="$arg"; done
pnpm --silent run build >/dev/null   # the one-file CLI an adopter would copy into their hooks
exec pnpm --silent exec tsx demo/demo.ts "$STAGE"
