import { describe, it, expect } from "vitest";
import { canonicalizeJson, CanonicalJsonError } from "../src/core/canonical-json.js";

describe("canonicalizeJson — meaning-preserving normalization", () => {
  it("strips insignificant whitespace", () => {
    expect(canonicalizeJson('{ "a" : 1 , "b" : 2 }')).toBe('{"a":1,"b":2}');
    expect(canonicalizeJson("[ 1 , 2 ,\n3 ]")).toBe("[1,2,3]");
  });

  it("sorts object keys (order is not semantically significant)", () => {
    expect(canonicalizeJson('{"b":2,"a":1}')).toBe(canonicalizeJson('{"a":1,"b":2}'));
    expect(canonicalizeJson('{"z":{"y":2,"x":1}}')).toBe('{"z":{"x":1,"y":2}}');
  });

  it("canonicalizes equivalent string escapes to one form", () => {
    // A is 'A'; both denote the same string.
    expect(canonicalizeJson('"\\u0041"')).toBe(canonicalizeJson('"A"'));
  });

  it("preserves array order (order IS significant)", () => {
    expect(canonicalizeJson("[1,2]")).not.toBe(canonicalizeJson("[2,1]"));
  });
});

describe("canonicalizeJson — collision safety (false HIT prevention)", () => {
  it("does NOT merge large integers that JSON.parse would collapse", () => {
    // JSON.parse both -> 9007199254740992 (precision loss). We must keep them
    // distinct so two different numbers never share a cache key.
    const a = canonicalizeJson("9007199254740992");
    const b = canonicalizeJson("9007199254740993");
    expect(a).not.toBe(b);
  });

  it("keeps distinct numeric literals distinct even if numerically equal", () => {
    // 1000 and 1e3 are equal in value; we conservatively treat them as
    // different key material (a harmless MISS, never a false HIT).
    expect(canonicalizeJson("1000")).not.toBe(canonicalizeJson("1e3"));
  });

  it("refuses ambiguous duplicate object keys", () => {
    expect(() => canonicalizeJson('{"a":1,"a":2}')).toThrow(CanonicalJsonError);
  });
});

describe("canonicalizeJson — rejects invalid JSON", () => {
  it.each([
    ["", "empty"],
    ["{", "unterminated object"],
    ['{"a":}', "missing value"],
    ["[1,2", "unterminated array"],
    ['{"a":1}garbage', "trailing content"],
    ["01", "leading zero"],
    ["'single'", "single quotes"],
    ["undefined", "not a literal"],
  ])("throws on %s (%s)", (input) => {
    expect(() => canonicalizeJson(input)).toThrow(CanonicalJsonError);
  });

  it("accepts nested and mixed structures", () => {
    const input = '{"users":[{"id":1,"tags":["a","b"]}],"ok":true,"nil":null}';
    expect(canonicalizeJson(input)).toBe(
      '{"nil":null,"ok":true,"users":[{"id":1,"tags":["a","b"]}]}',
    );
  });
});
