#!/data/data/com.termux/files/usr/bin/bash
COMPANION_DIR="$HOME/price-tracker/companion"
LOG_FILE="$COMPANION_DIR/check.log"

if [[ ! -f "$LOG_FILE" ]]; then
  termux-notification --id 44 --title "PriceWatch Logs" --content "No log file found yet." --icon "info"
  exit 0
fi

LAST=$(tail -5 "$LOG_FILE" | tr '\n' ' ')
LINES=$(wc -l < "$LOG_FILE")
termux-notification --id 44 --title "PriceWatch Logs ($LINES lines total)" --content "$LAST" --icon "article"
