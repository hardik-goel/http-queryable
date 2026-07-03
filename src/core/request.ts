/**
 * Canonical QUERY request model + validation, framework-agnostic.
 *
 * RFC 10008 §2:
 *   - QUERY is a safe, idempotent method whose semantics are a read defined by
 *     the request content.
 *   - A QUERY request that carries content MUST describe it with Content-Type
 *     (per RFC 9110 §8.3). We reject a body without a Content-Type so it never
 *     silently becomes an opaque, un-cacheable request.
 *
 * These checks are deliberately minimal and transport-agnostic; adapters map
 * the outcome onto their framework's response.
 */
import { Buffer } from "node:buffer";
import { parseMediaType } from "./media-type.js";
import { QUERY_METHOD } from "../runtime.js";

export interface QueryRequestParts {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Buffer | string | null;
}

export type QueryValidation =
  { ok: true } | { ok: false; status: number; code: string; message: string };

function headerValue(headers: QueryRequestParts["headers"], name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

function bodyLength(body: Buffer | string | null | undefined): number {
  if (body == null) return 0;
  return typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.length;
}

/**
 * Validate a QUERY request. Returns a machine-readable result an adapter can
 * turn into a response. Does NOT throw.
 */
export function validateQueryRequest(req: QueryRequestParts): QueryValidation {
  if (req.method.toUpperCase() !== QUERY_METHOD) {
    return {
      ok: false,
      status: 405,
      code: "method_not_query",
      message: `Expected ${QUERY_METHOD}, received ${req.method}.`,
    };
  }

  const hasBody = bodyLength(req.body) > 0;
  const contentType = headerValue(req.headers, "content-type");

  if (hasBody && !contentType) {
    // RFC 9110 §8.3 / RFC 10008 §2: content must carry a Content-Type.
    return {
      ok: false,
      status: 415,
      code: "missing_content_type",
      message: "A QUERY request with content must include a Content-Type header.",
    };
  }

  if (hasBody && contentType && !parseMediaType(contentType)) {
    return {
      ok: false,
      status: 415,
      code: "invalid_content_type",
      message: `Unparseable Content-Type: ${contentType}`,
    };
  }

  return { ok: true };
}

/** RFC 10008 §2: QUERY is safe and idempotent — so retries are always allowed. */
export const QUERY_IS_SAFE = true;
export const QUERY_IS_IDEMPOTENT = true;
