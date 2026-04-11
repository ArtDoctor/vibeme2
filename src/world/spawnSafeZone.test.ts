import { describe, expect, it } from "vitest";
import { TERRAIN_HALF_SIZE } from "../scene/terrain";
import {
  ALL_SPAWN_SAFE_ZONE_AABBS,
  SPAWN_SAFE_ZONE_HALF,
  isPointInSpawnSafeZone,
  safeZoneIndexAt,
} from "./spawnSafeZone";

describe("spawnSafeZone / chaos vs safe (Milestone 7)", () => {
  it("safe courtyards cover a small fraction of the open map", () => {
    const w = 2 * SPAWN_SAFE_ZONE_HALF;
    const safeArea = ALL_SPAWN_SAFE_ZONE_AABBS.length * w * w;
    const mapArea = (2 * TERRAIN_HALF_SIZE) ** 2;
    expect(safeArea / mapArea).toBeLessThan(0.002);
  });

  it("reports index 0 at the world-origin courtyard and null deep in the desert", () => {
    expect(safeZoneIndexAt(0, 0)).toBe(0);
    expect(safeZoneIndexAt(130, -240)).toBeNull();
  });

  it("treats castle interiors as safe, open sand as chaos", () => {
    expect(isPointInSpawnSafeZone(0, 0)).toBe(true);
    expect(isPointInSpawnSafeZone(200, -300)).toBe(false);
  });
});
