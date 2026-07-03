import http from "node:http";
import type { AddressInfo } from "node:net";

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Issue a real HTTP request (any method, incl. QUERY) against a server. */
export function request(
  server: http.Server,
  opts: { method: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<RawResponse> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: opts.method, path: opts.path, headers: opts.headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body != null) req.write(opts.body);
    req.end();
  });
}

/** Start a server on an ephemeral port. */
export function listen(server: http.Server): Promise<http.Server> {
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}
