import { describe, it, expect } from "vitest";
import {
  advertiseAcceptQuery,
  parseAcceptQuery,
  negotiateQueryType,
} from "../src/core/accept-query.js";
import { validateQueryRequest } from "../src/core/request.js";

describe("Accept-Query advertise/parse (RFC 10008 §3)", () => {
  it("advertises a deduped essence list", () => {
    expect(
      advertiseAcceptQuery([
        "application/json; charset=utf-8",
        "application/json",
        "application/sql",
      ]),
    ).toBe("application/json, application/sql");
  });

  it("parses and orders by q weight", () => {
    const parsed = parseAcceptQuery("application/sql;q=0.5, application/json;q=0.9");
    expect(parsed.map((e) => e.mediaType)).toEqual(["application/json", "application/sql"]);
  });

  it("negotiates the best mutual type", () => {
    expect(
      negotiateQueryType("application/sql;q=0.2, application/json;q=0.9", [
        "application/json",
        "application/sql",
      ]),
    ).toBe("application/json");
  });

  it("returns null when there is no overlap", () => {
    expect(negotiateQueryType("application/graphql", ["application/json"])).toBeNull();
  });

  it("falls back to server's first type when client has no preference", () => {
    expect(negotiateQueryType(undefined, ["application/json", "application/sql"])).toBe(
      "application/json",
    );
  });
});

describe("validateQueryRequest (RFC 10008 §2)", () => {
  it("accepts a well-formed QUERY request", () => {
    const r = validateQueryRequest({
      method: "QUERY",
      url: "/s",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a body without Content-Type (415)", () => {
    const r = validateQueryRequest({
      method: "QUERY",
      url: "/s",
      headers: {},
      body: '{"a":1}',
    });
    expect(r).toMatchObject({ ok: false, status: 415, code: "missing_content_type" });
  });

  it("rejects a non-QUERY method (405)", () => {
    const r = validateQueryRequest({ method: "GET", url: "/s", headers: {} });
    expect(r).toMatchObject({ ok: false, status: 405 });
  });

  it("allows an empty body with no Content-Type", () => {
    const r = validateQueryRequest({ method: "QUERY", url: "/s", headers: {} });
    expect(r.ok).toBe(true);
  });
});
