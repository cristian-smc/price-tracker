#!/data/data/com.termux/files/usr/bin/bash
# PriceWatch — Show the last 30 lines of the check log in a Termux session.
# Installed by setup.sh into ~/.shortcuts/ — tap via Termux:Widget.

COMPANION_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.."

tail -30 "$COMPANION_DIR/check.log"
read -rp $'\nPress Enter to close…'
