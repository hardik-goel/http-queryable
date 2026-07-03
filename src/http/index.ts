/**
 * Raw Node `http.Server` adapter (thin).
 *
 * Proves the caching core is framework-agnostic: no Express, no Fastify — just
 * `IncomingMessage`/`ServerResponse`. Handy for tiny services, custom servers,
 * or as the reference for adapting any other framework.
 *
 * @see RFC 10008 (QUERY)
 */
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { assertQueryMethodSupported, QUERY_METHOD } from "../runtime.js";
import { parseMediaType, isJsonMediaType, isFormUrlEncoded } from "../core/media-type.js";
import { advertiseAcceptQuery } from "../core/accept-query.js";
import { QueryCache, type QueryCacheOptions } from "../cache/cache.js";

export interface QueryContext {
  /** Raw request body bytes. */
  raw: Buffer;
  /** Parsed body (object for JSON/form, Buffer for opaque, undefined if empty). */
  body: unknown;
  /** Canonical essence Content-Type, or null. */
  contentType: string | null;
  /** Advertise supported query media types via Accept-Query. */
  acceptQuery(mediaTypes: string[]): void;
  /** Set Content-Location for the canonical result (RFC 9110 §10.2.2). */
  contentLocation(url: string): void;
}

export type QueryHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: QueryContext,
) => void | Promise<void>;

export interface RawQueryOptions {
  /** Caching: a QueryCache, options to build one, or false to disable. */
  cache?: QueryCache | QueryCacheOptions | false;
  /** Max body size in bytes. Default 1 MiB. */
  bodyLimit?: number;
  /** Handler for non-QUERY requests. Default: respond 405. */
  onOtherMethod?: (req: IncomingMessage, res: ServerResponse) => void;
}

const DEFAULT_BODY_LIMIT = 1024 * 1024;

function resolveCache(cache: RawQueryOptions["cache"]): QueryCache | null {
  if (cache === false) return null;
  if (cache instanceof QueryCache) return cache;
  return new QueryCache({ defaultTtlMs: 60_000, ...(cache ?? {}) });
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("query_body_too_large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseBody(raw: Buffer, contentType: string | undefined): unknown {
  const mt = parseMediaType(contentType);
  if (raw.length === 0 || !mt) return raw.length === 0 ? undefined : raw;
  const text = raw.toString("utf8");
  if (isJsonMediaType(mt)) return text.length ? JSON.parse(text) : undefined;
  if (isFormUrlEncoded(mt)) return Object.fromEntries(new URLSearchParams(text));
  return raw;
}

/**
 * Build an `http.Server` request listener that handles QUERY with body-aware
 * caching. Compose it into your own server, or use `createQueryServer`.
 */
export function createQueryListener(
  handler: QueryHandler,
  options: RawQueryOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  assertQueryMethodSupported();
  const limit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const cache = resolveCache(options.cache);

  return (req, res) => {
    void handleRequest(req, res).catch((err) => {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      if (!res.headersSent) {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: (err as Error).message ?? "internal_error" }));
      } else {
        res.end();
      }
    });

    async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (req.method !== QUERY_METHOD) {
        if (options.onOtherMethod) return options.onOtherMethod(req, res);
        res.statusCode = 405;
        res.setHeader("allow", `${QUERY_METHOD}, GET`);
        res.end();
        return;
      }

      const raw = await readBody(req, limit);
      const contentTypeHeader = req.headers["content-type"];
      let parsed: unknown;
      try {
        parsed = parseBody(raw, contentTypeHeader);
      } catch {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "invalid_query_body" }));
        return;
      }

      const reqLike = {
        method: req.method,
        url: req.url ?? "/",
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: raw,
      };

      const ctx: QueryContext = {
        raw,
        body: parsed,
        contentType: parseMediaType(contentTypeHeader)?.essence ?? null,
        acceptQuery: (types) => res.setHeader("Accept-Query", advertiseAcceptQuery(types)),
        contentLocation: (url) => res.setHeader("Content-Location", url),
      };

      if (cache) {
        const result = await cache.lookup(reqLike);
        if (result.status === "hit") {
          for (const [k, v] of Object.entries(result.response.headers)) {
            if (k.toLowerCase() === "x-query-cache") continue;
            res.setHeader(k, v);
          }
          res.setHeader("X-Query-Cache", "HIT");
          res.statusCode = result.response.status;
          res.end(result.response.body);
          return;
        }
        if (result.status === "not-modified") {
          res.setHeader("X-Query-Cache", "HIT");
          if (result.etag) res.setHeader("ETag", result.etag);
          res.statusCode = 304;
          res.end();
          return;
        }
        res.setHeader("X-Query-Cache", result.status === "uncacheable" ? "BYPASS" : "MISS");
        if (result.status === "miss") interceptAndStore(res, cache, reqLike);
      }

      await handler(req, res, ctx);
    }
  };
}

function interceptAndStore(
  res: ServerResponse,
  cache: QueryCache,
  reqLike: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  },
): void {
  const chunks: Buffer[] = [];
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  res.write = function (chunk: any, ...args: any[]): boolean {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return (origWrite as any)(chunk, ...args);
  };
  res.end = function (chunk?: any, ...args: any[]): ServerResponse {
    if (chunk && typeof chunk !== "function") {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const headers = res.getHeaders() as Record<string, string | string[]>;
    void cache
      .store(reqLike, { status: res.statusCode, headers, body: Buffer.concat(chunks) })
      .catch(() => {});
    return (origEnd as any)(chunk, ...args);
  } as ServerResponse["end"];
}

/** Convenience: a ready-to-listen `http.Server` for a single QUERY handler. */
export function createQueryServer(
  handler: QueryHandler,
  options: RawQueryOptions = {},
): http.Server {
  return http.createServer(createQueryListener(handler, options));
}

export { QueryCache } from "../cache/cache.js";
