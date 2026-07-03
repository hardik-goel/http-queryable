/**
 * Body canonicalization per Content-Type, for safe cache-key derivation.
 *
 * Conservative by design (see canonical-json.ts): we only normalize where the
 * transform is provably meaning-preserving. Anything we don't fully understand
 * is treated as OPAQUE — its raw bytes become the key material and, by default,
 * it is not cached at all (a caller may opt in to exact-byte caching).
 *
 * @see RFC 10008 §2.7 (Caching), and its Security Considerations.
 */
import { Buffer } from "node:buffer";
import { parseMediaType, isJsonMediaType, isFormUrlEncoded, type MediaType } from "./media-type.js";
import { canonicalizeJson } from "./canonical-json.js";

/** How the body was treated when deriving key material. */
export type NormalizationKind =
  | "json" // semantically canonicalized JSON
  | "form" // canonicalized x-www-form-urlencoded
  | "empty" // no body
  | "opaque"; // raw bytes, no semantic normalization

export interface NormalizedBody {
  /** Bytes that uniquely and safely identify this body for cache keying. */
  keyMaterial: Buffer;
  /** How the body was handled. */
  kind: NormalizationKind;
  /** Canonical essence media type ("type/subtype[+suffix]"), or null. */
  mediaType: string | null;
  /** Whether semantic (meaning-preserving) normalization was applied. */
  normalized: boolean;
  /**
   * Whether this body is safe to cache under the DEFAULT policy. Opaque bodies
   * are not cacheable by default because we cannot reason about their meaning;
   * a caller may still opt in via `cacheOpaqueBodies`.
   */
  cacheable: boolean;
  /** Human-readable explanation when not normalized or not cacheable. */
  reason?: string;
}

export interface NormalizeOptions {
  /**
   * When true, opaque (unrecognized) bodies are cacheable using EXACT bytes as
   * the key. This is still collision-safe (byte-identical only), but off by
   * default because intermediaries may normalize unknown types differently.
   */
  cacheOpaqueBodies?: boolean;
  /**
   * Extra media types (essence, lowercased) to treat as JSON. Useful for niche
   * `application/*+json`-adjacent types not caught by the `+json` suffix rule.
   */
  extraJsonTypes?: string[];
}

function toBuffer(body: Buffer | string): Buffer {
  return typeof body === "string" ? Buffer.from(body, "utf8") : body;
}

function opaque(
  bytes: Buffer,
  mediaType: string | null,
  reason: string,
  cacheable: boolean,
): NormalizedBody {
  return {
    keyMaterial: bytes,
    kind: "opaque",
    mediaType,
    normalized: false,
    cacheable,
    reason,
  };
}

/**
 * Normalize a request body given its Content-Type header.
 *
 * Never throws for malformed bodies: an unparseable JSON/form body degrades to
 * opaque handling (raw bytes, not cacheable by default) so a caching layer can
 * safely fall through to origin. Request-level validation (whether to reject a
 * malformed body with 4xx) is a separate concern handled in request.ts.
 */
export function normalizeBody(
  body: Buffer | string | undefined | null,
  contentType: string | undefined | null,
  options: NormalizeOptions = {},
): NormalizedBody {
  const bytes = body == null ? Buffer.alloc(0) : toBuffer(body);

  if (bytes.length === 0) {
    return {
      keyMaterial: bytes,
      kind: "empty",
      mediaType: parseMediaType(contentType)?.essence ?? null,
      normalized: true,
      cacheable: true,
    };
  }

  const mt: MediaType | null = parseMediaType(contentType);
  const cacheOpaque = options.cacheOpaqueBodies ?? false;

  if (!mt) {
    // RFC 10008 §2: content without a usable Content-Type cannot be interpreted.
    return opaque(bytes, null, "missing or unparseable Content-Type", cacheOpaque);
  }

  const essence = mt.essence;
  const treatAsJson = isJsonMediaType(mt) || (options.extraJsonTypes?.includes(essence) ?? false);

  if (treatAsJson) {
    try {
      const canonical = canonicalizeJson(bytes.toString("utf8"));
      return {
        keyMaterial: Buffer.from(canonical, "utf8"),
        kind: "json",
        mediaType: essence,
        normalized: true,
        cacheable: true,
      };
    } catch (err) {
      // Invalid or ambiguous (e.g. duplicate keys) JSON: refuse to normalize.
      return opaque(
        bytes,
        essence,
        `JSON not safely canonicalizable: ${(err as Error).message}`,
        cacheOpaque,
      );
    }
  }

  if (isFormUrlEncoded(mt)) {
    try {
      // URLSearchParams normalizes percent-encoding case and +/%20 while
      // PRESERVING pair order and duplicates — meaning-preserving and safe.
      const canonical = new URLSearchParams(bytes.toString("utf8")).toString();
      return {
        keyMaterial: Buffer.from(canonical, "utf8"),
        kind: "form",
        mediaType: essence,
        normalized: true,
        cacheable: true,
      };
    } catch (err) {
      return opaque(
        bytes,
        essence,
        `form body not canonicalizable: ${(err as Error).message}`,
        cacheOpaque,
      );
    }
  }

  // Unknown type (text/plain, XML, octet-stream, ...): opaque, exact bytes.
  return opaque(
    bytes,
    essence,
    `content type '${essence}' is not semantically normalized`,
    cacheOpaque,
  );
}
