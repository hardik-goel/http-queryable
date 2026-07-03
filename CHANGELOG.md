# Changelog

All notable changes to `http-queryable` are documented here. This project
follows [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-07-03

Initial release. QUERY (RFC 10008) endpoints + correct body-aware caching for Node.

### Added
- **Framework-agnostic core**
  - Runtime QUERY-support detection (`isQueryMethodSupported`,
    `assertQueryMethodSupported`); requires Node >= 22.
  - Media-type parsing; QUERY request validation (`validateQueryRequest`).
  - Conservative, meaning-preserving body canonicalization: safe canonical JSON
    (`canonicalizeJson`) that preserves numeric literals and rejects ambiguous
    duplicate keys; form-urlencoded normalization; opaque handling for unknown
    types.
  - Safe body-aware cache key (`deriveCacheKey`) — SHA-256 over length-prefixed,
    domain-separated segments incorporating the normalized body (RFC 10008 §2.7).
  - `Accept-Query` advertise/parse/negotiate helpers (RFC 10008 §3).
- **Caching layer**
  - `QueryCache` engine: RFC 9111 storability (`no-store`/`private`/`max-age`/
    status), `ETag`/`If-None-Match` conditional requests, Vary headers.
  - `CacheStore` interface + bounded-LRU `MemoryStore`.
- **Adapters**
  - Express: `queryable()` middleware (body capture, caching, CORS preflight),
    `ensureQueryMethod` polyfill, `sendAcceptQuery`, `contentLocation`.
  - Fastify (≥5): `fastifyQueryable` plugin reusing the core cache.
  - Raw `http`: `createQueryServer` / `createQueryListener`.
- **Isomorphic client**: `query(url, body, opts)` for browser fetch + Node —
  Content-Type handling, optional `Accept-Query` discovery, `Content-Location`
  follow, and safe idempotent auto-retry.
- Dual ESM/CJS build, per-subpath exports, 82 tests including an adversarial
  cache-collision suite.

[0.1.0]: https://github.com/queryable/http-queryable/releases/tag/v0.1.0
