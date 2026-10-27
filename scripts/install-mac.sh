#!/usr/bin/env bash
# Install TabGen as a Mac app: ~/Applications/TabGen.app (double-click, Dock, Launchpad). The app
# starts the local server when it opens and stops it when it quits.
#   --background  also install a LaunchAgent that keeps the server running at all times (starts at
#                 login), e.g. so a phone can reach it while the app is closed.
#   HOST=0.0.0.0  let other devices on the Wi-Fi reach the server (default: this Mac only).
# Re-run after pulling new code; scripts/uninstall-mac.sh removes everything it set up.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
[[ "$(uname)" == "Darwin" ]] || { echo "macOS only." >&2; exit 1; }
[[ -x .venv/bin/python ]] || { echo "Run ./scripts/setup.sh first." >&2; exit 1; }
command -v swiftc >/dev/null || { echo "Needs the Xcode command line tools: xcode-select --install" >&2; exit 1; }

say() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
LABEL=com.tabgen.server
APP="$HOME/Applications/TabGen.app"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
BACKGROUND=0
[[ "${1:-}" == "--background" ]] && BACKGROUND=1
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

say "Icons"
.venv/bin/python scripts/make_icons.py --mac "$BUILD/AppIcon.iconset"
iconutil -c icns "$BUILD/AppIcon.iconset" -o "$BUILD/AppIcon.icns"

say "Web app"
(cd apps/web && { [[ -d node_modules ]] || npm ci --no-audit --no-fund; } && { npm run build >/dev/null 2>&1 || npm run build; })

say "Mac app → $APP"
swiftc -O -o "$BUILD/TabGen" apps/mac/TabGen.swift
VERSION="$(git describe --tags --always 2>/dev/null || echo dev)"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILD/TabGen" "$APP/Contents/MacOS/TabGen"
cp "$BUILD/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>TabGen</string>
  <key>CFBundleDisplayName</key><string>TabGen</string>
  <key>CFBundleIdentifier</key><string>com.tabgen.app</string>
  <key>CFBundleExecutable</key><string>TabGen</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Akort aleti ve çalarak eşlik, gitarını mikrofonla dinler. Ses bilgisayarından çıkmaz.</string>
  <key>NSHumanReadableCopyright</key><string>MIT</string>
  <key>TabGenURL</key><string>http://127.0.0.1:$PORT</string>
  <key>TabGenRoot</key><string>$ROOT</string>
  <key>TabGenHost</key><string>$HOST</string>
</dict></plist>
PLIST
# Sign with your own Apple certificate when there is one: with only an ad-hoc signature macOS
# grants the microphone, yet WebKit's capture delivers no audio to the page (0-byte recordings).
IDENTITY="${TABGEN_SIGN_IDENTITY:-$(security find-identity -p codesigning -v 2>/dev/null \
  | sed -nE 's/.*"((Apple Development|Developer ID Application): .*)"/\1/p' | head -1)}"
if [[ -n "$IDENTITY" ]] && codesign --force --deep --sign "$IDENTITY" "$APP" >/dev/null 2>&1; then
  echo "    signed with: $IDENTITY"
else
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
  echo "    ad-hoc signed (no Apple certificate found): the microphone may not work in the app"
fi

if ((!BACKGROUND)); then
  say "Done. Open TabGen from Launchpad, Spotlight or ~/Applications (drag it to the Dock to keep it)."
  exit 0
fi

say "Background server ($LABEL, port $PORT)"
mkdir -p "$HOME/Library/LaunchAgents" data/logs
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$ROOT/scripts/run.sh</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>NO_BROWSER</key><string>1</string>
    <key>PORT</key><string>$PORT</string>
    <key>HOST</key><string>$HOST</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$ROOT/data/logs/server.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/logs/server.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && sleep 2 || true
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use (a TabGen started by hand?). Stop it, then re-run this script." >&2
  exit 1
fi
launchctl bootstrap "gui/$(id -u)" "$AGENT"

say "Done. Open TabGen from Launchpad, Spotlight or ~/Applications (drag it to the Dock to keep it)."
