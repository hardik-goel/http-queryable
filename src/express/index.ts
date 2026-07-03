/**
 * Express integration for the HTTP QUERY method.
 *
 * Context: on Express 5 + Node >= 22, `app.query(path, handler)` already routes
 * QUERY natively (Express registers a router method for every entry in Node's
 * `http.METHODS`, which now includes QUERY). What Express does NOT give you is
 * the surrounding machinery that makes QUERY actually usable and SAFE:
 *
 *   - raw-body capture + typed parsing suited to QUERY bodies,
 *   - correct body-aware caching (the moat — see cache/cache.ts),
 *   - CORS preflight handling (QUERY is not a CORS-safelisted method),
 *   - `Accept-Query` / `Content-Location` response helpers,
 *   - a clear failure on runtimes that can't accept QUERY,
 *   - a polyfill of `app.query` for older Express (4.x).
 *
 * `queryable()` returns a single middleware you mount once; the rest are small
 * helpers. All are framework-thin: the real logic lives in core/ and cache/.
 *
 * @see RFC 10008 (QUERY), RFC 9110 §10.2.2 (Content-Location), Fetch (CORS).
 */
import { Buffer } from "node:buffer";
import type { Application, Request, Response, NextFunction, RequestHandler } from "express";
import { assertQueryMethodSupported, QUERY_METHOD } from "../runtime.js";
import { parseMediaType, isJsonMediaType, isFormUrlEncoded } from "../core/media-type.js";
import { validateQueryRequest } from "../core/request.js";
import { advertiseAcceptQuery } from "../core/accept-query.js";
import { QueryCache, type QueryCacheOptions } from "../cache/cache.js";

// Augment Express's Request so `req.rawBody` is typed for consumers.
declare module "express-serve-static-core" {
  interface Request {
    /** Raw QUERY request body bytes, captured before parsing (for cache keys). */
    rawBody?: Buffer;
  }
}

export interface CorsOptions {
  /** Allowed origin(s). `true`/"*" reflects any origin. Default: disabled. */
  origin?: string | string[] | boolean;
  /** Additional allowed request headers. Content-Type is always included. */
  allowHeaders?: string[];
  /** Whether to allow credentials. Default false. */
  credentials?: boolean;
  /** Preflight cache duration in seconds. Default 600. */
  maxAge?: number;
}

export interface QueryableOptions {
  /**
   * Caching: pass a QueryCache, options to build one, or false to disable.
   * Default: a shared in-memory cache with a 60s default TTL.
   */
  cache?: QueryCache | QueryCacheOptions | false;
  /** Max QUERY body size in bytes. Default 1 MiB. */
  bodyLimit?: number;
  /** CORS handling for cross-origin QUERY. Default: disabled. */
  cors?: CorsOptions | false;
  /**
   * Content types (essence) to parse as JSON beyond application/json & +json.
   */
  extraJsonTypes?: string[];
}

const DEFAULT_BODY_LIMIT = 1024 * 1024;

function getHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function resolveCache(cache: QueryableOptions["cache"]): QueryCache | null {
  if (cache === false) return null;
  if (cache instanceof QueryCache) return cache;
  return new QueryCache({ defaultTtlMs: 60_000, ...(cache ?? {}) });
}

/**
 * Read the raw QUERY body (once), storing it on `req.rawBody`, then parse it
 * into `req.body` according to Content-Type. Non-QUERY requests pass through.
 */
function captureBody(limit: number, extraJsonTypes: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== QUERY_METHOD) return next();
    if (req.rawBody !== undefined) return next(); // already captured

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        res.status(413).json({ error: "query_body_too_large", limit });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks);
      req.rawBody = raw;
      const mt = parseMediaType(getHeader(req, "content-type"));
      if (raw.length === 0 || !mt) {
        req.body = raw.length === 0 ? undefined : raw;
        return next();
      }
      const text = raw.toString("utf8");
      try {
        if (isJsonMediaType(mt) || extraJsonTypes.includes(mt.essence)) {
          req.body = text.length ? JSON.parse(text) : undefined;
        } else if (isFormUrlEncoded(mt)) {
          req.body = Object.fromEntries(new URLSearchParams(text));
        } else {
          req.body = raw; // opaque: hand back bytes
        }
      } catch {
        // Malformed body vs declared type: 400, don't guess.
        res.status(400).json({ error: "invalid_query_body", contentType: mt.essence });
        return;
      }
      next();
    });

    req.on("error", next);
  };
}

function handlePreflight(cors: CorsOptions): RequestHandler {
  const maxAge = cors.maxAge ?? 600;
  const allowHeaders = ["Content-Type", "Accept-Query", ...(cors.allowHeaders ?? [])];
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "OPTIONS") return next();
    const requestMethod = getHeader(req, "access-control-request-method");
    if (requestMethod !== QUERY_METHOD) return next();

    // QUERY is NOT in the Fetch CORS-safelisted method set, so browsers send a
    // preflight before any cross-origin QUERY. Answer it explicitly.
    applyCorsHeaders(req, res, cors);
    res.setHeader("Access-Control-Allow-Methods", `${QUERY_METHOD}, GET, OPTIONS`);
    res.setHeader("Access-Control-Allow-Headers", allowHeaders.join(", "));
    res.setHeader("Access-Control-Max-Age", String(maxAge));
    res.status(204).end();
  };
}

function applyCorsHeaders(req: Request, res: Response, cors: CorsOptions): void {
  const origin = cors.origin ?? false;
  const reqOrigin = getHeader(req, "origin");
  if (origin === true || origin === "*") {
    res.setHeader("Access-Control-Allow-Origin", cors.credentials ? (reqOrigin ?? "*") : "*");
    if (cors.credentials) res.setHeader("Vary", "Origin");
  } else if (typeof origin === "string") {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (Array.isArray(origin) && reqOrigin && origin.includes(reqOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", reqOrigin);
    res.setHeader("Vary", "Origin");
  }
  if (cors.credentials) res.setHeader("Access-Control-Allow-Credentials", "true");
}

/** Buffer the response so a QUERY response can be stored in the cache. */
function cacheMiddleware(cache: QueryCache): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== QUERY_METHOD) return next();

    const bodyBytes = (): Buffer => {
      if (req.rawBody !== undefined) return req.rawBody;
      if (req.body == null) return Buffer.alloc(0);
      if (Buffer.isBuffer(req.body)) return req.body;
      if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
      return Buffer.from(JSON.stringify(req.body), "utf8");
    };

    const reqLike = {
      method: req.method,
      url: req.originalUrl || req.url,
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: bodyBytes(),
    };

    void cache
      .lookup(reqLike)
      .then((result) => {
        if (result.status === "hit") {
          for (const [k, v] of Object.entries(result.response.headers)) {
            if (k.toLowerCase() === "x-query-cache") continue;
            res.setHeader(k, v);
          }
          res.setHeader("X-Query-Cache", "HIT"); // set last so it always wins
          res.status(result.response.status).end(result.response.body);
          return;
        }
        if (result.status === "not-modified") {
          res.setHeader("X-Query-Cache", "HIT");
          if (result.etag) res.setHeader("ETag", result.etag);
          res.status(304).end();
          return;
        }
        res.setHeader("X-Query-Cache", result.status === "uncacheable" ? "BYPASS" : "MISS");
        interceptResponse(req, res, cache, reqLike, result.status === "miss");
        next();
      })
      .catch(next);
  };
}

/** Wrap res.end/res.write to capture the outgoing body for storage. */
function interceptResponse(
  req: Request,
  res: Response,
  cache: QueryCache,
  reqLike: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  },
  storable: boolean,
): void {
  if (!storable) return;
  const chunks: Buffer[] = [];
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  res.write = function (chunk: any, ...args: any[]): boolean {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return (origWrite as any)(chunk, ...args);
  };

  res.end = function (chunk?: any, ...args: any[]): Response {
    if (chunk && typeof chunk !== "function") {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    const headers = res.getHeaders() as Record<string, string | string[]>;
    // Fire-and-forget store; never block the response on caching.
    void cache.store(reqLike, { status: res.statusCode, headers, body }).catch(() => {});
    return (origEnd as any)(chunk, ...args);
  } as Response["end"];
}

/**
 * The one middleware to mount for QUERY support: runtime check, body capture,
 * optional CORS preflight, and body-aware caching.
 *
 * @example
 * app.use(queryable());
 * app.query("/search", (req, res) => res.json(search(req.body)));
 */
export function queryable(options: QueryableOptions = {}): RequestHandler {
  assertQueryMethodSupported();
  const limit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const extraJson = options.extraJsonTypes ?? [];
  const cache = resolveCache(options.cache);
  const cors = options.cors ? options.cors : undefined;

  const capture = captureBody(limit, extraJson);
  const preflight = cors ? handlePreflight(cors) : undefined;
  const caching = cache ? cacheMiddleware(cache) : undefined;

  const stack: RequestHandler[] = [];
  if (preflight) stack.push(preflight);
  stack.push(capture);
  if (cors) {
    stack.push((req, res, next) => {
      if (req.method === QUERY_METHOD) applyCorsHeaders(req, res, cors);
      next();
    });
  }
  if (caching) stack.push(caching);

  // Compose the stack into a single RequestHandler for a clean app.use().
  return (req: Request, res: Response, next: NextFunction) => {
    let i = 0;
    const run = (err?: unknown): void => {
      if (err) return next(err);
      const handler = stack[i++];
      if (!handler) return next();
      handler(req, res, run);
    };
    run();
  };
}

/**
 * Polyfill `app.query()` for Express versions whose router does not expose it.
 * On Express 5 + Node >= 22 this is a no-op (the method already routes QUERY).
 */
export function ensureQueryMethod(app: Application): void {
  assertQueryMethodSupported();
  if (typeof (app as any).query === "function") return;
  (app as any).query = function (path: string, ...handlers: RequestHandler[]) {
    // Fallback: match QUERY + path via a guarded middleware.
    app.use(path, (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== QUERY_METHOD) return next();
      let i = 0;
      const run = (err?: unknown): void => {
        if (err) return next(err);
        const h = handlers[i++];
        if (!h) return next();
        h(req, res, run);
      };
      run();
    });
    return app;
  };
}

/** Set an `Accept-Query` header advertising supported query media types. */
export function sendAcceptQuery(res: Response, mediaTypes: string[]): void {
  res.setHeader("Accept-Query", advertiseAcceptQuery(mediaTypes));
}

/**
 * Point clients at the canonical GET URL for a QUERY result.
 * RFC 9110 §10.2.2: `Content-Location` names the result representation, letting
 * a client re-`GET` (and share/cache) it.
 */
export function contentLocation(res: Response, url: string): void {
  res.setHeader("Content-Location", url);
}

/**
 * Validate a QUERY request in a handler; returns true if a response was sent
 * (i.e. the caller should stop). Thin wrapper over the core validator.
 */
export function rejectInvalidQuery(req: Request, res: Response): boolean {
  const v = validateQueryRequest({
    method: req.method,
    url: req.url,
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: req.rawBody ?? null,
  });
  if (v.ok) return false;
  res.status(v.status).json({ error: v.code, message: v.message });
  return true;
}

export { QueryCache } from "../cache/cache.js";
