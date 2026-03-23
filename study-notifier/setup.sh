#!/bin/bash
# setup.sh — one-command install for study-notifier
# Run from the study-notifier directory: bash setup.sh
set -e
cd "$(dirname "$0")"

APP_NAME="Study Notifier"
DEST="$HOME/Applications/Study Notifier.app"
ICONSET="build/icons/icon.iconset"
ICNS="build/icons/icon.icns"
SRC_PNG="build/icons/icon.png"

echo "📦 Installing npm dependencies…"
npm install --silent

# ── Convert PNG → .icns ──────────────────────────────────────────────────────
if [ ! -f "$ICNS" ]; then
  echo "🎨 Building icon…"
  mkdir -p "$ICONSET"

  sizes=(16 32 64 128 256 512 1024)
  for s in "${sizes[@]}"; do
    sips -z $s $s "$SRC_PNG" --out "$ICONSET/icon_${s}x${s}.png" &>/dev/null
  done
  # @2x pairs
  cp "$ICONSET/icon_32x32.png"   "$ICONSET/icon_16x16@2x.png"
  cp "$ICONSET/icon_64x64.png"   "$ICONSET/icon_32x32@2x.png"
  cp "$ICONSET/icon_256x256.png" "$ICONSET/icon_128x128@2x.png"
  cp "$ICONSET/icon_512x512.png" "$ICONSET/icon_256x256@2x.png"
  cp "$ICONSET/icon_1024x1024.png" "$ICONSET/icon_512x512@2x.png"

  iconutil -c icns "$ICONSET" -o "$ICNS"
  echo "   ✓ icon.icns created"
else
  echo "   ✓ icon.icns already exists, skipping"
fi

# ── Build .app with electron-builder ────────────────────────────────────────
echo "🔨 Building .app bundle…"
npx electron-builder --mac --dir

BUILT=$(find dist/mac* -name "*.app" -maxdepth 1 2>/dev/null | head -1)
if [ -z "$BUILT" ]; then
  echo "❌ Build failed — no .app found in dist/"
  exit 1
fi
echo "   ✓ Built: $BUILT"

# ── Install to ~/Applications ────────────────────────────────────────────────
echo "📲 Installing to ~/Applications…"
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
cp -R "$BUILT" "$DEST"
echo "   ✓ Installed: $DEST"

# ── Launch ────────────────────────────────────────────────────────────────────
echo ""
echo "✅ Done! Launching Study Notifier…"
echo "   It will register itself as a login item on first run."
echo "   You can toggle this in the app's ⚙ settings."
echo ""
open "$DEST"
