#!/data/data/com.termux/files/usr/bin/bash
# PriceWatch — Show last 30 lines of check.log.
# Tap via Termux widget on home screen.

COMPANION_DIR="$HOME/price-tracker/companion"

tail -30 "$COMPANION_DIR/check.log"
read -rp $'\nPress Enter to close…'
