#!/data/data/com.termux/files/usr/bin/bash
COMPANION_DIR="$HOME/price-tracker/companion"

termux-notification --id 42 --title "PriceWatch" --content "Checking prices…" --icon "sync" --ongoing

if cd "$COMPANION_DIR" && node check.js >> check.log 2>&1; then
  termux-notification --id 42 --title "PriceWatch" --content "Check done ✓" --icon "check_circle"
else
  termux-notification --id 42 --title "PriceWatch" --content "Check failed — see check.log" --icon "error"
fi
