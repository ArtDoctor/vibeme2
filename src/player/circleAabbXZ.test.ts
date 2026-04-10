import { describe, expect, it } from "vitest";
import type { AABBCollider } from "../scene/DesertScene";
import { PLAYER_RADIUS } from "../game/constants";
import {
  clampWorldBoundsXz,
  iterativelyResolvePlayerXz,
  resolveCircleAgainstAabbXz,
} from "./circleAabbXZ";

describe("clampWorldBoundsXz", () => {
  it("clamps to worldHalfSize - 1", () => {
    const { x, z } = clampWorldBoundsXz(500, -500, 200);
    expect(x).toBe(199);
    expect(z).toBe(-199);
  });
});

describe("resolveCircleAgainstAabbXz", () => {
  it("separates a circle overlapping the min-X face from outside", () => {
    const box: Pick<AABBCollider, "minX" | "maxX" | "minZ" | "maxZ"> = {
      minX: 10,
      maxX: 11,
      minZ: 10,
      maxZ: 11,
    };
    const r = 0.35;
    const { x, z } = resolveCircleAgainstAabbXz(9.7, 10.5, box, r);
    expect(z).toBeCloseTo(10.5, 6);
    expect(10 - x).toBeGreaterThanOrEqual(r - 1e-5);
  });
});

describe("iterativelyResolvePlayerXz", () => {
  it("ignores colliders entirely below the feet", () => {
    const colliders: AABBCollider[] = [
      { minX: 5, maxX: 6, minZ: 5, maxZ: 6, topY: 0.1 },
    ];
    const { x, z } = iterativelyResolvePlayerXz(5.2, 5.2, 2.0, colliders, {
      worldHalfSize: 200,
      playerRadius: PLAYER_RADIUS,
    });
    expect(x).toBeCloseTo(5.2, 5);
    expect(z).toBeCloseTo(5.2, 5);
  });
});
