import { describe, expect, it } from "vitest";
import { sampleTerrainHeight, TERRAIN_HALF_SIZE } from "./terrain";

describe("sampleTerrainHeight", () => {
  it("is deterministic at the same coordinates", () => {
    const a = sampleTerrainHeight(3.3, -7.1);
    const b = sampleTerrainHeight(3.3, -7.1);
    expect(a).toBe(b);
  });

  it("matches analytic value at origin (dunes + ripples)", () => {
    expect(sampleTerrainHeight(0, 0)).toBeCloseTo(0.09, 10);
  });

  it("exports world half-size constant", () => {
    expect(TERRAIN_HALF_SIZE).toBe(200);
  });
});
