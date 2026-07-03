import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import http, { type Server } from "node:http";
import { queryable, sendAcceptQuery, contentLocation, QueryCache } from "../src/express/index.js";
import { request, listen } from "./helpers/http-client.js";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function start(build: (app: express.Express) => void): Promise<Server> {
  const app = express();
  build(app);
  const server = await listen(http.createServer(app));
  servers.push(server);
  return server;
}

const JSON_CT = { "content-type": "application/json" };

describe("Express QUERY routing + body", () => {
  it("routes app.query and parses a JSON body", async () => {
    const server = await start((app) => {
      app.use(queryable({ cache: false }));
      app.query("/search", (req, res) => {
        res.json({ echo: req.body, method: req.method });
      });
    });
    const res = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"q":"hello"}',
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ echo: { q: "hello" }, method: "QUERY" });
  });

  it("rejects a malformed JSON body with 400", async () => {
    const server = await start((app) => {
      app.use(queryable({ cache: false }));
      app.query("/search", (_req, res) => res.json({ ok: true }));
    });
    const res = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("enforces the body size limit with 413", async () => {
    const server = await start((app) => {
      app.use(queryable({ cache: false, bodyLimit: 8 }));
      app.query("/search", (_req, res) => res.json({ ok: true }));
    });
    const res = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"q":"way too long"}',
    });
    expect(res.status).toBe(413);
  });
});

describe("Express body-aware caching (the headline)", () => {
  it("serves the second identical request from cache, correctly", async () => {
    let calls = 0;
    const server = await start((app) => {
      app.use(queryable({ cache: new QueryCache({ defaultTtlMs: 60_000 }) }));
      app.query("/search", (req, res) => {
        calls++;
        res.json({ result: (req.body as any).q, calls });
      });
    });
    const first = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"q":"cats"}',
    });
    const second = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"q":"cats"}',
    });
    expect(first.headers["x-query-cache"]).toBe("MISS");
    expect(second.headers["x-query-cache"]).toBe("HIT");
    expect(second.body).toBe(first.body);
    expect(calls).toBe(1); // handler ran once
  });

  it("SAFETY: a different body never gets the prior body's cached response", async () => {
    const server = await start((app) => {
      app.use(queryable({ cache: new QueryCache({ defaultTtlMs: 60_000 }) }));
      app.query("/search", (req, res) => res.json({ result: (req.body as any).q }));
    });
    await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"q":"cats"}',
    });
    const dogs = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"q":"dogs"}',
    });
    expect(dogs.headers["x-query-cache"]).toBe("MISS");
    expect(JSON.parse(dogs.body)).toEqual({ result: "dogs" });
  });

  it("reordered-key body is a cache HIT (semantic equality)", async () => {
    const server = await start((app) => {
      app.use(queryable({ cache: new QueryCache({ defaultTtlMs: 60_000 }) }));
      app.query("/search", (req, res) => res.json({ ok: true }));
    });
    await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{"a":1,"b":2}',
    });
    const hit = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: '{ "b":2, "a":1 }',
    });
    expect(hit.headers["x-query-cache"]).toBe("HIT");
  });
});

describe("Express CORS preflight for QUERY", () => {
  it("answers an OPTIONS preflight requesting QUERY", async () => {
    const server = await start((app) => {
      app.use(queryable({ cache: false, cors: { origin: "*" } }));
      app.query("/search", (_req, res) => res.json({ ok: true }));
    });
    const res = await request(server, {
      method: "OPTIONS",
      path: "/search",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "QUERY",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("QUERY");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});

describe("Express helpers", () => {
  it("sendAcceptQuery + contentLocation set headers", async () => {
    const server = await start((app) => {
      app.use(queryable({ cache: false }));
      app.query("/search", (_req, res) => {
        sendAcceptQuery(res, ["application/json", "application/sql"]);
        contentLocation(res, "/search/results/123");
        res.json({ ok: true });
      });
    });
    const res = await request(server, {
      method: "QUERY",
      path: "/search",
      headers: JSON_CT,
      body: "{}",
    });
    expect(res.headers["accept-query"]).toBe("application/json, application/sql");
    expect(res.headers["content-location"]).toBe("/search/results/123");
  });
});
