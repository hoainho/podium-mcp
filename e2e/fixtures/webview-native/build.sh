#!/usr/bin/env bash
# Build the minimal WKWebView fixture into a simulator .app and (optionally) install
# + launch it on a booted simulator. No xcodeproj/CocoaPods — just swiftc + a bundle.
#
# Usage: ./build.sh [UDID]   (UDID optional; if given, installs + launches)
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="PodiumFixture"
BUNDLE_ID="com.podium.fixture"
OUT="build"
APP="$OUT/$APP_NAME.app"
SDK="$(xcrun --sdk iphonesimulator --show-sdk-path)"
ARCH="$(uname -m)" # arm64 on Apple Silicon

rm -rf "$OUT"; mkdir -p "$APP"

echo "• compiling (swiftc, $ARCH-apple-ios16.4-simulator)"
xcrun -sdk iphonesimulator swiftc \
  -target "${ARCH}-apple-ios16.4-simulator" \
  -sdk "$SDK" \
  -parse-as-library \
  -framework UIKit -framework WebKit \
  main.swift -o "$APP/$APP_NAME"

cp Info.plist "$APP/Info.plist"

# Ad-hoc sign with get-task-allow — required for the sim to launch the app AND
# for the WKWebView to be inspectable (mobilecli/CDP attach needs get-task-allow).
cat > "$OUT/entitlements.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>get-task-allow</key><true/>
</dict></plist>
EOF
# IMPORTANT: leave the app UNSIGNED by default. Simulator apps are debuggable
# without code signing (so the WKWebView is inspectable), and ad-hoc signing a
# hand-built sim bundle makes SpringBoard REFUSE to launch it (SBMainWorkspace
# denial, verified on iOS 18.5). Set SIGN=1 only if you know you need it.
if [[ "${SIGN:-}" == "1" ]]; then
  codesign --force --sign - --entitlements "$OUT/entitlements.plist" "$APP"
  echo "• built + ad-hoc signed $APP"
else
  echo "• built (UNSIGNED — launchable + inspectable on the simulator) $APP"
fi

if [[ "${1:-}" != "" ]]; then
  UDID="$1"
  echo "• installing on $UDID"
  xcrun simctl install "$UDID" "$APP"
  echo "• launching $BUNDLE_ID"
  xcrun simctl launch "$UDID" "$BUNDLE_ID" || true
  echo "installed+launched"
fi
