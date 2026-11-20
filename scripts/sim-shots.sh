#!/usr/bin/env bash
# App Store screenshots from the iOS simulator (6.3", 1206x2622). Run after building the app with VITE_SHOTS=1.
# The app's screenshot tour (src/shots.ts) writes each screen's name to Documents/shots/ready; this script takes the
# screenshot and answers in Documents/shots/next.
set -euo pipefail
OUT=${1:-shots}
BUNDLE=com.heyobi.querly
mkdir -p "$OUT"
DEV=$(xcrun simctl list devices available -j | python3 -c "
import json, sys
d = json.load(sys.stdin)['devices']
devs = [x for r in d for x in d[r] if x['name'].startswith('iPhone') and x['name'].endswith(' Pro')]
pref = [x for x in devs if x['name'] in ('iPhone 17 Pro', 'iPhone 16 Pro')]
print((pref or devs)[0]['udid'])")
echo "simulator $DEV"
xcrun simctl boot "$DEV" || true
xcrun simctl bootstatus "$DEV" -b
xcrun simctl status_bar "$DEV" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
APP=$(find build/sim/Build/Products -name "App.app" -path "*iphonesimulator*" | head -1)
xcrun simctl install "$DEV" "$APP"
xcrun simctl launch "$DEV" "$BUNDLE"
DATA=$(xcrun simctl get_app_container "$DEV" "$BUNDLE" data)
for i in $(seq 1 900); do
  if [ -f "$DATA/Documents/shots/ready" ]; then
    NAME=$(cat "$DATA/Documents/shots/ready")
    [ "$NAME" = "done" ] && { echo "tour finished"; break; }
    if [ ! -f "$OUT/$NAME.png" ]; then
      sleep 1
      xcrun simctl io "$DEV" screenshot "$OUT/$NAME.png"
      echo "saved $NAME"
    fi
    printf '%s' "$NAME" > "$DATA/Documents/shots/next"
  fi
  sleep 1
done
ls -la "$OUT"
