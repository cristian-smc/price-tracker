#!/usr/bin/env bash
# Install launchers bound to this checkout, including paths containing spaces.
set -euo pipefail
COMPANION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHORTCUTS_DIR="${PRICEWATCH_SHORTCUTS_DIR:-$HOME/.shortcuts/tasks}"
mkdir -p "$SHORTCUTS_DIR"
for widget in pw-check.sh pw-update.sh pw-logs.sh; do
  source="$COMPANION_DIR/widget/$widget"
  [[ -f "$source" ]] || { printf 'Missing widget: %s\n' "$source" >&2; exit 1; }
  { printf '#!/data/data/com.termux/files/usr/bin/bash\n';
    printf 'export PRICEWATCH_COMPANION_DIR=%q\n' "$COMPANION_DIR";
    printf 'exec bash %q\n' "$source";
  } > "$SHORTCUTS_DIR/$widget"
  chmod +x "$SHORTCUTS_DIR/$widget"
done
printf 'PriceWatch widget launchers installed in %s\n' "$SHORTCUTS_DIR"
