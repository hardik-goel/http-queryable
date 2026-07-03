import { describe, it, expect } from "vitest";
import { deriveCacheKey } from "../src/core/cache-key.js";
import { normalizeBody } from "../src/core/normalize.js";

const JSON_CT = "application/json";

function key(body: string, ct = JSON_CT, url = "/search", opts = {}) {
  return deriveCacheKey({ url, body, contentType: ct }, opts).key;
}

describe("deriveCacheKey — semantic equality => SAME key (correct hits)", () => {
  it("same JSON with reordered keys and whitespace hits", () => {
    expect(key('{ "a":1, "b":2 }')).toBe(key('{"b":2,"a":1}'));
  });

  it("empty body is stable", () => {
    expect(key("", JSON_CT)).toBe(key("", JSON_CT));
  });

  it("form body with encoding variance hits", () => {
    const ct = "application/x-www-form-urlencoded";
    // %20 and + both denote space in form encoding.
    expect(key("q=a+b", ct)).toBe(key("q=a%20b", ct));
  });
});

describe("deriveCacheKey — semantic difference => DIFFERENT key (no false hits)", () => {
  it("THE headline safety property: different body, different key", () => {
    expect(key('{"q":"cats"}')).not.toBe(key('{"q":"dogs"}'));
  });

  it("different values do not collide", () => {
    expect(key('{"a":1}')).not.toBe(key('{"a":2}'));
  });

  it("array reordering is a different query", () => {
    expect(key('{"ids":[1,2,3]}')).not.toBe(key('{"ids":[3,2,1]}'));
  });

  it("large integers that JSON.parse would collapse stay distinct", () => {
    expect(key('{"id":9007199254740992}')).not.toBe(key('{"id":9007199254740993}'));
  });

  it("different URL at same body is a different key", () => {
    expect(key('{"q":"x"}', JSON_CT, "/a")).not.toBe(key('{"q":"x"}', JSON_CT, "/b"));
  });

  it("query-string order is preserved (not assumed insignificant)", () => {
    expect(key('{"q":"x"}', JSON_CT, "/s?a=1&b=2")).not.toBe(
      key('{"q":"x"}', JSON_CT, "/s?b=2&a=1"),
    );
  });

  it("same bytes under different content types do not cross", () => {
    expect(key('{"a":1}', "application/json")).not.toBe(
      key('{"a":1}', "application/x-www-form-urlencoded"),
    );
  });
});

describe("deriveCacheKey — opaque bodies", () => {
  it("unknown content type is not cacheable by default", () => {
    const r = deriveCacheKey({ url: "/s", body: "hello", contentType: "text/plain" });
    expect(r.cacheable).toBe(false);
    expect(r.normalization.kind).toBe("opaque");
  });

  it("opaque body becomes cacheable (exact-byte) when opted in", () => {
    const r = deriveCacheKey(
      { url: "/s", body: "hello", contentType: "text/plain" },
      { cacheOpaqueBodies: true },
    );
    expect(r.cacheable).toBe(true);
    // Exact-byte: different bytes -> different key.
    const r2 = deriveCacheKey(
      { url: "/s", body: "hellO", contentType: "text/plain" },
      { cacheOpaqueBodies: true },
    );
    expect(r.key).not.toBe(r2.key);
  });

  it("malformed JSON degrades to opaque, not cacheable by default", () => {
    const n = normalizeBody("{bad json", "application/json");
    expect(n.kind).toBe("opaque");
    expect(n.cacheable).toBe(false);
  });

  it("duplicate-key JSON degrades to opaque (ambiguous)", () => {
    const n = normalizeBody('{"a":1,"a":2}', "application/json");
    expect(n.kind).toBe("opaque");
    expect(n.cacheable).toBe(false);
    expect(n.reason).toMatch(/duplicate/i);
  });
});

describe("deriveCacheKey — vary headers", () => {
  it("folds vary headers into the key", () => {
    const base = { url: "/s", body: '{"a":1}', contentType: JSON_CT };
    const en = deriveCacheKey({ ...base, varyHeaders: [["accept-language", "en"]] }).key;
    const fr = deriveCacheKey({ ...base, varyHeaders: [["accept-language", "fr"]] }).key;
    expect(en).not.toBe(fr);
  });

  it("vary header order does not matter", () => {
    const a = deriveCacheKey({
      url: "/s",
      body: '{"a":1}',
      contentType: JSON_CT,
      varyHeaders: [
        ["x-a", "1"],
        ["x-b", "2"],
      ],
    }).key;
    const b = deriveCacheKey({
      url: "/s",
      body: '{"a":1}',
      contentType: JSON_CT,
      varyHeaders: [
        ["x-b", "2"],
        ["x-a", "1"],
      ],
    }).key;
    expect(a).toBe(b);
  });
});
