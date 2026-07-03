/**
 * Fastify adapter (thin) for the HTTP QUERY method.
 *
 * Secondary to the Express integration: its only job is to reuse the SAME core
 * (core/*) and caching layer (cache/*) so body-aware caching is available to
 * Fastify apps too. A basic Fastify `app.query(...)` router already exists in
 * the ecosystem; the value here is correct caching + the shared helpers.
 *
 * Fastify >= 5 exposes `addHttpMethod`, which is how we teach Fastify to route
 * QUERY. We register raw-preserving content-type parsers so the cache key is
 * derived from the exact request bytes (see cache/cache-key.ts).
 *
 * @see RFC 10008 (QUERY)
 */
import { Buffer } from "node:buffer";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import { assertQueryMethodSupported, QUERY_METHOD } from "../runtime.js";
import { advertiseAcceptQuery } from "../core/accept-query.js";
import { QueryCache, type QueryCacheOptions } from "../cache/cache.js";

declare module "fastify" {
  interface FastifyRequest {
    rawQueryBody?: Buffer;
  }
  interface FastifyReply {
    acceptQuery(mediaTypes: string[]): FastifyReply;
    contentLocation(url: string): FastifyReply;
  }
}

export interface FastifyQueryableOptions {
  /** Caching: a QueryCache, options to build one, or false to disable. */
  cache?: QueryCache | QueryCacheOptions | false;
  /** Content types (essence) to register raw parsers for. */
  contentTypes?: string[];
}

const DEFAULT_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "text/plain",
];

function resolveCache(cache: FastifyQueryableOptions["cache"]): QueryCache | null {
  if (cache === false) return null;
  if (cache instanceof QueryCache) return cache;
  return new QueryCache({ defaultTtlMs: 60_000, ...(cache ?? {}) });
}

function reqBodyBytes(req: FastifyRequest): Buffer {
  if (req.rawQueryBody) return req.rawQueryBody;
  const body = req.body;
  if (body == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  return Buffer.from(JSON.stringify(body), "utf8");
}

const pluginImpl: FastifyPluginCallback<FastifyQueryableOptions> = (fastify, options, done) => {
  assertQueryMethodSupported();

  if (
    typeof (fastify as FastifyInstance & { addHttpMethod?: unknown }).addHttpMethod !== "function"
  ) {
    done(
      new Error(
        "This Fastify version does not support custom HTTP methods (addHttpMethod). Upgrade to Fastify >= 5 to route QUERY.",
      ),
    );
    return;
  }
  try {
    (fastify as any).addHttpMethod(QUERY_METHOD, { hasBody: true });
  } catch {
    // Already registered (e.g. another plugin) — safe to ignore.
  }

  const contentTypes = options.contentTypes ?? DEFAULT_CONTENT_TYPES;
  for (const ct of contentTypes) {
    try {
      fastify.addContentTypeParser(ct, { parseAs: "buffer" }, (req, raw: Buffer, cb) => {
        req.rawQueryBody = raw;
        if (ct === "application/json") {
          try {
            cb(null, raw.length ? JSON.parse(raw.toString("utf8")) : undefined);
          } catch (err) {
            (err as any).statusCode = 400;
            cb(err as Error, undefined);
          }
        } else if (ct === "application/x-www-form-urlencoded") {
          cb(null, Object.fromEntries(new URLSearchParams(raw.toString("utf8"))));
        } else {
          cb(null, raw);
        }
      });
    } catch {
      // Parser already registered for this content type; leave it in place.
    }
  }

  // Reply helpers.
  fastify.decorateReply("acceptQuery", function (this: FastifyReply, mediaTypes: string[]) {
    this.header("Accept-Query", advertiseAcceptQuery(mediaTypes));
    return this;
  });
  fastify.decorateReply("contentLocation", function (this: FastifyReply, url: string) {
    this.header("Content-Location", url); // RFC 9110 §10.2.2
    return this;
  });

  const cache = resolveCache(options.cache);
  if (cache) {
    // Lookup after the body is parsed; short-circuit on a hit.
    fastify.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
      if (req.method !== QUERY_METHOD) return;
      const reqLike = {
        method: req.method,
        url: req.url,
        headers: req.headers as Record<string, string | string[] | undefined>,
        body: reqBodyBytes(req),
      };
      const result = await cache.lookup(reqLike);
      if (result.status === "hit") {
        for (const [k, v] of Object.entries(result.response.headers)) {
          if (k.toLowerCase() === "x-query-cache") continue;
          reply.header(k, v);
        }
        reply.header("X-Query-Cache", "HIT");
        reply.code(result.response.status);
        return reply.send(result.response.body);
      }
      if (result.status === "not-modified") {
        reply.header("X-Query-Cache", "HIT");
        if (result.etag) reply.header("ETag", result.etag);
        reply.code(304);
        return reply.send();
      }
      reply.header("X-Query-Cache", result.status === "uncacheable" ? "BYPASS" : "MISS");
    });

    // Store the outgoing payload on the way out.
    fastify.addHook(
      "onSend",
      async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
        if (req.method !== QUERY_METHOD) return payload;
        if (reply.getHeader("X-Query-Cache") !== "MISS") return payload;
        if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload; // don't buffer streams
        const bodyBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
        const headers = reply.getHeaders() as Record<string, string | string[]>;
        const reqLike = {
          method: req.method,
          url: req.url,
          headers: req.headers as Record<string, string | string[] | undefined>,
          body: reqBodyBytes(req),
        };
        await cache
          .store(reqLike, { status: reply.statusCode, headers, body: bodyBuf })
          .catch(() => {});
        return payload;
      },
    );
  }

  done();
};

// skip-override: apply hooks/decorators to the REGISTERING scope (no new
// encapsulation context) so routes declared as siblings are covered, without
// pulling in the fastify-plugin dependency.
(pluginImpl as unknown as Record<symbol, boolean>)[Symbol.for("skip-override")] = true;

export const fastifyQueryable = pluginImpl;
export default fastifyQueryable;
export { QueryCache } from "../cache/cache.js";
