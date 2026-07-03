import { describe, it, expect, beforeEach } from "vitest";
import { QueryCache } from "../src/cache/cache.js";
import { MemoryStore } from "../src/cache/store.js";

// Deterministic clock so TTL tests never flake.
let clock = 1_000_000;
const now = () => clock;

function req(body: string, url = "/search", extraHeaders: Record<string, string> = {}) {
  return {
    method: "QUERY",
    url,
    headers: { "content-type": "application/json", ...extraHeaders },
    body,
  };
}

function res(bodyObj: unknown, headers: Record<string, string> = {}) {
  return {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(bodyObj),
  };
}

describe("QueryCache — the headline safety property", () => {
  let cache: QueryCache;
  beforeEach(() => {
    clock = 1_000_000;
    cache = new QueryCache({ store: new MemoryStore({ now }), defaultTtlMs: 60_000, now });
  });

  it("second identical request is a HIT with the correct body", async () => {
    const r = req('{"q":"cats"}');
    expect((await cache.lookup(r)).status).toBe("miss");
    await cache.store(r, res({ result: "cats-result" }));

    const hit = await cache.lookup(r);
    expect(hit.status).toBe("hit");
    if (hit.status === "hit") {
      expect(JSON.parse(hit.response.body.toString())).toEqual({ result: "cats-result" });
    }
  });

  it("a DIFFERENT body does NOT get the prior body's cached response", async () => {
    const cats = req('{"q":"cats"}');
    await cache.store(cats, res({ result: "cats-result" }));

    // Same URL, different body — the classic shared-cache false-hit scenario.
    const dogs = req('{"q":"dogs"}');
    const lookup = await cache.lookup(dogs);
    expect(lookup.status).toBe("miss"); // NOT a hit for cats-result
  });

  it("semantically-equal body (reordered keys/whitespace) IS a hit", async () => {
    await cache.store(req('{"a":1,"b":2}'), res({ result: "ok" }));
    const hit = await cache.lookup(req('{ "b":2, "a":1 }'));
    expect(hit.status).toBe("hit");
  });

  it("opaque (unknown type) body is never cached by default", async () => {
    const r = {
      method: "QUERY",
      url: "/s",
      headers: { "content-type": "application/x-secret" },
      body: "raw",
    };
    const stored = await cache.store(r, { status: 200, headers: {}, body: "resp" });
    expect(stored).toBe(false);
    expect((await cache.lookup(r)).status).toBe("uncacheable");
  });
});

describe("QueryCache — Cache-Control storability (RFC 9111)", () => {
  let cache: QueryCache;
  beforeEach(() => {
    clock = 1_000_000;
    cache = new QueryCache({ store: new MemoryStore({ now }), now });
  });

  it("does not store no-store responses", async () => {
    const r = req('{"q":"x"}');
    expect(await cache.store(r, res({ a: 1 }, { "cache-control": "no-store" }))).toBe(false);
    expect((await cache.lookup(r)).status).toBe("miss");
  });

  it("does not store private responses by default", async () => {
    const r = req('{"q":"x"}');
    expect(await cache.store(r, res({ a: 1 }, { "cache-control": "private" }))).toBe(false);
  });

  it("respects max-age for freshness", async () => {
    const r = req('{"q":"x"}');
    await cache.store(r, res({ a: 1 }, { "cache-control": "max-age=10" }));
    expect((await cache.lookup(r)).status).toBe("hit");
    clock += 11_000; // 11s later -> stale
    expect((await cache.lookup(r)).status).toBe("miss");
  });

  it("max-age=0 is not stored as fresh", async () => {
    const r = req('{"q":"x"}');
    expect(await cache.store(r, res({ a: 1 }, { "cache-control": "max-age=0" }))).toBe(false);
  });

  it("does not cache non-cacheable status codes", async () => {
    const r = req('{"q":"x"}');
    expect(await cache.store(r, { status: 500, headers: {}, body: "err" })).toBe(false);
  });

  it("does not cache oversized bodies", async () => {
    const small = new QueryCache({ store: new MemoryStore({ now }), maxBodyBytes: 4, now });
    const r = req('{"q":"x"}');
    expect(await small.store(r, { status: 200, headers: {}, body: "toolong" })).toBe(false);
  });
});

describe("QueryCache — conditional requests (ETag / If-None-Match)", () => {
  let cache: QueryCache;
  beforeEach(() => {
    clock = 1_000_000;
    cache = new QueryCache({ store: new MemoryStore({ now }), defaultTtlMs: 60_000, now });
  });

  it("returns not-modified when If-None-Match matches", async () => {
    const r = req('{"q":"x"}');
    await cache.store(r, res({ a: 1 }, { etag: '"v1"' }));
    const conditional = req('{"q":"x"}', "/search", { "if-none-match": '"v1"' });
    const result = await cache.lookup(conditional);
    expect(result.status).toBe("not-modified");
  });

  it("returns a hit when If-None-Match does not match", async () => {
    const r = req('{"q":"x"}');
    await cache.store(r, res({ a: 1 }, { etag: '"v1"' }));
    const conditional = req('{"q":"x"}', "/search", { "if-none-match": '"v2"' });
    expect((await cache.lookup(conditional)).status).toBe("hit");
  });
});

describe("QueryCache — Vary and invalidation", () => {
  it("varies on configured headers", async () => {
    clock = 1_000_000;
    const cache = new QueryCache({
      store: new MemoryStore({ now }),
      defaultTtlMs: 60_000,
      varyHeaders: ["accept-language"],
      now,
    });
    await cache.store(req('{"q":"x"}', "/s", { "accept-language": "en" }), res({ lang: "en" }));
    // Different Accept-Language -> different key -> miss.
    expect((await cache.lookup(req('{"q":"x"}', "/s", { "accept-language": "fr" }))).status).toBe(
      "miss",
    );
  });

  it("invalidate removes an entry", async () => {
    clock = 1_000_000;
    const cache = new QueryCache({ store: new MemoryStore({ now }), defaultTtlMs: 60_000, now });
    const r = req('{"q":"x"}');
    await cache.store(r, res({ a: 1 }));
    expect((await cache.lookup(r)).status).toBe("hit");
    await cache.invalidate(r);
    expect((await cache.lookup(r)).status).toBe("miss");
  });
});
