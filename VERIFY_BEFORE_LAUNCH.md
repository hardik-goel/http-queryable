# VERIFY_BEFORE_LAUNCH — `http-queryable`

A ~15-minute human checklist. Everything else in this repo is built, wired, and
tested (82 automated tests, typecheck + lint + dual build + `npm publish
--dry-run` all clean, no telemetry/secrets). These items need a human because
they touch external systems or facts I can't fully verify autonomously.

Do them in order.

---

## 1. npm name (2 min) — DECISION ALREADY MADE, confirm you're happy

- `queryable` is **taken** on npm (v0.3.6). I shipped under **`http-queryable`**,
  which was free and is more descriptive. If you'd rather use a scope, change
  `name` in `package.json` to e.g. `@yourorg/queryable` and update the README
  install lines + badge URLs.
- Confirm availability at publish time (names can be claimed):
  ```bash
  npm view http-queryable version   # expect: E404 (not found) => free
  ```

## 2. Publish (3 min)

```bash
npm login
npm run build
npm publish --dry-run   # re-confirm the file list
npm publish             # public by default (package.json has no "private")
```

## 3. Verify the RFC 10008 spec details you're asserting (5 min)

The code cites specific RFC 10008 sections in comments and docs. RFC 10008 is
brand new (June 2026); I implemented against its normative semantics from
knowledge + the standard's text, but **confirm these against the published RFC**
before the launch post, and fix the section numbers if the final text renumbered:

- **§2** — QUERY is safe + idempotent, and content requires a `Content-Type`
  (`src/core/request.ts`, `src/runtime.ts`). Idempotency is what justifies the
  client's auto-retry (`src/client/index.ts`).
- **§2.7 + Security Considerations** — the cache key includes the (normalized)
  request content, and the false-positive-hit risk. This is the load-bearing
  claim behind the whole caching design (`src/core/cache-key.ts`,
  `src/core/canonical-json.ts`, `src/cache/cache.ts`). If the RFC's caching or
  security section is numbered differently, update the comments/README table.
- **§3** — `Accept-Query` response header advertises supported query media types
  (`src/core/accept-query.ts`). Confirm it's carried on OPTIONS as implemented.
- **CORS** — QUERY is not a Fetch CORS-safelisted method, so cross-origin QUERY
  preflights (`src/express/index.ts` `handlePreflight`). Confirm against the
  current Fetch standard.

If any of these differ, the fix is localized to the file named above; tests will
tell you immediately (`npm test`).

## 4. Record the demo GIF (2 min, optional but recommended)

The README currently shows a truthful **static** `docs/demo.svg`. To produce the
animated `docs/demo.gif`:

```bash
brew install asciinema agg   # one-time (or pipx/cargo — see the script)
./scripts/record-demo.sh     # builds, starts the demo server, records, converts
```

Then point the README image at `./docs/demo.gif` (or keep both). The underlying
demo is already verified end-to-end — `npm run demo:serve` + the curls in
`scripts/demo-script.md` show MISS → HIT (re-spaced body) → MISS (different body,
correct distinct result).

## 5. Runtime/framework behaviors I could not fully exercise here (3 min)

Implemented to the reasonable, working version; verify if your launch depends on
them:

- **Node < 22 failure path.** The unsupported-runtime error in
  `src/runtime.ts` (`assertQueryMethodSupported`) can't be executed on a
  supporting test runner, so it's the one branch not covered by tests. Sanity-
  check by running any adapter's entry on Node 20 and confirming you get the
  actionable `QueryMethodUnsupportedError`, not a parser 400.
- **Express 4 polyfill.** `ensureQueryMethod(app)` is a fallback for Express
  versions whose router doesn't expose `.query`. Tests run against Express 5
  (where `app.query` is native). If you advertise Express 4, add a quick manual
  check on an Express 4 app.
- **Real proxy/CDN pass-through.** Intermediaries are where QUERY actually breaks
  in the wild (some drop unknown-method requests or bodies). Send one real QUERY
  through your production proxy/CDN/load balancer and confirm the body arrives
  and the response returns — this is the single most valuable pre-launch check
  and can't be done from this repo.

## 6. Repository & governance setup (5 min, one-time)

The community-health files are complete but reference placeholders a human must
own. Before making the repo public:

- **Repo owner / URLs.** All links assume `github.com/queryable/http-queryable`.
  If you host elsewhere, find-and-replace the org/repo in `package.json`
  (`repository`, `homepage`, `bugs`, `funding`), the README badges, `SECURITY.md`,
  `CONTRIBUTING.md`, and `.github/ISSUE_TEMPLATE/config.yml`.
- **Contact addresses.** Replace `conduct@queryable.dev` (CODE_OF_CONDUCT.md) and
  `security@queryable.dev` (SECURITY.md) with real inboxes you monitor.
- **CODEOWNERS teams.** `.github/CODEOWNERS` references `@queryable/maintainers`
  and `@queryable/core-maintainers`. Either create those GitHub teams or replace
  with individual `@handles`, else review assignment will silently no-op.
- **Enable GitHub features:** Settings → **Private vulnerability reporting** (used
  by SECURITY.md), and **Discussions** (linked from the issue chooser).
- **Code of Conduct version.** We ship **Contributor Covenant 2.1** (CC BY 4.0) —
  the most widely deployed version across the top npm libraries and the safe
  professional default. A newer **3.0** exists (released 2025-07-28, CC BY-SA
  4.0, restorative-justice framing). To adopt it, replace `CODE_OF_CONDUCT.md`
  with the canonical 3.0 text and bump the README badge from `2.1` to `3.0`.
- **Branch protection** on `main`: require CI + the PR-title check, require review,
  disallow direct pushes (CONTRIBUTING promises this).

## 7. Publishing automation (3 min, optional)

`.github/workflows/release.yml` publishes on a `vX.Y.Z` tag with **npm
provenance**. Choose one:

- **Trusted Publishing (recommended):** configure this repo as a trusted
  publisher on npm (no long-lived token). Provenance works via OIDC.
- **Token:** add repo secret `NPM_TOKEN` (an npm _automation_ token).

`package.json` already sets `publishConfig.provenance: true` and
`access: public`. To cut a release: `npm version <patch|minor|major>` → push the
tag. First release can also be done manually with `npm publish` (step 2).

---

### Confirmed complete & tested (no action needed)

- Core canonicalization + adversarial cache-collision suite (false-hit safety).
- Express / Fastify / raw-http adapters, all reusing the same cache core.
- Isomorphic client (mock-fetch tested: shaping, discovery, follow, retry).
- Dual ESM/CJS build, `.d.ts` types, per-subpath exports, CI workflow.
- No telemetry, no accounts, no network calls beyond the user's own requests.
