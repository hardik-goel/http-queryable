/**
 * Pluggable cache store interface + a default in-memory implementation.
 *
 * Scope (v0.1): ship a correct in-memory store and a small interface so users
 * can back the cache with Redis/Memcached/etc. We deliberately do NOT ship a
 * cache-backend empire — the value is the body-aware KEY (see core/cache-key),
 * not the storage.
 */
import { Buffer } from "node:buffer";

export interface CachedResponse {
  status: number;
  /** Response headers to replay. Values may be arrays (e.g. Set-Cookie). */
  headers: Record<string, string | string[]>;
  body: Buffer;
  /** Entity tag (unquoted or quoted as received), if any. */
  etag?: string;
  /** Epoch ms when stored. */
  storedAt: number;
  /** Epoch ms after which the entry is stale; undefined => no TTL. */
  expiresAt?: number;
}

export interface CacheStore {
  get(key: string): Promise<CachedResponse | undefined> | CachedResponse | undefined;
  set(key: string, value: CachedResponse): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  clear(): Promise<void> | void;
}

export interface MemoryStoreOptions {
  /** Maximum number of entries before least-recently-used eviction. */
  maxEntries?: number;
  /** Injectable clock (epoch ms) for deterministic testing. */
  now?: () => number;
}

/**
 * Bounded in-memory LRU store. Expired entries are dropped lazily on read.
 * Not shared across processes — for multi-instance deployments, plug in a
 * shared CacheStore implementation.
 */
export class MemoryStore implements CacheStore {
  private readonly map = new Map<string, CachedResponse>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: MemoryStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.now = options.now ?? Date.now;
  }

  get(key: string): CachedResponse | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt != null && entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // LRU touch: re-insert to mark most-recently-used.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(key: string, value: CachedResponse): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** Current entry count (diagnostics/tests). */
  get size(): number {
    return this.map.size;
  }
}
