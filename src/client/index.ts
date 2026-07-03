/**
 * Isomorphic QUERY client for browser `fetch` and Node (Node 22+ ships a global
 * fetch). No Node-only imports here so the module is safe to bundle for the
 * browser.
 *
 * QUERY is safe and idempotent (RFC 10008 §2), which is exactly what makes
 * automatic retries correct: re-sending the same QUERY cannot cause a side
 * effect. This client leans on that:
 *   - one-line `query(url, body, opts)` that sets Content-Type and serializes,
 *   - optional `Accept-Query` discovery via OPTIONS (RFC 10008 §3),
 *   - optional follow of `Content-Location`/`Location` to GET the canonical,
 *     cacheable result representation (RFC 9110 §10.2.2),
 *   - safe exponential-backoff retry on transient failures.
 */
import { parseAcceptQuery, negotiateQueryType } from "../core/accept-query.js";

export interface RetryOptions {
  /** Max retry attempts after the first try. Default 2. */
  retries?: number;
  /** Base backoff in ms (doubled each attempt). Default 100. */
  baseDelayMs?: number;
  /** Status codes that should trigger a retry. Default [429, 502, 503, 504]. */
  retryStatuses?: number[];
}

export interface QueryOptions {
  /** Content-Type for the body. Default "application/json". */
  contentType?: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /**
   * Serialize the body to a string/BodyInit. Default: JSON.stringify for
   * objects; strings/ArrayBuffers/typed data are passed through unchanged.
   */
  serialize?: (body: unknown, contentType: string) => BodyInit;
  /** Injectable fetch (tests, custom agents). Default: global fetch. */
  fetch?: typeof fetch;
  /** Abort signal. */
  signal?: AbortSignal;
  /**
   * Discover supported query media types via an OPTIONS preflight and negotiate
   * a Content-Type before sending. Off by default (adds a round trip).
   */
  discover?: boolean;
  /**
   * After a successful QUERY, if the response advertises a Content-Location (or
   * a Location on a 3xx), follow it with GET to fetch the canonical result.
   * Default false — the QUERY response body is usually the result already.
   */
  followResult?: boolean;
  /** Retry policy. `false` disables; a number sets the attempt count. */
  retry?: RetryOptions | number | false;
}

export interface QueryResult {
  /** The final Response (after following Content-Location, if requested). */
  response: Response;
  /** The URL that produced `response` (may differ if a result was followed). */
  url: string;
  /** Content-Location advertised by the QUERY response, if any. */
  contentLocation?: string;
  /** The Content-Type negotiated via discovery, if discovery ran. */
  negotiatedType?: string;
}

const DEFAULT_RETRY_STATUSES = [429, 502, 503, 504];

function resolveFetch(opts: QueryOptions): typeof fetch {
  const f = opts.fetch ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!f) {
    throw new Error(
      "No fetch implementation available. Pass opts.fetch or run on a runtime with a global fetch (Node >= 18).",
    );
  }
  return f;
}

function defaultSerialize(body: unknown, contentType: string): BodyInit {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body as ArrayBufferView) ||
    body instanceof Blob ||
    body instanceof URLSearchParams ||
    body instanceof FormData
  ) {
    return body as BodyInit;
  }
  if (contentType.includes("x-www-form-urlencoded") && typeof body === "object") {
    return new URLSearchParams(body as Record<string, string>).toString();
  }
  return JSON.stringify(body);
}

function normalizeRetry(retry: QueryOptions["retry"]): Required<RetryOptions> {
  if (retry === false) return { retries: 0, baseDelayMs: 100, retryStatuses: [] };
  if (typeof retry === "number") {
    return { retries: retry, baseDelayMs: 100, retryStatuses: DEFAULT_RETRY_STATUSES };
  }
  return {
    retries: retry?.retries ?? 2,
    baseDelayMs: retry?.baseDelayMs ?? 100,
    retryStatuses: retry?.retryStatuses ?? DEFAULT_RETRY_STATUSES,
  };
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Discover the media types a resource accepts as a QUERY body, via OPTIONS.
 * Returns the parsed, preference-ordered list (empty if none advertised).
 */
export async function discoverAcceptQuery(
  url: string,
  opts: Pick<QueryOptions, "fetch" | "headers" | "signal"> = {},
): Promise<string[]> {
  const doFetch = resolveFetch(opts);
  const res = await doFetch(url, { method: "OPTIONS", headers: opts.headers, signal: opts.signal });
  const header = res.headers.get("accept-query");
  return parseAcceptQuery(header).map((e) => e.mediaType);
}

/**
 * Send an HTTP QUERY request. Returns a QueryResult wrapping the Response.
 *
 * @example
 * const { response } = await query("/search", { q: "cats" });
 * const results = await response.json();
 */
export async function query(
  url: string,
  body?: unknown,
  opts: QueryOptions = {},
): Promise<QueryResult> {
  const doFetch = resolveFetch(opts);
  let contentType = opts.contentType ?? "application/json";
  let negotiatedType: string | undefined;

  if (opts.discover) {
    const supported = await discoverAcceptQuery(url, opts);
    if (supported.length > 0) {
      const chosen = negotiateQueryType(contentType, supported) ?? supported[0]!;
      contentType = chosen;
      negotiatedType = chosen;
    }
  }

  const serialize = opts.serialize ?? defaultSerialize;
  const payload = body === undefined ? undefined : serialize(body, contentType);

  const headers: Record<string, string> = { ...opts.headers };
  if (payload !== undefined && !("content-type" in lower(headers))) {
    headers["Content-Type"] = contentType;
  }

  const retry = normalizeRetry(opts.retry);
  const response = await sendWithRetry(
    doFetch,
    url,
    { method: "QUERY", headers, body: payload, signal: opts.signal },
    retry,
  );

  const contentLocation = response.headers.get("content-location") ?? undefined;
  let finalResponse = response;
  let finalUrl = url;

  if (opts.followResult) {
    const location = contentLocation ?? response.headers.get("location") ?? undefined;
    if (location) {
      const resolved = new URL(location, url).toString();
      // The result of a QUERY is retrievable with GET (safe to auto-follow).
      finalResponse = await sendWithRetry(
        doFetch,
        resolved,
        { method: "GET", headers: opts.headers, signal: opts.signal },
        retry,
      );
      finalUrl = resolved;
    }
  }

  return { response: finalResponse, url: finalUrl, contentLocation, negotiatedType };
}

function lower(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(headers)) out[k.toLowerCase()] = headers[k]!;
  return out;
}

async function sendWithRetry(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  retry: Required<RetryOptions>,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retry.retries; attempt++) {
    try {
      const res = await doFetch(url, init);
      if (attempt < retry.retries && retry.retryStatuses.includes(res.status)) {
        await delay(retry.baseDelayMs * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      // Network-level failure. QUERY is idempotent, so a retry is safe.
      lastError = err;
      if (attempt < retry.retries) {
        await delay(retry.baseDelayMs * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
