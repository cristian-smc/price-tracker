#!/data/data/com.termux/files/usr/bin/bash
COMPANION_DIR="$HOME/price-tracker/companion"
REPO_DIR="$HOME/price-tracker"

termux-notification --id 43 --title "PriceWatch Update" --content "Pulling latest code…" --icon "cloud_download" --ongoing

if ! cd "$REPO_DIR" || ! git pull --ff-only >> "$COMPANION_DIR/check.log" 2>&1; then
  termux-notification --id 43 --title "PriceWatch Update" --content "git pull failed — see check.log" --icon "error"
  exit 0
fi

termux-notification --id 43 --title "PriceWatch Update" --content "Installing dependencies…" --icon "cloud_download" --ongoing
cd "$COMPANION_DIR" && npm install --silent >> check.log 2>&1

cp "$COMPANION_DIR/widget/"*.sh ~/.shortcuts/tasks/
chmod +x ~/.shortcuts/tasks/*.sh

pkill crond 2>/dev/null; sleep 1; crond

termux-notification --id 43 --title "PriceWatch Update" --content "Updated ✓ — crond restarted" --icon "check_circle"

exit 0
