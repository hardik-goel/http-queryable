# VHS tape for the 30-second demo. Regenerate with: vhs scripts/demo.tape
# Requires: vhs (https://github.com/charmbracelet/vhs). Build first: npm run build
Output docs/demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1180
Set Height 420
Set Padding 20
Set Theme "Dracula"
Set TypingSpeed 20ms
Set PlaybackSpeed 1.0

Hide
Type "cd $(git rev-parse --show-toplevel) && PORT=3000 node scripts/demo-server.mjs >/tmp/hq-demo.log 2>&1 &" Enter
Sleep 2s
Type "clear" Enter
Show

Type "# 1. First QUERY with a body -> computed at origin (MISS)" Sleep 500ms Enter
Type `curl -sS -D - -X QUERY localhost:3000/search -H 'content-type: application/json' -d '{"q":"cats"}' 2>/dev/null | grep -iE 'x-query-cache|executions'` Enter
Sleep 2500ms

Type "# 2. Same meaning, re-spaced body -> served from cache (HIT), handler NOT re-run" Sleep 500ms Enter
Type `curl -sS -D - -X QUERY localhost:3000/search -H 'content-type: application/json' -d '{  "q" : "cats"  }' 2>/dev/null | grep -iE 'x-query-cache|executions'` Enter
Sleep 2500ms

Type "# 3. DIFFERENT body -> correct DIFFERENT result, not a stale hit (the safety win)" Sleep 500ms Enter
Type `curl -sS -D - -X QUERY localhost:3000/search -H 'content-type: application/json' -d '{"q":"dogs"}' 2>/dev/null | grep -iE 'x-query-cache|executions'` Enter
Sleep 3500ms

Hide
Type "kill %1 2>/dev/null" Enter
Show
