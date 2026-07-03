import { describe, it, expect } from "vitest";
import {
  isQueryMethodSupported,
  assertQueryMethodSupported,
  currentNodeMajor,
  QUERY_METHOD,
  MIN_NODE_MAJOR,
} from "../src/runtime.js";
import { METHODS } from "node:http";

describe("runtime QUERY detection", () => {
  it("reports support consistently with http.METHODS", () => {
    expect(isQueryMethodSupported()).toBe(METHODS.includes(QUERY_METHOD));
  });

  it("does not throw on a supporting runtime (this test needs Node >= 22)", () => {
    // The test runner itself must satisfy the baseline; guard defensively.
    if (currentNodeMajor() >= MIN_NODE_MAJOR) {
      expect(() => assertQueryMethodSupported()).not.toThrow();
    }
  });

  it("exposes the canonical method token", () => {
    expect(QUERY_METHOD).toBe("QUERY");
  });
});
