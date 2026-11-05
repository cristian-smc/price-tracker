#!/data/data/com.termux/files/usr/bin/bash
COMPANION_DIR="${PRICEWATCH_COMPANION_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
termux-notification --id 43 --title "PriceWatch Update" --content "Checking for updates..." --icon "cloud_download" --ongoing
bash "$COMPANION_DIR/update.sh" >> "$COMPANION_DIR/update.log" 2>&1
STATUS=$?
if [[ "$STATUS" -eq 0 ]]; then
  termux-notification --id 43 --title "PriceWatch Update" --content "Update complete - your data was preserved" --icon "check_circle"
elif [[ "$STATUS" -eq 75 ]]; then
  termux-notification --id 43 --title "PriceWatch Update" --content "A check or update is already running. Try again later." --icon "info"
else
  termux-notification --id 43 --title "PriceWatch Update" --content "Update failed - see companion/update.log" --icon "error"
fi
exit "$STATUS"
