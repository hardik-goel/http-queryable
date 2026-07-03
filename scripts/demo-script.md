# 30-second demo script

Exact commands for the recorded demo. Total runtime under ~30s. The punchline is
the last step: a **different body** gets a **different, correct** result — never a
stale cache hit.

## Setup (once)

```bash
npm install
npm run build
npm run demo:serve   # starts the 5-line Express QUERY endpoint on :3000
```

## The recorded session

```bash
# 1. Define a QUERY endpoint in ~5 lines (scripts/demo-server.mjs) — already running.
#    app.use(queryable({ cache: new QueryCache() }))
#    app.query('/search', (req, res) => res.json(search(req.body)))

# 2. First QUERY with a body → computed at the origin (X-Query-Cache: MISS)
curl -sS -D - -X QUERY localhost:3000/search \
  -H 'content-type: application/json' \
  -d '{"q":"cats"}'
#  → X-Query-Cache: MISS   {"query":"cats", ... ,"executions":1}

# 3. Same body again (even reordered / re-spaced) → served from cache, fast (HIT)
curl -sS -D - -X QUERY localhost:3000/search \
  -H 'content-type: application/json' \
  -d '{ "q" : "cats" }'
#  → X-Query-Cache: HIT    executions STILL 1  (handler did not re-run)

# 4. THE SAFETY PUNCHLINE: a DIFFERENT body → correct DIFFERENT result, not a stale hit
curl -sS -D - -X QUERY localhost:3000/search \
  -H 'content-type: application/json' \
  -d '{"q":"dogs"}'
#  → X-Query-Cache: MISS   {"query":"dogs", ... ,"executions":2}
#    Shared method+URL caches would have wrongly returned the "cats" result here.
```

## Timing notes for the recording

- Keep the server-start scrollback trimmed; begin the cast at step 2.
- ~6s per curl with a beat to read the `X-Query-Cache` header and `executions`.
- End on step 4 so the last frame shows MISS + the distinct `dogs` result.
