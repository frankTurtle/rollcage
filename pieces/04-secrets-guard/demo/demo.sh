#!/usr/bin/env bash
# Secrets guard demo. Usage: demo.sh [all|before|run|after|metric]. Offline; nothing touches AWS or GitHub.
set -u
cd "$(dirname "$0")/.."
STAGE="all"
for arg in "$@"; do [ "$arg" = "--" ] || STAGE="$arg"; done
exec pnpm --silent exec tsx demo/demo.ts "$STAGE"
