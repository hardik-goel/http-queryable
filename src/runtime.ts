/**
 * Runtime detection for the HTTP QUERY method.
 *
 * QUERY is a new HTTP method defined by RFC 10008. For a Node server to accept
 * it, the underlying HTTP parser (llhttp) must recognize QUERY as a valid
 * request method — otherwise the request is rejected before user code runs.
 *
 * Node >= 22 lists "QUERY" in `http.METHODS`. Older releases do not and will
 * reject inbound QUERY requests with an HTTP 400 at the parser level, which no
 * amount of routing can fix. We detect this at import/use time and fail loudly
 * with an actionable message rather than silently mis-behaving.
 *
 * @see RFC 10008 §2 (The QUERY Method)
 */
import { METHODS } from "node:http";

/** The canonical method token. RFC 10008 §2: the method name is "QUERY". */
export const QUERY_METHOD = "QUERY" as const;

/**
 * True when the current Node runtime's HTTP parser accepts inbound QUERY
 * requests (i.e. "QUERY" appears in `http.METHODS`).
 */
export function isQueryMethodSupported(): boolean {
  try {
    return Array.isArray(METHODS) && METHODS.includes(QUERY_METHOD);
  } catch {
    return false;
  }
}

/**
 * The minimum Node major version known to accept QUERY at the parser level.
 * Kept as a constant so docs, errors, and the engines field stay in sync.
 */
export const MIN_NODE_MAJOR = 22;

/** Parsed major version of the current process, or NaN in non-Node runtimes. */
export function currentNodeMajor(): number {
  const v = typeof process !== "undefined" ? process.versions?.node : undefined;
  if (!v) return NaN;
  return Number.parseInt(v.split(".")[0] ?? "", 10);
}

export class QueryMethodUnsupportedError extends Error {
  override readonly name = "QueryMethodUnsupportedError";
  constructor(message: string) {
    super(message);
  }
}

/**
 * Throw a clear, actionable error if the runtime cannot accept QUERY requests.
 * Call this from any server-side entry point (Express/Fastify/http adapters)
 * before wiring routes, so misconfiguration fails at startup, not at request
 * time with a confusing parser-level 400.
 */
export function assertQueryMethodSupported(): void {
  if (isQueryMethodSupported()) return;

  const major = currentNodeMajor();
  const detected = Number.isNaN(major)
    ? "a non-Node or unknown runtime"
    : `Node ${process.versions.node}`;

  throw new QueryMethodUnsupportedError(
    [
      `The HTTP QUERY method is not accepted by this runtime (${detected}).`,
      `QUERY (RFC 10008) requires the HTTP parser to recognize the method;`,
      `Node lists "QUERY" in http.METHODS starting with Node ${MIN_NODE_MAJOR}.`,
      ``,
      `Fix: upgrade to Node >= ${MIN_NODE_MAJOR}. Then inbound QUERY requests`,
      `will reach your handlers instead of being rejected with a 400 by the parser.`,
    ].join("\n"),
  );
}
