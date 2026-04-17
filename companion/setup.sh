#!/usr/bin/env bash
# PriceWatch Termux Companion — one-shot setup script
#
# Usage:
#   bash setup.sh                                        # interactive, 30-min interval
#   bash setup.sh --interval 15                          # custom interval
#   bash setup.sh --gist-id <id> --gist-token <token>   # skip Gist prompts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERVAL=30
GIST_ID=""
GIST_TOKEN=""

# ── Parse arguments ───────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval)    INTERVAL="$2";    shift 2 ;;
    --gist-id)     GIST_ID="$2";     shift 2 ;;
    --gist-token)  GIST_TOKEN="$2";  shift 2 ;;
    *)
      echo "Usage: bash setup.sh [--interval <min>] [--gist-id <id>] [--gist-token <token>]"
      exit 1 ;;
  esac
done

if ! [[ "$INTERVAL" =~ ^[0-9]+$ ]] || [[ "$INTERVAL" -lt 1 ]]; then
  echo "ERROR: --interval must be a positive integer (minutes)"
  exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
warn() { echo -e "  ${YELLOW}!${RESET} $*"; }
fail() { echo -e "  ${RED}✗${RESET} $*"; }
step() { echo -e "\n${GREEN}[$1/$TOTAL]${RESET} $2"; }

TOTAL=8

# ── Step 1: packages ──────────────────────────────────────────────────────────

step 1 "Installing packages (nodejs · cronie · termux-api)…"

if ! command -v pkg &>/dev/null; then
  fail "pkg not found — are you running this inside Termux?"
  exit 1
fi

pkg install -y nodejs cronie termux-api
ok "Packages installed"

# ── Step 2: Node dependencies ─────────────────────────────────────────────────

step 2 "Installing Node dependencies…"
cd "$SCRIPT_DIR"
npm install --silent
ok "cheerio installed"

# ── Step 3: GitHub Gist sync (optional but recommended) ──────────────────────

step 3 "Configuring GitHub Gist sync…"

CONFIG_FILE="$SCRIPT_DIR/config.json"

if [[ -z "$GIST_TOKEN" && -z "$GIST_ID" && -t 0 ]]; then
  # Interactive: prompt the user
  echo ""
  echo "  GitHub Gist sync keeps your product list automatically up to date"
  echo "  without any manual file transfers."
  echo ""
  echo "  To set it up:"
  echo "    1. Visit: https://github.com/settings/tokens/new"
  echo "    2. Set Note: PriceWatch, Expiration: No expiration"
  echo "    3. Check only the 'gist' scope, then Generate token"
  echo "    4. In the PriceWatch extension: Options → Gist Sync → enter token → Sync now"
  echo "       (the Gist ID will appear in the Gist ID field)"
  echo ""
  read -rp "  GitHub token (leave blank to skip): " GIST_TOKEN
  if [[ -n "$GIST_TOKEN" ]]; then
    read -rp "  Gist ID (from extension Options page): " GIST_ID
  fi
fi

if [[ -n "$GIST_TOKEN" && -n "$GIST_ID" ]]; then
  # Verify token is valid before saving
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $GIST_TOKEN" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/gists/$GIST_ID")

  if [[ "$HTTP_STATUS" == "200" ]]; then
    printf '{"gistId":"%s","gistToken":"%s"}\n' "$GIST_ID" "$GIST_TOKEN" > "$CONFIG_FILE"
    ok "Gist credentials saved and verified (Gist $GIST_ID)"
  else
    warn "Could not verify Gist (HTTP $HTTP_STATUS) — check token and ID"
    warn "You can re-run setup.sh --gist-id <id> --gist-token <token> later"
    printf '{"gistId":"","gistToken":""}\n' > "$CONFIG_FILE"
  fi
elif [[ -f "$CONFIG_FILE" ]]; then
  ok "Existing config.json kept"
else
  printf '{"gistId":"","gistToken":""}\n' > "$CONFIG_FILE"
  warn "Gist sync skipped — products must be copied manually as pricewatch.json"
fi

# ── Step 4: verify check.js runs ─────────────────────────────────────────────

step 4 "Verifying check.js…"

HAS_GIST=$(node -e "const c=require('$CONFIG_FILE');process.exit(c.gistId&&c.gistToken?0:1)" 2>/dev/null && echo yes || echo no)

if [[ "$HAS_GIST" == "yes" ]]; then
  node "$SCRIPT_DIR/check.js" && ok "Test run succeeded" || warn "Test run had errors — check logs above"
elif [[ -f "$SCRIPT_DIR/pricewatch.json" ]]; then
  node "$SCRIPT_DIR/check.js" && ok "Test run succeeded" || warn "Test run had errors — check logs above"
else
  warn "Skipping test run — no product data yet"
  warn "After configuring Gist sync in the extension, run: node $SCRIPT_DIR/check.js"
fi

# ── Step 5: cron job ──────────────────────────────────────────────────────────

step 5 "Setting up cron job (every ${INTERVAL} min)…"

CRON_MARKER="pricewatch-companion"
CRON_LINE="*/${INTERVAL} * * * * cd \"$SCRIPT_DIR\" && node check.js >> \"$SCRIPT_DIR/check.log\" 2>&1  # ${CRON_MARKER}"
existing=$(crontab -l 2>/dev/null || true)

if echo "$existing" | grep -qF "$CRON_MARKER"; then
  new_crontab=$(echo "$existing" | grep -v "$CRON_MARKER")
  (echo "$new_crontab"; echo "$CRON_LINE") | crontab -
  ok "Cron job updated (every ${INTERVAL} min)"
else
  (echo "$existing"; echo "$CRON_LINE") | crontab -
  ok "Cron job added (every ${INTERVAL} min)"
fi

# ── Step 6: start crond now ───────────────────────────────────────────────────

step 6 "Starting crond…"

if pgrep -x crond &>/dev/null; then
  ok "crond already running"
else
  crond
  ok "crond started"
fi

# ── Step 7: Termux:Boot persistence ──────────────────────────────────────────

step 7 "Setting up Termux:Boot (auto-start crond after reboot)…"

BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"
BOOT_SCRIPT="$BOOT_DIR/start-pricewatch.sh"

cat > "$BOOT_SCRIPT" << 'BOOTEOF'
#!/data/data/com.termux/files/usr/bin/sh
# Auto-started by Termux:Boot — launches crond for PriceWatch companion
crond
BOOTEOF

chmod +x "$BOOT_SCRIPT"
ok "Boot script: $BOOT_SCRIPT"

# ── Step 8: Termux:Widget home-screen shortcuts ───────────────────────────────

step 8 "Installing home-screen widget shortcuts…"

SHORTCUTS_DIR="$HOME/.shortcuts"
mkdir -p "$SHORTCUTS_DIR"

WIDGET_DIR="$SCRIPT_DIR/widget"
WIDGETS=("pw-check.sh" "pw-update.sh" "pw-logs.sh")

for w in "${WIDGETS[@]}"; do
  src="$WIDGET_DIR/$w"
  dst="$SHORTCUTS_DIR/$w"
  if [[ -f "$src" ]]; then
    cp "$src" "$dst"
    chmod +x "$dst"
    ok "Shortcut installed: ~/.shortcuts/$w"
  else
    warn "Widget script not found: $src"
  fi
done

echo ""
echo "  To add icons to your home screen:"
echo "    1. Install 'Termux:Widget' from F-Droid (free)"
echo "    2. Long-press your home screen → Widgets → Termux:Widget"
echo "    3. Place the widget; tap it to choose a script:"
echo "       • pw-check  — manual price check right now"
echo "       • pw-update — git pull + npm install + restart crond"
echo "       • pw-logs   — view the last 30 lines of check.log"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}══════════════════════════════════════════${RESET}"
echo -e "${GREEN}  Setup complete!${RESET}"
echo -e "${GREEN}══════════════════════════════════════════${RESET}"
echo ""
echo "Check logs:      tail -f $SCRIPT_DIR/check.log"
echo "Manual run:      node $SCRIPT_DIR/check.js"
echo "Change interval: bash $SCRIPT_DIR/setup.sh --interval <minutes>"
echo ""
echo "Home screen shortcuts: ~/.shortcuts/pw-check.sh / pw-update.sh / pw-logs.sh"
echo "  → Add a Termux:Widget to your home screen to tap them."
echo ""
echo "Remember: install Termux:Boot and Termux:Widget from F-Droid"
echo "so crond survives reboots and shortcuts appear on your home screen."
echo ""
