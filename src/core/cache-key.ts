/**
 * Safe cache-key derivation for QUERY requests.
 *
 * RFC 10008 §2.7: "the request content is part of the cache key". A cache that
 * keys only on method + URL (as shared HTTP caches historically do) can serve
 * the response for one body to a request with a DIFFERENT body at the same URL.
 * This module builds a key that incorporates the NORMALIZED body so that:
 *
 *   - semantically-equal bodies map to the same key (a cache hit is correct),
 *   - semantically-different bodies map to different keys (no false hit).
 *
 * The key material is domain-separated with length prefixes so that no
 * concatenation of (url, media type, body) can be forged to collide with a
 * different tuple. We hash with SHA-256 for a fixed-size, collision-resistant
 * key; the pre-image is also returned for auditing/debugging.
 *
 * @see RFC 10008 §2.7 (Caching) and Security Considerations.
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { normalizeBody, type NormalizeOptions, type NormalizedBody } from "./normalize.js";
import { QUERY_METHOD } from "../runtime.js";

export interface CacheKeyInput {
  /** HTTP method. Defaults to QUERY; included so keys never cross methods. */
  method?: string;
  /**
   * Request target used for keying. Pass the path + search string (e.g.
   * "/search?lang=en"). Kept EXACT by default: reordering query params is not
   * assumed meaning-preserving (that would risk a false hit).
   */
  url: string;
  /** Raw request body bytes/string. */
  body?: Buffer | string | null;
  /** Content-Type header value. */
  contentType?: string | null;
  /**
   * Additional header values to fold into the key (the effect of `Vary`).
   * Provide as [name, value] pairs; names are lowercased and sorted.
   */
  varyHeaders?: Array<[string, string]>;
}

export interface CacheKey {
  /** Hex SHA-256 digest — the value to use as the store key. */
  key: string;
  /** How the body was normalized (surface for diagnostics/policy). */
  normalization: NormalizedBody;
  /** Whether the request is cacheable under the current policy. */
  cacheable: boolean;
}

const SEP = Buffer.from([0x00]);

function segment(label: string, value: Buffer | string): Buffer {
  const v = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  const l = Buffer.from(label, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(v.length, 0);
  // label \0 length(4) value \0  — length-prefixed to prevent boundary forgery.
  return Buffer.concat([l, SEP, len, v, SEP]);
}

/**
 * Derive a body-aware cache key. Deterministic and framework-agnostic.
 */
export function deriveCacheKey(input: CacheKeyInput, options: NormalizeOptions = {}): CacheKey {
  const method = (input.method ?? QUERY_METHOD).toUpperCase();
  const normalization = normalizeBody(input.body, input.contentType, options);

  const parts: Buffer[] = [
    segment("method", method),
    segment("url", input.url),
    segment("ctype", normalization.mediaType ?? ""),
    segment("kind", normalization.kind),
    segment("body", normalization.keyMaterial),
  ];

  if (input.varyHeaders && input.varyHeaders.length > 0) {
    const sorted = [...input.varyHeaders]
      .map(([n, v]) => [n.toLowerCase(), v] as [string, string])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [n, v] of sorted) parts.push(segment(`vary:${n}`, v));
  }

  const hash = createHash("sha256").update(Buffer.concat(parts)).digest("hex");

  return {
    key: hash,
    normalization,
    cacheable: normalization.cacheable,
  };
}
