#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_PATH="${1:-$ROOT_DIR/screenshots/current-window.png}"
EXPECTED_APP="${2:-}"
CAPTURE_SCOPE="${3:-window}"
BACKEND_URL="${PIXELBOX_BACKEND_URL:-http://127.0.0.1:3210}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "capture-current-window.sh currently supports macOS only." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"

window_info="$(
  osascript <<'APPLESCRIPT'
tell application "System Events"
  set frontProcess to first application process whose frontmost is true
  tell frontProcess
    if (count of windows) is 0 then error "Frontmost app has no visible windows."
    set frontWindow to front window
    set appName to name
    set windowTitle to name of frontWindow
    try
      set windowId to value of attribute "AXWindowNumber" of frontWindow
      return appName & "||" & windowTitle & "||" & (windowId as text) & "||||"
    on error
      try
        set p to value of attribute "AXPosition" of frontWindow
        set s to value of attribute "AXSize" of frontWindow
        set xPos to item 1 of p
        set yPos to item 2 of p
        set winWidth to item 1 of s
        set winHeight to item 2 of s
        return appName & "||" & windowTitle & "||||" & xPos & "||" & yPos & "||" & winWidth & "||" & winHeight
      on error
        error "Could not read front window geometry."
      end try
    end try
  end tell
end tell
APPLESCRIPT
)"

parsed_json="$(
  printf '%s' "$window_info" | python3 -c '
import json, sys
parts = sys.stdin.read().split("||")
parts += [""] * (7 - len(parts))
print(json.dumps({
  "appName": parts[0],
  "windowTitle": parts[1],
  "windowId": parts[2],
  "x": parts[3],
  "y": parts[4],
  "width": parts[5],
  "height": parts[6],
}))
'
)"

app_name="$(printf '%s' "$parsed_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["appName"])')"
window_title="$(printf '%s' "$parsed_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["windowTitle"])')"
window_id="$(printf '%s' "$parsed_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["windowId"])')"
x_pos="$(printf '%s' "$parsed_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["x"])')"
y_pos="$(printf '%s' "$parsed_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["y"])')"
win_width="$(printf '%s' "$parsed_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["width"])')"
win_height="$(printf '%s' "$parsed_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["height"])')"

if [[ -z "$app_name" ]]; then
  echo "Could not determine the frontmost window." >&2
  exit 1
fi

if [[ -n "$EXPECTED_APP" && "$app_name" != "$EXPECTED_APP" ]]; then
  echo "Frontmost app is '$app_name', expected '$EXPECTED_APP'." >&2
  exit 1
fi

capture_x="$x_pos"
capture_y="$y_pos"
capture_width="$win_width"
capture_height="$win_height"

if [[ "$CAPTURE_SCOPE" == "preview" ]]; then
  region_json="$(curl -fsSL "$BACKEND_URL/api/preview/getCaptureRegion" -X POST -H 'Content-Type: application/json' -d '{}')"
  region_values="$(
    printf '%s' "$region_json" | python3 -c '
import json, sys
data = json.load(sys.stdin)
print("|".join(str(data.get(key, "")) for key in ("x", "y", "width", "height", "visible")))
'
  )"
  IFS='|' read -r region_x region_y region_width region_height region_visible <<<"$region_values"
  if [[ "$region_visible" != "True" && "$region_visible" != "true" ]]; then
    echo "Preview capture region is not currently visible." >&2
    exit 1
  fi
  capture_x=$((x_pos + region_x))
  capture_y=$((y_pos + region_y))
  capture_width="$region_width"
  capture_height="$region_height"
fi

if [[ "$CAPTURE_SCOPE" == "window" && -n "$window_id" ]]; then
  screencapture -x -l "$window_id" "$OUTPUT_PATH"
else
  if [[ -z "$capture_x" || -z "$capture_y" || -z "$capture_width" || -z "$capture_height" ]]; then
    echo "Could not determine capture bounds." >&2
    exit 1
  fi
  screencapture -x -R "${capture_x},${capture_y},${capture_width},${capture_height}" "$OUTPUT_PATH"
fi

metadata_path="${OUTPUT_PATH%.*}.json"
timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
cat > "$metadata_path" <<EOF
{
  "appName": $(printf '%s' "$app_name" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  "windowTitle": $(printf '%s' "$window_title" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  "windowId": ${window_id:-null},
  "bounds": {
    "x": ${x_pos:-null},
    "y": ${y_pos:-null},
    "width": ${win_width:-null},
    "height": ${win_height:-null}
  },
  "captureScope": $(printf '%s' "$CAPTURE_SCOPE" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),
  "captureBounds": {
    "x": ${capture_x:-null},
    "y": ${capture_y:-null},
    "width": ${capture_width:-null},
    "height": ${capture_height:-null}
  },
  "capturedAt": "$timestamp",
  "imagePath": $(printf '%s' "$OUTPUT_PATH" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
}
EOF

printf '%s\n' "$OUTPUT_PATH"
