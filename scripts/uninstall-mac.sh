#!/usr/bin/env bash
# Remove the Mac app and the background server set up by scripts/install-mac.sh (your songs stay in data/).
set -euo pipefail
LABEL=com.tabgen.server
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Applications/TabGen.app"
echo "TabGen app and background server removed."
