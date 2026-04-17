#!/data/data/com.termux/files/usr/bin/bash
COMPANION_DIR="$HOME/price-tracker/companion"

termux-notification --id 42 --title "PriceWatch" --content "Checking prices…" --icon "sync" --ongoing

OUTPUT=$(cd "$COMPANION_DIR" && node check.js 2>&1 | tee -a check.log)

if echo "$OUTPUT" | grep -q "FATAL\|ERROR"; then
  termux-notification --id 42 --title "PriceWatch" --content "Check failed — see check.log" --icon "error"
  exit 0
fi

BELOW=$(echo "$OUTPUT" | grep -o 'BELOW_TARGET=[0-9]*' | cut -d= -f2)
TOTAL=$(echo "$OUTPUT" | grep -o 'TOTAL=[0-9]*' | cut -d= -f2)
BELOW=${BELOW:-0}
TOTAL=${TOTAL:-0}

if [[ "$BELOW" -gt 0 ]]; then
  termux-notification --id 42 --title "PriceWatch ✓" --content "$BELOW of $TOTAL products below target price!" --icon "check_circle"
else
  termux-notification --id 42 --title "PriceWatch ✓" --content "Checked $TOTAL products — none below target" --icon "check_circle"
fi

exit 0
