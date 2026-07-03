# Changelog

All notable changes to `http-queryable` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-07-03

Documentation and packaging polish. No API or runtime changes.

### Changed

- Add a recorded 30-second demo GIF and reference it via an absolute URL so it
  renders on both GitHub and the npm package page.
- Point all repository metadata (`repository`, `homepage`, `bugs`, `funding`,
  README badges) at `github.com/hardik-goel/http-queryable`.
- Set the package `author` and add a funding link.

## [0.1.0] - 2026-07-03

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

[unreleased]: https://github.com/hardik-goel/http-queryable/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/hardik-goel/http-queryable/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/hardik-goel/http-queryable/releases/tag/v0.1.0
