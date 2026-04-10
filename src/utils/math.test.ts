import { describe, expect, it } from "vitest";
import { clamp, hash2 } from "./math";

describe("clamp", () => {
  it("clamps below min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("passes through in range", () => {
    expect(clamp(3.5, 0, 10)).toBe(3.5);
  });
});

describe("hash2", () => {
  it("returns values in [0, 1)", () => {
    for (let i = -5; i < 15; i += 1) {
      const h = hash2(i * 1.7, i * -2.3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it("is deterministic", () => {
    expect(hash2(12.3, -4.5)).toBe(hash2(12.3, -4.5));
  });

  it("matches reference at origin", () => {
    expect(hash2(0, 0)).toBe(0);
  });
});
