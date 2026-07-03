/**
 * Framework-agnostic, body-aware response cache for QUERY.
 *
 * This is the headline value of the package. It combines:
 *   - the safe body-aware cache key (core/cache-key: RFC 10008 §2.7), so a
 *     different request body can NEVER be served another body's response;
 *   - RFC 9111 storability rules (no-store/private/max-age);
 *   - conditional requests via ETag / If-None-Match (RFC 9110 §13).
 *
 * It is intentionally transport-neutral: adapters (Express/Fastify/http) map
 * their request/response objects onto `lookup()` and `store()`.
 */
import { Buffer } from "node:buffer";
import { deriveCacheKey, type CacheKeyInput } from "../core/cache-key.js";
import { parseCacheControl } from "./cache-control.js";
import { MemoryStore, type CacheStore, type CachedResponse } from "./store.js";

export interface QueryCacheOptions {
  /** Backing store. Defaults to a bounded in-memory LRU. */
  store?: CacheStore;
  /** Fallback TTL (ms) when the response has no max-age. Default 0 = no TTL. */
  defaultTtlMs?: number;
  /** Allow caching bodies of unrecognized content types by EXACT bytes. */
  cacheOpaqueBodies?: boolean;
  /** Header names whose values must match for a hit (like `Vary`). */
  varyHeaders?: string[];
  /** Do not cache responses whose body exceeds this many bytes. */
  maxBodyBytes?: number;
  /**
   * Treat `Cache-Control: private` responses as storable. Default false: a
   * private response is not stored, matching shared-cache semantics.
   */
  cachePrivate?: boolean;
  /** Injectable clock (epoch ms) for deterministic testing. */
  now?: () => number;
}

export interface RequestLike {
  method?: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Buffer | string | null;
}

export interface ResponseLike {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer | string;
}

export type LookupResult =
  | { status: "hit"; key: string; response: CachedResponse }
  | { status: "not-modified"; key: string; etag: string }
  | { status: "miss"; key: string; cacheable: boolean }
  | { status: "uncacheable"; key: string; reason: string };

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

function normalizeEtag(tag: string): string {
  // Strip weak indicator and surrounding quotes for comparison.
  return tag.replace(/^W\//i, "").replace(/^"|"$/g, "").trim();
}

function ifNoneMatchContains(header: string | undefined, etag: string): boolean {
  if (!header || !etag) return false;
  if (header.trim() === "*") return true;
  const target = normalizeEtag(etag);
  return header
    .split(",")
    .map((t) => normalizeEtag(t))
    .some((t) => t === target);
}

export class QueryCache {
  private readonly backend: CacheStore;
  private readonly opts: Required<Omit<QueryCacheOptions, "store">>;

  constructor(options: QueryCacheOptions = {}) {
    const now = options.now ?? Date.now;
    this.backend = options.store ?? new MemoryStore({ now });
    this.opts = {
      defaultTtlMs: options.defaultTtlMs ?? 0,
      cacheOpaqueBodies: options.cacheOpaqueBodies ?? false,
      varyHeaders: (options.varyHeaders ?? []).map((h) => h.toLowerCase()),
      maxBodyBytes: options.maxBodyBytes ?? 5 * 1024 * 1024,
      cachePrivate: options.cachePrivate ?? false,
      now,
    };
  }

  /** Compute the body-aware cache key for a request. */
  keyFor(req: RequestLike): string {
    return this.buildKey(req).key;
  }

  private buildKey(req: RequestLike) {
    const varyHeaders: Array<[string, string]> = [];
    for (const name of this.opts.varyHeaders) {
      const val = headerValue(req.headers, name);
      if (val != null) varyHeaders.push([name, val]);
    }
    const input: CacheKeyInput = {
      method: req.method,
      url: req.url,
      body: req.body ?? null,
      contentType: headerValue(req.headers, "content-type") ?? null,
      varyHeaders,
    };
    return deriveCacheKey(input, {
      cacheOpaqueBodies: this.opts.cacheOpaqueBodies,
    });
  }

  /**
   * Look up a request. On a fresh hit, returns the stored response (or a
   * not-modified result if the client's If-None-Match matches). On a miss for a
   * cacheable request, the caller should run the handler and call `store()`.
   */
  async lookup(req: RequestLike): Promise<LookupResult> {
    const derived = this.buildKey(req);
    const key = derived.key;

    if (!derived.cacheable) {
      // SAFETY: a body we cannot reason about is never cached, so it can never
      // be served for a different body. (RFC 10008 Security Considerations.)
      return { status: "uncacheable", key, reason: derived.normalization.reason ?? "opaque body" };
    }

    const entry = await this.backend.get(key);
    if (!entry) return { status: "miss", key, cacheable: true };

    if (entry.expiresAt != null && entry.expiresAt <= this.opts.now()) {
      await this.backend.delete(key);
      return { status: "miss", key, cacheable: true };
    }

    const inm = headerValue(req.headers, "if-none-match");
    if (entry.etag && ifNoneMatchContains(inm, entry.etag)) {
      return { status: "not-modified", key, etag: entry.etag };
    }

    return { status: "hit", key, response: entry };
  }

  /**
   * Store a handler's response for a request, honoring Cache-Control. Returns
   * true if stored. Safe to call unconditionally after a miss.
   */
  async store(req: RequestLike, res: ResponseLike): Promise<boolean> {
    const derived = this.buildKey(req);
    if (!derived.cacheable) return false;

    // Only cache successful, cacheable-by-status responses.
    if (!isCacheableStatus(res.status)) return false;

    const cc = parseCacheControl(res.headers["cache-control"] ?? res.headers["Cache-Control"]);
    if (cc.noStore) return false;
    if (cc.private && !this.opts.cachePrivate) return false;

    const body = typeof res.body === "string" ? Buffer.from(res.body, "utf8") : res.body;
    if (body.length > this.opts.maxBodyBytes) return false;

    const now = this.opts.now();
    // Shared-cache TTL preference: s-maxage > max-age > configured default.
    const maxAgeSec = cc.sMaxAge ?? cc.maxAge;
    let expiresAt: number | undefined;
    if (maxAgeSec != null) {
      if (maxAgeSec <= 0) return false; // max-age=0 => must revalidate; don't serve stale
      expiresAt = now + maxAgeSec * 1000;
    } else if (this.opts.defaultTtlMs > 0) {
      expiresAt = now + this.opts.defaultTtlMs;
    }

    const etagHeader = res.headers["etag"] ?? res.headers["ETag"];
    const etag = Array.isArray(etagHeader) ? etagHeader[0] : etagHeader;

    const record: CachedResponse = {
      status: res.status,
      headers: { ...res.headers },
      body,
      etag: etag || undefined,
      storedAt: now,
      expiresAt,
    };
    await this.backend.set(derived.key, record);
    return true;
  }

  /** Remove a cached entry for a request (e.g. after a mutation elsewhere). */
  async invalidate(req: RequestLike): Promise<void> {
    await this.backend.delete(this.buildKey(req).key);
  }
}

/** RFC 9111 §3: only certain status codes are cacheable by default. */
function isCacheableStatus(status: number): boolean {
  return (
    status === 200 ||
    status === 203 ||
    status === 204 ||
    status === 206 ||
    status === 300 ||
    status === 301 ||
    status === 404 ||
    status === 410
  );
}
