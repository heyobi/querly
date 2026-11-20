#!/usr/bin/env bash
# App Store screenshots from an iOS simulator. Run after building the app with VITE_SHOTS=1.
# Usage: sim-shots.sh "<device name>" <out dir> [display id] [unfold]
#   iPhone 17 Pro → 1206x2622, iPad Pro 13-inch (M5) → 2064x2752,
#   iPhone Duo: display 1 = outer 1398x2034, display 3 + unfold = inner 2007x2853.
# The app's tour (src/shots.ts) writes each screen's name to Documents/shots/ready; this script takes the
# screenshot and answers in Documents/shots/next.
set -euo pipefail
NAME_DEV=$1; OUT=$2; DISPLAY_ID=${3:-}; MODE=${4:-}
BUNDLE=com.heyobi.querly
mkdir -p "$OUT"
DEV=$(xcrun simctl list devices available -j | python3 -c "
import json, sys
name = sys.argv[1]
d = json.load(sys.stdin)['devices']
rts = sorted([r for r in d if 'iOS' in r], reverse=True)
for r in rts:
    for x in d[r]:
        if x['name'] == name:
            print(x['udid']); sys.exit()
" "$NAME_DEV")
echo "simulator $NAME_DEV $DEV"
xcrun simctl boot "$DEV" || true
xcrun simctl bootstatus "$DEV" -b
if [ "$MODE" = "unfold" ]; then
  # Open the foldable: inner display on, outer display off, so the app lays out on the 7.6" screen.
  xcrun simctl io "$DEV" screenConfig --display=3 power on || true
  xcrun simctl io "$DEV" screenConfig --display=1 power off || true
  sleep 5
fi
xcrun simctl status_bar "$DEV" override --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 || true
APP=$(find build/sim/Build/Products -name "App.app" -path "*iphonesimulator*" | head -1)
xcrun simctl uninstall "$DEV" "$BUNDLE" || true
xcrun simctl install "$DEV" "$APP"
xcrun simctl launch "$DEV" "$BUNDLE"
DATA=$(xcrun simctl get_app_container "$DEV" "$BUNDLE" data)
DARG=(); [ -n "$DISPLAY_ID" ] && DARG=(--display="$DISPLAY_ID")
for i in $(seq 1 900); do
  if [ -f "$DATA/Documents/shots/ready" ]; then
    NAME=$(cat "$DATA/Documents/shots/ready")
    [ "$NAME" = "done" ] && { echo "tour finished"; break; }
    if [ ! -f "$OUT/$NAME.png" ]; then
      sleep 1
      xcrun simctl io "$DEV" screenshot "${DARG[@]}" "$OUT/$NAME.png" || echo "screenshot failed for $NAME"
      echo "saved $NAME"
    fi
    printf '%s' "$NAME" > "$DATA/Documents/shots/next"
  fi
  sleep 1
done
sips -g pixelWidth -g pixelHeight "$OUT"/*.png | grep pixel | sort | uniq -c || true
xcrun simctl shutdown "$DEV" || true
