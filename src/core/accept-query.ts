/**
 * `Accept-Query` negotiation helper.
 *
 * RFC 10008 §3: a resource advertises the query formats (media types) it
 * understands via the `Accept-Query` response header field, typically returned
 * on an OPTIONS response. Clients read it to choose a Content-Type for their
 * QUERY body. This helper builds and parses that header.
 *
 * We keep it a simple, comma-separated media-type list (optionally with `q`
 * weights on parse) to match how clients discover support in practice.
 */
import { parseMediaType } from "./media-type.js";

/**
 * Build an `Accept-Query` header value advertising the media types this
 * resource accepts as a QUERY body, e.g.
 *   advertiseAcceptQuery(["application/json", "application/sql"])
 *   // => "application/json, application/sql"
 */
export function advertiseAcceptQuery(mediaTypes: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of mediaTypes) {
    const mt = parseMediaType(raw);
    if (!mt) continue;
    if (seen.has(mt.essence)) continue;
    seen.add(mt.essence);
    out.push(mt.essence);
  }
  return out.join(", ");
}

export interface AcceptQueryEntry {
  mediaType: string;
  /** Quality weight from a `q=` parameter, defaulting to 1. */
  q: number;
}

/**
 * Parse an `Accept-Query` header value into an ordered (highest-q first) list.
 */
export function parseAcceptQuery(header: string | undefined | null): AcceptQueryEntry[] {
  if (!header) return [];
  const entries: AcceptQueryEntry[] = [];
  for (const part of header.split(",")) {
    const mt = parseMediaType(part);
    if (!mt) continue;
    const qRaw = mt.parameters["q"];
    let q = 1;
    if (qRaw != null) {
      const parsed = Number.parseFloat(qRaw);
      if (!Number.isNaN(parsed)) q = Math.min(1, Math.max(0, parsed));
    }
    entries.push({ mediaType: mt.essence, q });
  }
  // Stable sort by descending quality.
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.q - a.e.q || a.i - b.i)
    .map(({ e }) => e);
}

/**
 * Pick the best mutually-supported media type given a client's preferences and
 * the server's advertised list. Returns null when there is no overlap.
 */
export function negotiateQueryType(
  clientAcceptQuery: string | undefined | null,
  serverSupported: string[],
): string | null {
  const supported = new Set(
    serverSupported.map((s) => parseMediaType(s)?.essence).filter(Boolean) as string[],
  );
  if (supported.size === 0) return null;

  const prefs = parseAcceptQuery(clientAcceptQuery);
  if (prefs.length === 0) {
    // No client preference: offer the server's first advertised type.
    return parseMediaType(serverSupported[0] ?? "")?.essence ?? null;
  }
  for (const pref of prefs) {
    if (pref.q > 0 && supported.has(pref.mediaType)) return pref.mediaType;
  }
  return null;
}
