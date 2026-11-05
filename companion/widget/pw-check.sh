#!/data/data/com.termux/files/usr/bin/bash
set -o pipefail
COMPANION_DIR="${PRICEWATCH_COMPANION_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

termux-notification --id 42 --title "PriceWatch" --content "Checking prices..." --icon "sync" --ongoing

OUTPUT=$( (cd "$COMPANION_DIR" && bash run-check.sh 2>&1 | tee -a check.log) 2>&1)
STATUS=$?
printf '%s\n' "$OUTPUT"
if [[ "$STATUS" -eq 75 ]]; then
  termux-notification --id 42 --title "PriceWatch" --content "A check or update is already running. Try again later." --icon "info"
  exit 75
fi

if [[ "$OUTPUT" == *'CANNOT LINK EXECUTABLE'* || "$OUTPUT" == *'Node cannot start'* ]]; then
  termux-notification --id 42 --title "PriceWatch" --content "Node runtime broken - upgrade Termux packages and reinstall libc++/Node" --icon "error"
  exit 1
fi

# A process may fail before check.js can log FATAL (missing module/runtime).
# Never turn an absent completion marker into a successful zero-product check.
if [[ "$STATUS" -ne 0 || "$OUTPUT" =~ FATAL|ERROR ]]; then
  termux-notification --id 42 --title "PriceWatch" --content "Check failed - see check.log or run node check.js in Termux" --icon "error"
  exit 1
fi
BELOW=""; TOTAL=""
while IFS= read -r line; do
  if [[ "$line" =~ Done\.\ BELOW_TARGET=([0-9]+)\ TOTAL=([0-9]+)(\ |$) ]]; then
    BELOW="${BASH_REMATCH[1]}"; TOTAL="${BASH_REMATCH[2]}"
  fi
done <<< "$OUTPUT"
if [[ -z "$BELOW" || -z "$TOTAL" ]]; then
  termux-notification --id 42 --title "PriceWatch" --content "Check did not finish - see check.log" --icon "error"
  exit 1
fi

if [[ "$TOTAL" -eq 0 ]]; then
  if [[ "$OUTPUT" == *'are paused.'* ]]; then
    MESSAGE="No active products - your saved products are paused"
  else
    MESSAGE="No products loaded - export for Termux or sync your watchlist"
  fi
  termux-notification --id 42 --title "PriceWatch" --content "$MESSAGE" --icon "info"
elif [[ "$BELOW" -gt 0 ]]; then
  termux-notification --id 42 --title "PriceWatch" --content "$BELOW of $TOTAL products below target price!" --icon "check_circle"
else
  termux-notification --id 42 --title "PriceWatch" --content "Checked $TOTAL products - none below target" --icon "check_circle"
fi
