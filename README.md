# http-queryable

**The new HTTP `QUERY` method is here ([RFC 10008](https://www.rfc-editor.org/), IETF, June 2026) — but there's no easy, _safe_ way to use it in Node.**
`http-queryable` gives you QUERY endpoints **and correct body-aware caching** in a few lines — for Express, Fastify, raw `http`, and an isomorphic browser/Node client.

[![npm](https://img.shields.io/npm/v/http-queryable.svg)](https://www.npmjs.com/package/http-queryable)
[![CI](https://github.com/hardik-goel/http-queryable/actions/workflows/ci.yml/badge.svg)](https://github.com/hardik-goel/http-queryable/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](#requirements)
[![types](https://img.shields.io/badge/types-included-blue.svg)](#api-surface)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](./CODE_OF_CONDUCT.md)

![http-queryable 30-second demo](https://raw.githubusercontent.com/hardik-goel/http-queryable/master/docs/demo.gif)

> Same-meaning body (re-spaced) → cache **HIT** and the handler doesn't re-run; a **different** body → the correct **different** result, never a stale hit.

---

## Quickstart — a QUERY endpoint in ~5 lines

```bash
npm install http-queryable express
```

```js
import express from "express";
import { queryable, QueryCache } from "http-queryable/express";

const app = express();
app.use(queryable({ cache: new QueryCache() })); // QUERY + safe caching
app.query("/search", (req, res) => res.json(search(req.body)));
app.listen(3000);
```

Hit it with a body — `QUERY` is "GET with a body":

```bash
curl -X QUERY localhost:3000/search \
  -H 'content-type: application/json' \
  -d '{"q":"cats"}'
```

## The differentiator

> **The only QUERY library that caches correctly — a different request body never gets another body's cached response.**

Shared HTTP caches key on **method + URL** only. With QUERY, many different bodies hit the **same URL**, so a naive cache can serve the **wrong** result. RFC 10008 §2.7 requires the **request body** to be part of the cache key. `http-queryable` does exactly that — and does it _conservatively_, so it never produces a false hit.

```bash
curl -X QUERY /search -d '{"q":"cats"}'      # → X-Query-Cache: MISS  → cats result
curl -X QUERY /search -d '{ "q" : "cats" }'  # → X-Query-Cache: HIT   (same meaning, re-spaced)
curl -X QUERY /search -d '{"q":"dogs"}'      # → X-Query-Cache: MISS  → dogs result (NOT stale cats)
```

The second call is a **hit** because the body means the same thing (key order and
whitespace don't matter). The third is a **miss with the correct result** because
the body is genuinely different. Even the existing Fastify QUERY plugin punts on
this and tells you to keep responses private — we solve it.

## Why QUERY

- **GET-safe + POST-body + cacheable.** Safe, idempotent reads that carry a real
  request body — no more cramming complex queries into the URL.
- **It's a standard.** RFC 10008 (June 2026) defines the method, `Accept-Query`
  negotiation, and that the cache key includes the body.
- **Kills real pain.** No more URL-length limits on big search/filter payloads,
  and no more abusing `POST` for reads (which breaks caching and idempotency).

## Supported

| Target                    | Support                                                 |
| ------------------------- | ------------------------------------------------------- |
| **Express** (4 & 5)       | ✓ `app.query()` + safe caching, CORS preflight, helpers |
| **Fastify** (≥5)          | ✓ plugin reusing the same caching core                  |
| **raw `node:http`**       | ✓ `createQueryServer` / `createQueryListener`           |
| **Browser + Node client** | ✓ isomorphic `query(url, body, opts)`                   |

### Requirements

Node **>= 22**. QUERY must be accepted by the runtime's HTTP parser; Node lists
`QUERY` in `http.METHODS` starting at v22. `http-queryable` detects this at
startup and fails with an actionable error on older Node.

---

## The client (browser + Node)

```js
import { query } from "http-queryable/client";

const { response } = await query("https://api.example.com/search", { q: "cats" });
const results = await response.json();
```

- Sets `Content-Type` and serializes the body (JSON by default).
- Optional `Accept-Query` discovery via `OPTIONS` (`{ discover: true }`).
- Optional follow of `Content-Location`/`Location` to `GET` the canonical result
  (`{ followResult: true }`), per RFC 9110 §10.2.2.
- **Safe auto-retry** with backoff — sound because QUERY is idempotent (RFC 10008 §2).

## Fastify

```js
import Fastify from "fastify";
import { fastifyQueryable, QueryCache } from "http-queryable/fastify";

const app = Fastify();
await app.register(fastifyQueryable, { cache: new QueryCache() });
app.route({
  method: "QUERY",
  url: "/search",
  handler: (req, reply) => reply.send(search(req.body)),
});
```

## Raw `http`

```js
import { createQueryServer, QueryCache } from "http-queryable/http";

createQueryServer(
  (req, res, ctx) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(search(ctx.body)));
  },
  { cache: new QueryCache() },
).listen(3000);
```

---

## How the caching stays safe

The whole safety argument rests on one asymmetry:

- A false **miss** (two equal bodies get different keys) is harmless — you recompute.
- A false **hit** (two _different_ bodies share a key) is a correctness/security
  bug — one client sees another's result. **RFC 10008 Security Considerations**
  flags exactly this.

So every normalization we apply is **provably meaning-preserving**, and when in
doubt we normalize _less_:

| Content-Type                            | What we normalize                                                  | What we never do                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `application/json`, `*+json`            | insignificant whitespace, object **key order**, string-escape form | merge numeric literals (`1000` ≠ `1e3`); collapse big ints that lose precision; guess on **duplicate keys** (→ opaque) |
| `application/x-www-form-urlencoded`     | percent-encoding case, `+`/`%20`                                   | reorder pairs                                                                                                          |
| anything else (text, xml, octet-stream) | nothing — treated as **opaque**                                    | cache by default (opt in with `cacheOpaqueBodies`, still exact-byte only)                                              |

Keys are length-prefixed, domain-separated, and SHA-256 hashed so no
concatenation of URL/type/body can forge a collision. The engine also honors
`Cache-Control` (`no-store`/`private`/`max-age`), cacheable status codes
(RFC 9111), and `ETag`/`If-None-Match` conditional requests.

### `Accept-Query` negotiation (RFC 10008 §3)

```js
import { advertiseAcceptQuery, negotiateQueryType } from "http-queryable";

res.setHeader("Accept-Query", advertiseAcceptQuery(["application/json", "application/sql"]));
const chosen = negotiateQueryType(req.headers["accept-query"], ["application/json"]);
```

## API surface

- **Core** (`http-queryable`): `deriveCacheKey`, `normalizeBody`,
  `canonicalizeJson`, `validateQueryRequest`, `advertiseAcceptQuery`,
  `parseAcceptQuery`, `negotiateQueryType`, `QueryCache`, `MemoryStore`,
  `CacheStore`, `isQueryMethodSupported`, `assertQueryMethodSupported`.
- **`/express`**: `queryable()`, `ensureQueryMethod`, `sendAcceptQuery`,
  `contentLocation`, `rejectInvalidQuery`.
- **`/fastify`**: `fastifyQueryable` plugin (+ `reply.acceptQuery`,
  `reply.contentLocation`).
- **`/http`**: `createQueryServer`, `createQueryListener`.
- **`/client`**: `query`, `discoverAcceptQuery`.

### Custom cache store

```js
class RedisStore {
  /* get/set/delete/clear */
}
new QueryCache({ store: new RedisStore() });
```

`http-queryable` ships an in-memory LRU + the `CacheStore` interface — plug in
Redis/Memcached/etc. We deliberately don't ship a cache backend; the value is the
correct body-aware **key**.

## Roadmap (future, not in v0.1)

- Edge/CDN pass-through guidance and adapters.
- GraphQL-over-QUERY integration.
- Additional structured body types (XML/CBOR) with conservative canonicalization.

## Contributing & community

Contributions are welcome — bug fixes, adapters, and **conservative** new body
normalizers especially. Please read:

- [CONTRIBUTING.md](./CONTRIBUTING.md) — dev setup, evals-first testing, Conventional
  Commits, branch naming, and the DCO sign-off.
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Contributor Covenant 2.1.
- [SECURITY.md](./SECURITY.md) — **report vulnerabilities privately**, never in a
  public issue. Cache-key collisions are treated as security bugs.

Bugs and features go through the [issue forms](../../issues/new/choose). See the
[changelog](./CHANGELOG.md) for release history.

## License

[MIT](./LICENSE) © `http-queryable` contributors
