import { describe, it, expect, vi } from "vitest";
import { query, discoverAcceptQuery } from "../src/client/index.js";

interface Call {
  url: string;
  init: RequestInit;
}

/** Build a mock fetch that records calls and returns scripted responses. */
function mockFetch(responder: (call: Call, i: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return responder(call, calls.length - 1);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
}

describe("query() — request shaping", () => {
  it("uses QUERY, sets Content-Type, serializes JSON", async () => {
    const { fn, calls } = mockFetch(() => json({ ok: true }));
    const { response } = await query("https://api.test/search", { q: "cats" }, { fetch: fn });
    expect(calls[0]!.init.method).toBe("QUERY");
    expect((calls[0]!.init.headers as any)["Content-Type"]).toBe("application/json");
    expect(calls[0]!.init.body).toBe('{"q":"cats"}');
    expect(await response.json()).toEqual({ ok: true });
  });

  it("serializes objects as form-urlencoded when asked", async () => {
    const { fn, calls } = mockFetch(() => json({ ok: true }));
    await query(
      "https://api.test/s",
      { a: "1", b: "2" },
      { fetch: fn, contentType: "application/x-www-form-urlencoded" },
    );
    expect(calls[0]!.init.body).toBe("a=1&b=2");
  });

  it("passes string bodies through unchanged", async () => {
    const { fn, calls } = mockFetch(() => json({ ok: true }));
    await query("https://api.test/s", "SELECT 1", { fetch: fn, contentType: "application/sql" });
    expect(calls[0]!.init.body).toBe("SELECT 1");
    expect((calls[0]!.init.headers as any)["Content-Type"]).toBe("application/sql");
  });
});

describe("query() — Accept-Query discovery", () => {
  it("runs OPTIONS and negotiates a supported type", async () => {
    const { fn, calls } = mockFetch((call) => {
      if (call.init.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: { "accept-query": "application/sql, application/json" },
        });
      }
      return json({ ok: true });
    });
    const { negotiatedType } = await query(
      "https://api.test/s",
      { q: 1 },
      { fetch: fn, discover: true, contentType: "application/json" },
    );
    expect(calls[0]!.init.method).toBe("OPTIONS");
    expect(negotiatedType).toBe("application/json");
    expect(calls[1]!.init.method).toBe("QUERY");
  });

  it("discoverAcceptQuery parses the header", async () => {
    const { fn } = mockFetch(
      () =>
        new Response(null, {
          status: 204,
          headers: { "accept-query": "application/json;q=0.9, application/sql;q=0.5" },
        }),
    );
    expect(await discoverAcceptQuery("https://api.test/s", { fetch: fn })).toEqual([
      "application/json",
      "application/sql",
    ]);
  });
});

describe("query() — Content-Location follow (RFC 9110 §10.2.2)", () => {
  it("follows Content-Location with GET when followResult is set", async () => {
    const { fn, calls } = mockFetch((call) => {
      if (call.init.method === "QUERY") {
        return json({ preview: true }, { headers: { "content-location": "/results/42" } });
      }
      return json({ full: true });
    });
    const { response, url, contentLocation } = await query(
      "https://api.test/search",
      { q: "x" },
      { fetch: fn, followResult: true },
    );
    expect(contentLocation).toBe("/results/42");
    expect(calls[1]!.init.method).toBe("GET");
    expect(url).toBe("https://api.test/results/42");
    expect(await response.json()).toEqual({ full: true });
  });

  it("does not follow when followResult is false (default)", async () => {
    const { fn, calls } = mockFetch(() =>
      json({ preview: true }, { headers: { "content-location": "/results/42" } }),
    );
    await query("https://api.test/search", { q: "x" }, { fetch: fn });
    expect(calls).toHaveLength(1);
  });
});

describe("query() — safe auto-retry (QUERY is idempotent, RFC 10008 §2)", () => {
  it("retries a 503 then succeeds", async () => {
    let n = 0;
    const { fn, calls } = mockFetch(() => {
      n++;
      return n < 2 ? new Response("busy", { status: 503 }) : json({ ok: true });
    });
    const { response } = await query(
      "https://api.test/s",
      { q: 1 },
      { fetch: fn, retry: { retries: 3, baseDelayMs: 1 } },
    );
    expect(response.status).toBe(200);
    expect(calls.length).toBe(2);
  });

  it("retries a network error then succeeds", async () => {
    let n = 0;
    const { fn } = mockFetch(() => {
      n++;
      if (n < 2) throw new Error("ECONNRESET");
      return json({ ok: true });
    });
    const { response } = await query(
      "https://api.test/s",
      { q: 1 },
      { fetch: fn, retry: { retries: 2, baseDelayMs: 1 } },
    );
    expect(response.status).toBe(200);
  });

  it("gives up after exhausting retries", async () => {
    const { fn, calls } = mockFetch(() => new Response("busy", { status: 503 }));
    const { response } = await query(
      "https://api.test/s",
      { q: 1 },
      { fetch: fn, retry: { retries: 2, baseDelayMs: 1 } },
    );
    expect(response.status).toBe(503);
    expect(calls.length).toBe(3); // 1 + 2 retries
  });

  it("does not retry when retry is false", async () => {
    const { fn, calls } = mockFetch(() => new Response("busy", { status: 503 }));
    await query("https://api.test/s", { q: 1 }, { fetch: fn, retry: false });
    expect(calls.length).toBe(1);
  });
});
