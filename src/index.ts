/**
 * http-queryable — QUERY endpoints + correct body-aware caching for Node.
 *
 * The new HTTP QUERY method (RFC 10008) is "GET with a body": safe, idempotent,
 * cacheable — but carrying a request body like POST. This is the framework-
 * agnostic core: request model, body canonicalization, the safe body-aware
 * cache key, the cache engine, and Accept-Query negotiation.
 *
 * Framework glue lives in subpath exports:
 *   - http-queryable/express
 *   - http-queryable/fastify
 *   - http-queryable/http
 *   - http-queryable/client
 */

// Runtime detection (Node >= 22 accepts QUERY at the parser level).
export {
  QUERY_METHOD,
  MIN_NODE_MAJOR,
  isQueryMethodSupported,
  assertQueryMethodSupported,
  currentNodeMajor,
  QueryMethodUnsupportedError,
} from "./runtime.js";

// Media type parsing.
export {
  parseMediaType,
  isJsonMediaType,
  isFormUrlEncoded,
  type MediaType,
} from "./core/media-type.js";

// Canonicalization + normalization (the moat).
export { canonicalizeJson, CanonicalJsonError } from "./core/canonical-json.js";
export {
  normalizeBody,
  type NormalizedBody,
  type NormalizationKind,
  type NormalizeOptions,
} from "./core/normalize.js";

// Safe body-aware cache key.
export { deriveCacheKey, type CacheKey, type CacheKeyInput } from "./core/cache-key.js";

// Request validation.
export {
  validateQueryRequest,
  QUERY_IS_SAFE,
  QUERY_IS_IDEMPOTENT,
  type QueryRequestParts,
  type QueryValidation,
} from "./core/request.js";

// Accept-Query negotiation.
export {
  advertiseAcceptQuery,
  parseAcceptQuery,
  negotiateQueryType,
  type AcceptQueryEntry,
} from "./core/accept-query.js";

// Caching layer.
export {
  QueryCache,
  type QueryCacheOptions,
  type RequestLike,
  type ResponseLike,
  type LookupResult,
} from "./cache/cache.js";
export {
  MemoryStore,
  type CacheStore,
  type CachedResponse,
  type MemoryStoreOptions,
} from "./cache/store.js";
export { parseCacheControl, type CacheControl } from "./cache/cache-control.js";
