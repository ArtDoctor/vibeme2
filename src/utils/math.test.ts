import { describe, expect, it } from "vitest";
import { clamp, hash2, lerpAngle, shortestAngleDelta } from "./math";

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

describe("shortestAngleDelta", () => {
  it("wraps across ±π", () => {
    expect(shortestAngleDelta(0, Math.PI)).toBeCloseTo(Math.PI);
    expect(shortestAngleDelta(Math.PI, 0)).toBeCloseTo(-Math.PI);
    // Prefer the short turn toward 3π/2 (down) over the long positive sweep.
    expect(shortestAngleDelta(0, (3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("lerpAngle", () => {
  it("interpolates the short way", () => {
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4);
    expect(lerpAngle(-Math.PI / 2, Math.PI / 2, 0.5)).toBeCloseTo(0);
  });
});
