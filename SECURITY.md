# Security Policy

`http-queryable` is security-sensitive by design: it derives cache keys from
request bodies, and an incorrect key can cause a **cache poisoning / response
mix-up** (one client served another's result). We take reports seriously and
appreciate responsible disclosure.

## Supported Versions

Security fixes are provided for the latest published minor release line. While
`0.x`, the newest `0.y` receives fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via **GitHub Private Vulnerability Reporting**:
[open a private advisory](https://github.com/hardik-goel/queryable/security/advisories/new),
or on the repository's **Security** tab → **Report a vulnerability**. This creates
a private report only the maintainers can see, and lets us collaborate on a fix
(and credit you) before any public disclosure.

Include, where possible:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a minimal proof-of-concept.
- Affected version(s) and environment (Node version, framework/adapter).
- Any suggested remediation.

### What counts as a vulnerability here

High-priority classes for this project specifically:

- **Cache-key collisions** — two semantically different request bodies mapping
  to the same cache key (a false-positive cache hit).
- **Normalization flaws** — a body transform that changes meaning, or a parser
  that can be tricked into an ambiguous canonical form.
- **Cache-control bypass** — storing a response marked `no-store`/`private`, or
  serving a stale entry past its freshness lifetime.
- **CORS / preflight** handling that would allow an unintended cross-origin
  QUERY to succeed.
- Standard classes: ReDoS, prototype pollution, resource exhaustion.

## Response Targets

| Stage                  | Target                       |
| ---------------------- | ---------------------------- |
| Acknowledge receipt    | within **3 business days**   |
| Initial assessment     | within **7 business days**   |
| Fix or mitigation plan | within **30 days** (typical) |

These are goals, not guarantees, and may vary with severity and complexity.

## Disclosure Policy

We follow **coordinated disclosure**:

1. You report privately.
2. We confirm, assess severity (CVSS), and develop a fix.
3. We release a patched version and publish a GitHub Security Advisory
   (requesting a CVE where warranted).
4. We credit reporters who wish to be named.

Please give us a reasonable window to remediate before any public disclosure. We
will keep you informed throughout.

## Scope

In scope: the `http-queryable` package source in this repository (core,
adapters, client). Out of scope: vulnerabilities in dependencies (report those
upstream), and issues requiring a misconfiguration explicitly warned against in
the documentation.

Thank you for helping keep `http-queryable` and its users safe.
