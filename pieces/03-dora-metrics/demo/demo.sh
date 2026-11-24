#!/usr/bin/env bash
# DORA metrics demo. Usage: demo.sh [all|before|run|after|metric]. Offline and deterministic.
set -u
cd "$(dirname "$0")/.."
STAGE="all"
for arg in "$@"; do [ "$arg" = "--" ] || STAGE="$arg"; done
exec pnpm --silent exec tsx demo/demo.ts "$STAGE"
