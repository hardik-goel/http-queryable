# BUILD_LOG — `http-queryable`

A running, concrete log of building `http-queryable` end-to-end with an explicit
loop-engineering method (inner loop = evals-first agentic coding; middle loop =
product-judgment self-review; outer loop = prep for a human). Timestamps are
from the build day (2026-07-03).

---

## Phase 0 — Scaffold · 18:36–18:49

- **npm name.** `queryable` is already taken (v0.3.6 on npm). Checked
  alternatives; **`http-queryable`** is free (npm 404) and is more descriptive
  anyway — it says exactly what it is. Shipping under that name; the product
  concept stays "queryable". (Recorded for the human in VERIFY_BEFORE_LAUNCH.)
- Runtime is Node 22.16 and `http.METHODS.includes('QUERY') === true`, so the
  parser accepts inbound QUERY. Wrote `src/runtime.ts` to detect this and throw
  an actionable error on older Node instead of the confusing parser-level 400.
- Toolchain: TypeScript (strict + `noUncheckedIndexedAccess`), **tsup** for dual
  ESM/CJS with per-adapter entry points, **vitest**, eslint, GitHub Actions CI
  (Node 22 + 24), MIT, `engines.node >= 22`.
- **Product judgment:** per-subpath exports (`/express`, `/fastify`, `/http`,
  `/client`) from day one so importing the Express glue never drags Fastify into
  a bundle. Core stays dependency-free.

## Phase 1 — Framework-agnostic core (the moat) · 18:49

Evals written first (`test/canonical-json.test.ts`, `test/cache-key.test.ts`).

- **The load-bearing decision: false MISS is safe, false HIT is dangerous.** The
  cache key must incorporate the _normalized_ body (RFC 10008 §2.7), and the one
  unacceptable failure is two DIFFERENT bodies colliding to the same key (a
  different client's response served for your query). So every normalization has
  to be _provably meaning-preserving_; when unsure, we normalize LESS.
- **Evals-first caught a real collision risk before any code shipped.** The
  obvious implementation of "canonical JSON" is `JSON.parse` + re-`stringify`
  with sorted keys. But `JSON.parse("9007199254740993") === 9007199254740992` —
  precision loss. Two distinct integers would map to the SAME key → a false hit.
  The adversarial test `does NOT merge large integers…` fails against the naive
  approach. Fix: a small recursive-descent canonicalizer (`canonical-json.ts`)
  that **preserves numeric literal text verbatim** and only normalizes what is
  provably safe (whitespace, key order, string-escape form). Consequence: `1000`
  and `1e3` are treated as _different_ keys — a harmless miss, never a wrong hit.
- **Duplicate object keys** (`{"a":1,"a":2}`) are ambiguous across parsers
  (RFC 8259 §4). The canonicalizer refuses them; `normalizeBody` degrades such a
  body to _opaque_ (not cached by default) rather than guess.
- **Unknown content types** (text/plain, XML, octet-stream) are never
  semantically normalized. They're opaque and, by default, **not cached** —
  `cacheOpaqueBodies` opts into exact-byte caching, which is still collision-safe
  but off by default because intermediaries may normalize unknown types.
- **form-urlencoded** is normalized only via `URLSearchParams` round-trip
  (percent-encoding case, `+`/`%20`) while **preserving pair order** — safe.
- Cache key: length-prefixed, domain-separated segments (method/url/ctype/kind/
  body/vary) hashed with SHA-256 so no concatenation can forge a collision.
- Result: **41 core tests green.**

## Phase 3 — Body-aware caching engine · 18:51–18:53

(Built before Express because Express reuses it.)

- `cache/store.ts`: `CacheStore` interface + bounded-LRU `MemoryStore` (lazy TTL
  expiry, injectable clock for deterministic tests). Pluggable, not a backend
  empire (scope guard held).
- `cache/cache.ts`: `QueryCache` combining the safe key, RFC 9111 storability
  (no-store / private / max-age / status), and ETag / If-None-Match 304s.
- **Evals-first caught a name-collision bug.** First run: _all 14 tests_ failed
  with `cache.store is not a function`. Cause: the class had both a private
  instance field `store` (the backing CacheStore) and a public method `store()`
  — the field shadowed the method on the instance. Renamed the field to
  `backend`. Green. A pure unit run surfaced it in seconds; through an adapter it
  would have looked like "caching mysteriously does nothing."
- Adversarial suite includes the headline property directly: _a different body
  never returns a prior body's cached response_, plus semantic-equal hits,
  array-order sensitivity, big-int distinctness, TTL, and Vary. **14 tests green.**

## Phase 2 — Express integration · 18:53–19:02

- **Empirical finding that reshaped the phase.** The brief assumes "Express has
  no QUERY verb." Probed Express 5 on Node 22: `app.query('/search', handler)`
  **already routes QUERY natively** (Express registers a router method per
  `http.METHODS` entry, which now includes QUERY). Verified end-to-end with a
  real `QUERY` request.
- **Product-judgment pivot:** so the _real_ Express gap isn't the verb — it's the
  surrounding safety/DX: raw-body capture for correct cache keys, the body-aware
  cache, CORS preflight (QUERY is **not** a Fetch CORS-safelisted method, so
  cross-origin QUERY always preflights), `Accept-Query`/`Content-Location`
  helpers, and an `app.query` polyfill for Express 4. `queryable()` is one
  middleware that wires all of it.
- **Evals-first caught a cache-poisoning header leak.** Second identical request
  returned `X-Query-Cache: MISS` even though the lookup logged a HIT. Root cause:
  on a MISS we set `X-Query-Cache: MISS` _before_ the handler ran, so that header
  was captured into the stored response; on replay, copying stored headers
  overwrote the freshly-set `HIT`. Worse, it meant _any_ response marker/private
  header would be replayed. Fix: skip `x-query-cache` when copying and set the
  marker **last**. This is exactly the kind of bug that never shows up in a happy-
  path demo but corrupts observability in production. **8 Express tests green.**

## Phase 4 — Isomorphic client · 19:03

- Verified Node's global `fetch` (undici) accepts method `QUERY` before building.
- `client/index.ts`: `query(url, body, opts)` — no `node:*` imports (browser-
  safe). Sets Content-Type + serializes (JSON default, form/string pass-through),
  optional `Accept-Query` discovery via OPTIONS, optional `Content-Location`/
  `Location` follow-with-GET, and **safe exponential-backoff retry** justified by
  QUERY being idempotent (RFC 10008 §2). Tested with a mock fetch across both
  request shaping and all follow/retry paths. **11 tests green.**

## Phase 5 — Fastify + raw-http adapters (thin) · 19:05–19:06

- Fastify 5.9 exposes `addHttpMethod`; used `addHttpMethod('QUERY',{hasBody})`
  plus raw-preserving content-type parsers so the cache key sees exact bytes.
  Plugin uses `skip-override` to apply hooks to the registering scope — no
  `fastify-plugin` dependency added (scope guard held).
- Raw `http.Server` adapter (`createQueryListener`/`createQueryServer`) proves
  the core is genuinely framework-agnostic. Both adapters reuse the identical
  `QueryCache`. **5 adapter tests green**, including the body-aware safety check.

## Phase 6/7 — Docs, demo, polish · 19:06–

- Full suite: **82 tests green**, typecheck clean, dual build clean, eslint clean.
  Coverage ~88% (the uncovered lines are the Node<22 failure path, which can't run
  on a supported test runtime — noted in VERIFY_BEFORE_LAUNCH).
- README written above-the-fold-first: hook, demo GIF placeholder, 5-line Express
  quickstart, the differentiator shown, why-QUERY bullets, support matrix.
- 30-second demo is a real runnable script (`scripts/demo-server.mjs` +
  `scripts/demo-script.md` + `scripts/record-demo.sh` via asciinema→agg).
- `CHANGELOG.md` at 0.1.0; `npm publish --dry-run` verified; no telemetry, no
  network calls beyond what the user's own code makes.

### Decisions log (quick reference)

- Name → `http-queryable` (taken: `queryable`).
- Canonical JSON preserves number literals (collision safety) — the single most
  important correctness decision.
- Opaque bodies not cached by default; exact-byte opt-in.
- Express verb already works natively → package's Express value is safety + DX.
- No `fastify-plugin` dep (manual skip-override). No Redis, no CDN, no GraphQL.
