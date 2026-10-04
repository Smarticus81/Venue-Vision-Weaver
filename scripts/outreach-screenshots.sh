#!/usr/bin/env bash
# Screenshot the outreach studio samples (desktop + mobile, light + dark) and,
# optionally, the /control review screen, with headless Chrome/Chromium.
#
#   scripts/outreach-screenshots.sh <samples-dir> [control-url]
#
# Looks for google-chrome, chromium, chromium-browser, or $CHROME.
set -euo pipefail

SAMPLES="${1:-qa-output/outreach-demo}"
CONTROL_URL="${2:-}"
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for candidate in google-chrome google-chrome-stable chromium chromium-browser /opt/pw-browsers/chromium; do
    if command -v "$candidate" >/dev/null 2>&1 || [ -x "$candidate" ]; then CHROME="$candidate"; break; fi
  done
fi
if [ -z "$CHROME" ]; then
  echo "No Chrome/Chromium found; set CHROME=/path/to/chrome" >&2
  exit 1
fi

shoot() { # url out width height
  "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=12000 --window-size="$3,$4" --screenshot="$2" "$1" >/dev/null 2>&1
  echo "  wrote $2"
}

# Headless Chrome enforces a ~500px minimum window, so a phone-width capture
# goes through a wrapper page with a 390px iframe: the iframe is the viewport
# the email's media queries see, and the capture is cropped to it.
mobile_wrapper() { # target-url out-html
  cat > "$2" <<HTML
<!doctype html><html><head><meta charset="utf-8"><title>mobile frame</title></head>
<body style="margin:0;background:#9a9a9a"><iframe src="$1" width="390" height="1700" style="border:0;display:block"></iframe></body></html>
HTML
}

for dir in "$SAMPLES"/*/; do
  [ -f "$dir/email-light.html" ] || continue
  slug=$(basename "$dir")
  echo "$slug"
  abs=$(cd "$dir" && pwd)
  for scheme in light dark; do
    shoot "file://$abs/email-$scheme.html" "$dir/desktop-$scheme.png" 960 1500
    mobile_wrapper "email-$scheme.html" "$dir/.mobile-$scheme.html"
    shoot "file://$abs/.mobile-$scheme.html" "$dir/mobile-$scheme.png" 390 1700
    rm -f "$dir/.mobile-$scheme.html"
  done
done

if [ -n "$CONTROL_URL" ]; then
  echo "control"
  shoot "$CONTROL_URL" "$SAMPLES/control-outreach-desktop.png" 1440 1250
  mobile_wrapper "$CONTROL_URL" "$SAMPLES/.control-mobile.html"
  shoot "file://$(cd "$SAMPLES" && pwd)/.control-mobile.html" "$SAMPLES/control-outreach-mobile.png" 390 1700
  rm -f "$SAMPLES/.control-mobile.html"
fi

# PNG screenshots of photo-heavy emails run 500KB+ each; keep the committed
# samples light by converting to JPEG (sharp is a workspace dependency).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/scripts/node_modules/tsx/dist/cli.mjs" "$ROOT/scripts/src/compress-screenshots.ts" "$SAMPLES"
