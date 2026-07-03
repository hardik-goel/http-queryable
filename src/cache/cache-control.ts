/**
 * Minimal Cache-Control parsing for response storability decisions.
 * @see RFC 9111 §5.2 (Cache-Control)
 */

export interface CacheControl {
  noStore: boolean;
  noCache: boolean;
  private: boolean;
  public: boolean;
  noTransform: boolean;
  mustRevalidate: boolean;
  /** max-age in seconds, or undefined. */
  maxAge?: number;
  /** s-maxage in seconds (shared caches), or undefined. */
  sMaxAge?: number;
}

export function parseCacheControl(header: string | string[] | undefined): CacheControl {
  const value = Array.isArray(header) ? header.join(",") : (header ?? "");
  const cc: CacheControl = {
    noStore: false,
    noCache: false,
    private: false,
    public: false,
    noTransform: false,
    mustRevalidate: false,
  };
  for (const rawDirective of value.split(",")) {
    const directive = rawDirective.trim().toLowerCase();
    if (!directive) continue;
    const eq = directive.indexOf("=");
    const name = eq === -1 ? directive : directive.slice(0, eq);
    const arg = eq === -1 ? undefined : directive.slice(eq + 1).replace(/^"|"$/g, "");
    switch (name) {
      case "no-store":
        cc.noStore = true;
        break;
      case "no-cache":
        cc.noCache = true;
        break;
      case "private":
        cc.private = true;
        break;
      case "public":
        cc.public = true;
        break;
      case "no-transform":
        cc.noTransform = true;
        break;
      case "must-revalidate":
        cc.mustRevalidate = true;
        break;
      case "max-age": {
        const n = Number.parseInt(arg ?? "", 10);
        if (!Number.isNaN(n)) cc.maxAge = n;
        break;
      }
      case "s-maxage": {
        const n = Number.parseInt(arg ?? "", 10);
        if (!Number.isNaN(n)) cc.sMaxAge = n;
        break;
      }
    }
  }
  return cc;
}
