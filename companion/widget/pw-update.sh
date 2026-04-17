#!/data/data/com.termux/files/usr/bin/bash
# PriceWatch — Pull latest code and restart crond.
# Installed by setup.sh into ~/.shortcuts/ — tap via Termux:Widget.

COMPANION_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.."
REPO_DIR="$(cd "$COMPANION_DIR/.." && pwd)"

termux-toast -s "PriceWatch: updating…"

cd "$REPO_DIR" || { termux-toast -s "PriceWatch: repo dir not found"; exit 1; }

if ! git pull --ff-only >> "$COMPANION_DIR/check.log" 2>&1; then
  termux-toast -s "PriceWatch: git pull failed — see check.log"
  exit 1
fi

cd "$COMPANION_DIR" && npm install --silent >> check.log 2>&1

# Restart crond so any crontab changes take effect
pkill crond 2>/dev/null; sleep 1; crond

termux-toast -s "PriceWatch: updated ✓"
