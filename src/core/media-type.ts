/**
 * Minimal, dependency-free media-type (Content-Type) parsing.
 *
 * RFC 10008 §2 requires a QUERY request that carries content to describe it
 * with a Content-Type. Correct body-aware caching hinges on interpreting that
 * type precisely, so we parse it here rather than string-matching downstream.
 *
 * @see RFC 9110 §8.3 (Content-Type), RFC 10008 §2
 */

export interface MediaType {
  /** Top-level type, lowercased. e.g. "application". */
  type: string;
  /** Subtype, lowercased, WITHOUT any structured suffix. e.g. "vnd.api". */
  subtype: string;
  /** Structured syntax suffix, lowercased, without the "+". e.g. "json". */
  suffix?: string;
  /** Lowercased "type/subtype" with suffix, e.g. "application/vnd.api+json". */
  essence: string;
  /** Parameters, keys lowercased. Values kept verbatim (case may matter). */
  parameters: Record<string, string>;
}

/**
 * Parse a Content-Type header value. Returns null when the header is absent or
 * cannot be parsed into a well-formed media type.
 */
export function parseMediaType(header: string | undefined | null): MediaType | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  const [rawEssence = "", ...paramParts] = trimmed.split(";");
  const essence = rawEssence.trim().toLowerCase();
  const slash = essence.indexOf("/");
  if (slash <= 0 || slash === essence.length - 1) return null;

  const type = essence.slice(0, slash);
  let subtypeFull = essence.slice(slash + 1);
  let suffix: string | undefined;
  const plus = subtypeFull.lastIndexOf("+");
  if (plus > 0 && plus < subtypeFull.length - 1) {
    suffix = subtypeFull.slice(plus + 1);
    subtypeFull = subtypeFull.slice(0, plus);
  }

  // Reject obviously malformed tokens (whitespace inside type/subtype).
  if (/\s/.test(type) || /\s/.test(subtypeFull)) return null;

  const parameters: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let value = part.slice(eq + 1).trim();
    // Strip surrounding quotes from quoted-string parameter values.
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (key) parameters[key] = value;
  }

  return { type, subtype: subtypeFull, suffix, essence, parameters };
}

/** True for JSON-family types: application/json or any `+json` suffix. */
export function isJsonMediaType(mt: MediaType): boolean {
  if (mt.suffix === "json") return true;
  return mt.type === "application" && mt.subtype === "json";
}

/** True for application/x-www-form-urlencoded. */
export function isFormUrlEncoded(mt: MediaType): boolean {
  return mt.type === "application" && mt.subtype === "x-www-form-urlencoded";
}
