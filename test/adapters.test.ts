import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { Server } from "node:http";
import { fastifyQueryable, QueryCache as FQueryCache } from "../src/fastify/index.js";
import { createQueryServer, QueryCache as HQueryCache } from "../src/http/index.js";
import { request, listen } from "./helpers/http-client.js";

const JSON_CT = { "content-type": "application/json" };

describe("Fastify adapter (thin, reuses core caching)", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  async function start(cache: FQueryCache | false): Promise<FastifyInstance> {
    const app = Fastify();
    await app.register(fastifyQueryable, { cache });
    app.route({
      method: "QUERY",
      url: "/search",
      handler: (req, reply) => {
        reply.acceptQuery(["application/json"]);
        reply.send({ result: (req.body as any).q });
      },
    });
    await app.ready();
    await app.listen({ port: 0 });
    apps.push(app);
    return app;
  }

  it("routes QUERY and parses the body", async () => {
    const app = await start(false);
    const res = await request(app.server as Server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"q":"hi"}',
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ result: "hi" });
    expect(res.headers["accept-query"]).toBe("application/json");
  });

  it("caches correctly and never cross-serves a different body", async () => {
    const app = await start(new FQueryCache({ defaultTtlMs: 60_000 }));
    const server = app.server as Server;
    const a = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"q":"cats"}',
    });
    const b = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"q":"cats"}',
    });
    const c = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"q":"dogs"}',
    });
    expect(a.headers["x-query-cache"]).toBe("MISS");
    expect(b.headers["x-query-cache"]).toBe("HIT");
    expect(b.body).toBe(a.body);
    expect(c.headers["x-query-cache"]).toBe("MISS");
    expect(JSON.parse(c.body)).toEqual({ result: "dogs" });
  });
});

describe("Raw http adapter (framework-agnostic core)", () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });

  async function start(cache: HQueryCache | false): Promise<Server> {
    const server = createQueryServer(
      (_req, res, ctx) => {
        ctx.acceptQuery(["application/json"]);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ result: (ctx.body as any).q }));
      },
      { cache },
    );
    await listen(server);
    servers.push(server);
    return server;
  }

  it("handles QUERY with a parsed body", async () => {
    const server = await start(false);
    const res = await request(server, {
      method: "QUERY",
      path: "/s",
      headers: JSON_CT,
      body: '{"q":"x"}',
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ result: "x" });
  });

  it("responds 405 to non-QUERY methods", async () => {
    const server = await start(false);
    const res = await request(server, { method: "GET", path: "/s" });
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toContain("QUERY");
  });

  it("caches with body-aware safety", async () => {
    const server = await start(new HQueryCache({ defaultTtlMs: 60_000 }));
    const a = await request(server, {
      method: "QUERY",
      path: "/s",
      headers: JSON_CT,
      body: '{"q":"cats"}',
    });
    const b = await request(server, {
      method: "QUERY",
      path: "/s",
      headers: JSON_CT,
      body: '{"q":"cats"}',
    });
    const c = await request(server, {
      method: "QUERY",
      path: "/s",
      headers: JSON_CT,
      body: '{"q":"dogs"}',
    });
    expect(a.headers["x-query-cache"]).toBe("MISS");
    expect(b.headers["x-query-cache"]).toBe("HIT");
    expect(c.headers["x-query-cache"]).toBe("MISS");
    expect(JSON.parse(c.body)).toEqual({ result: "dogs" });
  });
});
