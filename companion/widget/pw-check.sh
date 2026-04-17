#!/data/data/com.termux/files/usr/bin/bash
# PriceWatch — Run a manual price check now.
# Installed by setup.sh into ~/.shortcuts/ — tap via Termux:Widget.

COMPANION_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.."

termux-toast -s "PriceWatch: checking prices…"

if cd "$COMPANION_DIR" && node check.js >> check.log 2>&1; then
  termux-toast -s "PriceWatch: check done ✓"
else
  termux-toast -s "PriceWatch: check failed — see check.log"
fi
