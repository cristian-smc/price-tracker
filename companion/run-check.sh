#!/usr/bin/env bash
# Shared entrypoint for cron/widgets: never check while an update installs files.
set -euo pipefail
COMPANION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v flock >/dev/null 2>&1; then
  printf 'ERROR: flock is missing. Install it with: pkg install util-linux\n' >&2
  exit 1
fi
exec 9>"$COMPANION_DIR/.operation.lock"
if ! flock -n 9; then
  printf 'SKIPPED: another PriceWatch check or update is running.\n'
  exit 75
fi
cd "$COMPANION_DIR"
if ! node --version >/dev/null 2>&1; then
  printf 'ERROR: Node cannot start. In Termux run pkg update && pkg upgrade, then reinstall libc++ and your installed Node package.\n' >&2
  exit 1
fi
exec node check.js
