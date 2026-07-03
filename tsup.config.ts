import { defineConfig } from "tsup";

// Dual ESM/CJS build with per-adapter entry points so consumers can import
// only what they need (e.g. `http-queryable/express`) and keep framework deps
// out of the core bundle.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "express/index": "src/express/index.ts",
    "fastify/index": "src/fastify/index.ts",
    "http/index": "src/http/index.ts",
    "client/index": "src/client/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: "node22",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
