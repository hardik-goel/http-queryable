#!/usr/bin/env bash
# Regenerate the 30-second demo GIF (docs/demo.gif) from scripts/demo.tape.
#
# Single dependency: VHS (https://github.com/charmbracelet/vhs), which bundles a
# headless terminal + ffmpeg and renders a deterministic GIF from the tape.
#
#   Install:  brew install vhs     (or: go install github.com/charmbracelet/vhs@latest)
#   Run:      ./scripts/record-demo.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v vhs >/dev/null 2>&1; then
  echo "Missing dependency: vhs"
  echo "Install it, then re-run:"
  echo "  brew install vhs        # macOS"
  echo "  go install github.com/charmbracelet/vhs@latest"
  exit 1
fi

echo "Building package (the demo imports the real published entry points)…"
npm run build >/dev/null

# Free the demo port in case a previous run left it bound.
lsof -ti tcp:3000 | xargs kill -9 2>/dev/null || true

echo "Recording docs/demo.gif via VHS…"
vhs scripts/demo.tape

echo "Done: docs/demo.gif"
