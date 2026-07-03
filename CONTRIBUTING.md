# Contributing to http-queryable

Thanks for your interest in improving `http-queryable`! This project makes the
HTTP QUERY method (RFC 10008) easy and **safe** to use in Node — correctness of
the caching layer is paramount, so contributions are held to a high bar. This
guide explains how to propose changes.

By participating, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Testing (evals-first)](#testing-evals-first)
- [Coding standards](#coding-standards)
- [Commit conventions](#commit-conventions)
- [Branch naming](#branch-naming)
- [Pull request process](#pull-request-process)
- [Reporting bugs & security issues](#reporting-bugs--security-issues)
- [Developer Certificate of Origin](#developer-certificate-of-origin)

## Ways to contribute

- **Report bugs** and **request features** via
  [issues](../../issues/new/choose).
- **Improve docs** — clarity fixes are always welcome.
- **Submit code** — bug fixes, adapters, conservative new body-normalizers.
- **Security** — see [SECURITY.md](./SECURITY.md); do **not** open a public
  issue for vulnerabilities.

For anything non-trivial, please open an issue to discuss the approach before
investing in a PR.

## Development setup

Requires **Node >= 22** (QUERY must be accepted by the runtime's HTTP parser —
see the README). We recommend the version in [`.nvmrc`](./.nvmrc).

```bash
git clone https://github.com/queryable/http-queryable.git
cd http-queryable
npm install

npm test             # run the vitest suite
npm run test:watch   # watch mode
npm run coverage     # coverage report
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # dual ESM/CJS build via tsup
npm run demo:serve   # run the live headline demo (after build)
```

## Project layout

```
src/
  runtime.ts          Node >= 22 QUERY detection
  core/               framework-agnostic core (the moat)
    media-type.ts     Content-Type parsing
    canonical-json.ts safe canonical JSON (collision-proof)
    normalize.ts      body canonicalization per content type
    cache-key.ts      safe body-aware cache key
    request.ts        QUERY request validation
    accept-query.ts   Accept-Query negotiation
  cache/              framework-agnostic caching engine + stores
  express/  fastify/  http/  client/   thin adapters (subpath exports)
test/                 vitest suites, incl. the adversarial cache tests
```

Core logic must stay framework-agnostic; adapters stay thin.

## Testing (evals-first)

**Write the test first.** This is non-negotiable for anything touching the
caching or normalization path. The security model rests on one asymmetry:

- a false cache **miss** is harmless;
- a false cache **hit** (two different bodies sharing a key) is a security bug.

So new normalizers ship with **adversarial tests**: prove semantically-equal
inputs collapse to the same key **and** that semantically-different inputs never
collide. See `test/canonical-json.test.ts` and `test/cache-key.test.ts` for the
expected style. PRs that change caching without adversarial coverage will be
asked for it.

All PRs must pass `npm run lint`, `npm run typecheck`, `npm run build`, and
`npm test` — CI enforces this on Node 22 and 24.

## Coding standards

- TypeScript, `strict` + `noUncheckedIndexedAccess`. No `// @ts-ignore` without
  a comment explaining why.
- Match the surrounding style; formatting is enforced by Prettier
  (`npm run format`) and ESLint.
- Cite the relevant **RFC section** in a comment whenever behavior depends on a
  spec detail (e.g. `// RFC 10008 §2.7`). Auditable correctness is a feature.
- Keep the public API minimal and documented with TSDoc.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
The commit message drives the changelog and the SemVer bump.

```
<type>(optional scope): <description>

[optional body]

[optional footer(s)]
```

Allowed **types**:

| Type       | SemVer | Use for                                            |
| ---------- | ------ | -------------------------------------------------- |
| `feat`     | minor  | a new feature                                      |
| `fix`      | patch  | a bug fix                                          |
| `perf`     | patch  | a performance improvement                          |
| `docs`     | —      | documentation only                                 |
| `test`     | —      | adding or fixing tests                             |
| `refactor` | —      | code change that neither fixes a bug nor adds feat |
| `build`    | —      | build system / dependencies                        |
| `ci`       | —      | CI configuration                                   |
| `chore`    | —      | other changes that don't touch src or tests        |
| `revert`   | —      | reverts a previous commit                          |

A `!` after the type/scope or a `BREAKING CHANGE:` footer signals a **major**
bump (breaking API change).

Examples:

```
feat(express): add CORS preflight handling for cross-origin QUERY
fix(cache): never merge big-int literals that JSON.parse would collapse
docs(readme): clarify opaque-body caching default
feat(core)!: rename deriveCacheKey option cacheOpaque -> cacheOpaqueBodies
```

## Branch naming

- Default branch: **`main`** (protected; no direct pushes).
- Work on short-lived topic branches off `main`, prefixed by type:

  ```
  feat/express-cors-preflight
  fix/bigint-cache-collision
  docs/security-policy
  chore/bump-tsup
  ```

- Rebase on `main` before opening/refreshing a PR; keep history clean.

## Pull request process

1. Fork and create a topic branch (see above).
2. Add/adjust tests (evals-first) and update docs/`CHANGELOG.md` under
   `Unreleased`.
3. Ensure `npm run lint && npm run typecheck && npm run build && npm test` pass.
4. Open the PR using the template. Link the issue it closes. Keep PRs focused.
5. A maintainer reviews; address feedback by pushing follow-up commits (we squash
   on merge, so intermediate commits are fine).
6. The PR **title** must be a valid Conventional Commit — it becomes the squash
   commit and feeds the changelog. CI checks this.

## Reporting bugs & security issues

- Bugs / features: use the [issue forms](../../issues/new/choose).
- Security vulnerabilities: **private** disclosure only — see
  [SECURITY.md](./SECURITY.md).

## Developer Certificate of Origin

Contributions are accepted under the [DCO](https://developercertificate.org/).
By signing off your commits you certify you wrote the patch or have the right to
submit it under the project's MIT license. Sign off with:

```bash
git commit -s -m "fix(cache): ..."
```

which appends a `Signed-off-by: Your Name <you@example.com>` trailer. No separate
CLA is required.

---

Thank you for contributing! 💙
