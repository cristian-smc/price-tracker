#!/data/data/com.termux/files/usr/bin/bash
# PriceWatch — Pull latest code and restart crond.
# Tap via Termux widget on home screen.

COMPANION_DIR="$HOME/price-tracker/companion"
REPO_DIR="$HOME/price-tracker"

termux-toast -s "PriceWatch: updating…"

if ! cd "$REPO_DIR" || ! git pull --ff-only >> "$COMPANION_DIR/check.log" 2>&1; then
  termux-toast -s "PriceWatch: git pull failed — see check.log"
  exit 1
fi

cd "$COMPANION_DIR" && npm install --silent >> check.log 2>&1

pkill crond 2>/dev/null; sleep 1; crond

termux-toast -s "PriceWatch: updated ✓"
