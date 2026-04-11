import { describe, expect, it } from "vitest";
import { TERRAIN_HALF_SIZE } from "../scene/terrain";
import {
  BIOME_BLUE_MAX_Z,
  BIOME_RED_MIN_Z,
  biomeMountainColor,
  setBiomeGroundColor,
} from "./biomes";
import { Color } from "three";

describe("biomes", () => {
  it("splits Z into equal thirds for current terrain half-size", () => {
    const span = 2 * TERRAIN_HALF_SIZE;
    const third = span / 3;
    expect(BIOME_BLUE_MAX_Z + third).toBeCloseTo(BIOME_RED_MIN_Z, 5);
    expect(BIOME_RED_MIN_Z - BIOME_BLUE_MAX_Z).toBeCloseTo(third, 5);
  });

  it("uses winter tint deep in the south third and forest tint deep in the north", () => {
    const south = new Color();
    const north = new Color();
    setBiomeGroundColor(-TERRAIN_HALF_SIZE + 10, south);
    setBiomeGroundColor(TERRAIN_HALF_SIZE - 10, north);
    expect(south.b).toBeGreaterThan(south.r);
    expect(north.g).toBeGreaterThan(north.b);
  });

  it("returns distinct mountain colors at biome extremes", () => {
    const s = biomeMountainColor(-TERRAIN_HALF_SIZE + 5);
    const n = biomeMountainColor(TERRAIN_HALF_SIZE - 5);
    expect(s).not.toBe(n);
  });
});
