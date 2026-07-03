/**
 * Safe canonical JSON for cache-key derivation.
 *
 * The whole security argument of body-aware caching (RFC 10008 §2.7 and its
 * Security Considerations) rests on one asymmetry:
 *
 *   - A false cache MISS (two equal bodies get different keys) is harmless —
 *     you just recompute the response.
 *   - A false cache HIT (two DIFFERENT bodies get the SAME key) is a
 *     correctness/security bug — one client can be served another client's
 *     response for a different query.
 *
 * So every normalization we apply MUST be provably meaning-preserving. When in
 * doubt, we do LESS normalization (accepting more misses), never more.
 *
 * This is a small recursive-descent parser rather than `JSON.parse` +
 * re-`stringify` on purpose:
 *
 *   1. Number literals are preserved VERBATIM. `JSON.parse("9007199254740993")`
 *      returns 9007199254740992 (precision loss), so parse+stringify would map
 *      two different integers to the same key — a false hit. Keeping the source
 *      text means 1000 and 1e3 are treated as DIFFERENT keys (a harmless miss)
 *      instead of risking a collision.
 *   2. Duplicate object keys are AMBIGUOUS (RFC 8259 §4 leaves last-wins
 *      undefined across parsers/intermediaries). We refuse to canonicalize such
 *      a body and let the caller fall back to opaque handling.
 *
 * What we DO normalize, because it is provably meaning-preserving:
 *   - insignificant whitespace (removed),
 *   - object key ordering (sorted by canonical key),
 *   - string escape sequences (`"A"` and `"A"` denote the same string).
 */

export class CanonicalJsonError extends Error {
  override readonly name = "CanonicalJsonError";
}

interface Parser {
  s: string;
  i: number;
}

const WS = new Set([" ", "\t", "\n", "\r"]);

function skipWs(p: Parser): void {
  while (p.i < p.s.length && WS.has(p.s[p.i]!)) p.i++;
}

function fail(p: Parser, msg: string): never {
  throw new CanonicalJsonError(`${msg} at position ${p.i}`);
}

/** Parse a JSON string token and return the canonical re-serialized form. */
function parseString(p: Parser): string {
  // p.i points at the opening quote.
  const start = p.i;
  p.i++; // consume opening quote
  while (p.i < p.s.length) {
    const c = p.s[p.i]!;
    if (c === "\\") {
      p.i += 2; // skip escape pair; validity is checked by JSON.parse below
      continue;
    }
    if (c === '"') {
      p.i++;
      const raw = p.s.slice(start, p.i);
      let value: string;
      try {
        value = JSON.parse(raw) as string;
      } catch {
        fail(p, "invalid string literal");
      }
      // Re-serialize to a single canonical escape form (meaning-preserving).
      return JSON.stringify(value);
    }
    p.i++;
  }
  return fail(p, "unterminated string");
}

/** Parse and preserve a numeric literal verbatim (no value round-trip). */
function parseNumber(p: Parser): string {
  const start = p.i;
  const re = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/y;
  re.lastIndex = p.i;
  const m = re.exec(p.s);
  if (!m || m.index !== p.i) fail(p, "invalid number");
  p.i += m[0].length;
  return p.s.slice(start, p.i);
}

function parseValue(p: Parser): string {
  skipWs(p);
  if (p.i >= p.s.length) fail(p, "unexpected end of input");
  const c = p.s[p.i]!;

  if (c === "{") return parseObject(p);
  if (c === "[") return parseArray(p);
  if (c === '"') return parseString(p);
  if (c === "-" || (c >= "0" && c <= "9")) return parseNumber(p);

  if (p.s.startsWith("true", p.i)) {
    p.i += 4;
    return "true";
  }
  if (p.s.startsWith("false", p.i)) {
    p.i += 5;
    return "false";
  }
  if (p.s.startsWith("null", p.i)) {
    p.i += 4;
    return "null";
  }
  return fail(p, `unexpected token '${c}'`);
}

function parseObject(p: Parser): string {
  p.i++; // consume '{'
  const members: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();
  skipWs(p);
  if (p.s[p.i] === "}") {
    p.i++;
    return "{}";
  }
  for (;;) {
    skipWs(p);
    if (p.s[p.i] !== '"') fail(p, "expected object key");
    const key = parseString(p);
    if (seen.has(key)) {
      // Ambiguous under RFC 8259 §4; refuse rather than risk a false hit.
      fail(p, "duplicate object key");
    }
    seen.add(key);
    skipWs(p);
    if (p.s[p.i] !== ":") fail(p, "expected ':'");
    p.i++;
    const value = parseValue(p);
    members.push({ key, value });
    skipWs(p);
    const next = p.s[p.i];
    if (next === ",") {
      p.i++;
      continue;
    }
    if (next === "}") {
      p.i++;
      break;
    }
    fail(p, "expected ',' or '}'");
  }
  // Sort by the canonical (already JSON-encoded) key for stable ordering.
  members.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return `{${members.map((m) => `${m.key}:${m.value}`).join(",")}}`;
}

function parseArray(p: Parser): string {
  p.i++; // consume '['
  const items: string[] = [];
  skipWs(p);
  if (p.s[p.i] === "]") {
    p.i++;
    return "[]";
  }
  for (;;) {
    const value = parseValue(p);
    items.push(value);
    skipWs(p);
    const next = p.s[p.i];
    if (next === ",") {
      p.i++;
      continue;
    }
    if (next === "]") {
      p.i++;
      break;
    }
    fail(p, "expected ',' or ']'");
  }
  return `[${items.join(",")}]`;
}

/**
 * Produce a canonical string for a JSON document. Throws CanonicalJsonError on
 * invalid JSON or on any construct we consider ambiguous (duplicate keys).
 * Array order and numeric literals are preserved exactly.
 */
export function canonicalizeJson(text: string): string {
  const p: Parser = { s: text, i: 0 };
  const out = parseValue(p);
  skipWs(p);
  if (p.i !== p.s.length) fail(p, "trailing content after JSON value");
  return out;
}
