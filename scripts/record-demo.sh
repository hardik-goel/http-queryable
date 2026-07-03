#!/usr/bin/env bash
# Record the 30-second demo as an asciinema cast and convert it to a GIF.
#
# Single dependency to install yourself:
#   - asciinema  (records the terminal)   https://asciinema.org
#   - agg        (cast -> gif, from asciinema)  https://github.com/asciinema/agg
#
# We convert with `agg` (Rust, actively maintained, reliable) rather than the
# older svg-term/asciicast2gif chains. Output: docs/demo.gif
#
# Usage:  ./scripts/record-demo.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CAST="$ROOT/demo.cast"
OUT="$ROOT/docs/demo.gif"
PORT="${PORT:-3000}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing dependency: $1"
    echo "Install it, then re-run:"
    echo "  $2"
    exit 1
  fi
}

# Never half-produce: check both tools up front.
need asciinema "brew install asciinema   # or: pipx install asciinema"
need agg        "brew install agg         # or: cargo install --git https://github.com/asciinema/agg"

echo "Building package (demo imports the real published entry points)…"
( cd "$ROOT" && npm run build >/dev/null )

mkdir -p "$ROOT/docs"

# The scripted session the recording will play back. Keeps the demo deterministic.
PLAYBOOK="$(cat <<'EOF'
echo '$ npm run demo:serve   (5-line Express QUERY endpoint, body-aware cache)'
sleep 1
echo '$ curl -X QUERY /search  -d {"q":"cats"}'
curl -sS -D - -X QUERY "localhost:PORT/search" -H 'content-type: application/json' -d '{"q":"cats"}' | grep -iE 'x-query-cache|executions'
sleep 2
echo '$ curl -X QUERY /search  -d { "q" : "cats" }   # same meaning, re-spaced'
curl -sS -D - -X QUERY "localhost:PORT/search" -H 'content-type: application/json' -d '{ "q" : "cats" }' | grep -iE 'x-query-cache|executions'
sleep 2
echo '$ curl -X QUERY /search  -d {"q":"dogs"}        # DIFFERENT body'
curl -sS -D - -X QUERY "localhost:PORT/search" -H 'content-type: application/json' -d '{"q":"dogs"}' | grep -iE 'x-query-cache|executions'
sleep 2
EOF
)"
PLAYBOOK="${PLAYBOOK//PORT/$PORT}"

echo "Starting demo server on :$PORT…"
( cd "$ROOT" && PORT="$PORT" node scripts/demo-server.mjs >/tmp/queryable-demo.log 2>&1 ) &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 1.5

echo "Recording…"
asciinema rec "$CAST" --overwrite --command "bash -lc \"$PLAYBOOK\""

echo "Converting to GIF with agg…"
agg --theme monokai --font-size 20 "$CAST" "$OUT"

echo "Done: $OUT"
