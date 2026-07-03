# Why QUERY — and why caching it correctly is hard

A plain-language deep dive into the HTTP `QUERY` method ([RFC 10008](https://www.rfc-editor.org/info/rfc10008/), June 2026) and the design of `http-queryable`. If you just want to use the library, the [README](../README.md) quickstart is enough — this is the "why."

## 1. The 20-year-old gap

Every HTTP API eventually needs a **read with a large or structured input**: a search with filters, a report query, a GraphQL-ish selection, a list of IDs to look up. You've always had two bad options:

- **`GET`** is the "right" verb for a read — it's **safe** (no side effects), **idempotent** (retrying is fine), and **cacheable**. But it has **no body**. Your input has to go in the URL, where you hit length limits (~2–8 KB in practice), leak query contents into logs and browser history, and fight with proxies.
- **`POST`** has a body, but it's **unsafe and non-idempotent** by definition. Intermediaries must assume it changes state, so it isn't cached, and clients can't safely auto-retry it. Using `POST` for a read is a lie the whole stack has to work around.

Developers have used `POST`-for-reads for years, knowing it's wrong.

## 2. What QUERY is

`QUERY` is the missing middle: **a request with a body, but the semantics of `GET`.**

- **Safe** — the server must not treat it as changing state.
- **Idempotent** — sending it twice is the same as once, so it's safe to retry.
- **Cacheable** — responses can be reused.

```http
QUERY /search HTTP/1.1
Content-Type: application/json

{ "q": "cats", "filters": { "color": "black" }, "page": 1 }
```

Think of it as **"GET with a body."** The RFC also defines companion machinery: `Accept-Query` (a resource advertises which body media types it understands) and the use of `Content-Location` to point at the canonical, `GET`-able URL of a result.

> **Runtime note:** the method has to be accepted by the HTTP parser. Node lists `QUERY` in `http.METHODS` starting at **Node 22**, which is why `http-queryable` requires it and fails fast with a clear error on older versions.

## 3. The trap: caching by body

Here's the part almost every early implementation gets wrong.

Shared HTTP caches (CDNs, reverse proxies, browser caches) have always keyed entries on **method + URL**. That's fine for `GET`, where the URL _is_ the whole request. But QUERY puts meaningful input in the **body**, and many different bodies hit the **same URL**:

```
QUERY /search   {"q":"cats"}   → cats results
QUERY /search   {"q":"dogs"}   → dogs results
        ^ same method, same URL, different meaning
```

A naive method+URL cache will store the first response and serve it for the second request. One user gets **another user's results** for a query they didn't make. That's not a performance bug — it's a **correctness and security bug**, and [RFC 10008 §2.7](https://www.rfc-editor.org/info/rfc10008/) plus its Security Considerations call it out explicitly: **the request content must be part of the cache key.**

Even existing QUERY tooling has punted on this — e.g. the Fastify QUERY plugin tells you to keep responses private rather than solve it. Solving it is the entire reason `http-queryable` exists.

## 4. The golden rule: misses are free, hits are dangerous

To build a body-aware cache key you have to reconcile two opposing goals:

1. Bodies that **mean the same thing** should share a key → a **hit** (fast).
   `{"a":1,"b":2}` and `{ "b":2, "a":1 }` are the same JSON value.
2. Bodies that **mean different things** must get **different** keys → never a false hit.
   `{"q":"cats"}` and `{"q":"dogs"}` are different.

The whole design follows from one asymmetry:

> A false **miss** (two equal bodies get different keys) is **harmless** — you just recompute the response.
> A false **hit** (two _different_ bodies share a key) is a **bug** — wrong data is served.

So every normalization must be **provably meaning-preserving**, and **when in doubt, normalize less.** A cache that's occasionally "too cautious" is correct. A cache that's occasionally "too clever" is broken.

## 5. What we normalize (and what we refuse to)

For a JSON body, these transforms are provably safe, so we apply them:

- **Insignificant whitespace** — `{ "a": 1 }` ≡ `{"a":1}`.
- **Object key order** — `{"a":1,"b":2}` ≡ `{"b":2,"a":1}`.
- **String escape form** — `"A"` ≡ `"A"`.

These we deliberately **do not** do, because they can change meaning:

- **Merging numeric literals.** `JSON.parse("9007199254740993")` returns `9007199254740992` — JavaScript silently loses precision. A naive parse-then-stringify would map two _different_ integers to the _same_ key: a false hit. `http-queryable` preserves the **original numeric text**, so `1000` and `1e3` are treated as different keys (a harmless miss) rather than risk a collision.
- **Guessing on duplicate keys.** `{"a":1,"a":2}` is ambiguous across parsers, so we refuse to canonicalize it and treat it as opaque.
- **Normalizing content types we don't understand.** `text/plain`, XML, binary — we treat as **opaque** and, by default, **don't cache** them (you can opt into exact-byte caching).

For `application/x-www-form-urlencoded`, we normalize only encoding-level differences (`%2F` vs `%2f`, `+` vs `%20`) and **preserve pair order** — never reordering, which could change meaning.

The cache key is then a SHA-256 over length-prefixed, domain-separated segments (method, URL, content-type, normalized body, and any `Vary` headers) so that no combination of inputs can be crafted to collide with a different request.

## 6. The rest of the QUERY story

`http-queryable` also implements the parts around the method:

- **`Accept-Query` negotiation** (RFC 10008 §3) — advertise/parse supported query media types.
- **`Content-Location`** — point clients at the canonical `GET`-able result URL (RFC 9110 §10.2.2).
- **CORS preflight** — QUERY is **not** a CORS-safelisted method, so cross-origin QUERY always triggers an `OPTIONS` preflight; the Express adapter answers it.
- **Safe auto-retry** in the client — sound precisely because QUERY is idempotent.
- **RFC 9111 storability** — honoring `no-store` / `private` / `max-age` and `ETag` / `If-None-Match`.

## 7. See it

```bash
curl -X QUERY /search -d '{"q":"cats"}'      # X-Query-Cache: MISS → cats
curl -X QUERY /search -d '{ "q" : "cats" }'  # X-Query-Cache: HIT  → same (handler didn't re-run)
curl -X QUERY /search -d '{"q":"dogs"}'      # X-Query-Cache: MISS → dogs (NOT a stale cats hit)
```

That third line is the whole point: a different body gets the correct different result, never a stale hit — the safety property nobody else ships.

---

Back to the [README](../README.md) · file issues or edge cases on [GitHub](https://github.com/hardik-goel/http-queryable).
