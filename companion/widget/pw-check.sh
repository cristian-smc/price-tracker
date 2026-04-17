#!/data/data/com.termux/files/usr/bin/bash
# PriceWatch — Run a manual price check now.
# Tap via Termux widget on home screen.

COMPANION_DIR="$HOME/price-tracker/companion"

termux-toast -s "PriceWatch: checking prices…"

if cd "$COMPANION_DIR" && node check.js >> check.log 2>&1; then
  termux-toast -s "PriceWatch: check done ✓"
else
  termux-toast -s "PriceWatch: check failed — see check.log"
fi
