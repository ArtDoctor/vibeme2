/**
 * Milestone 7 — horizontal thirds along Z: blue/winter (south), neutral desert (center),
 * red/forest (north). Matches team war camps: blue south, red north (`teamTerritory.ts`).
 */

import { Color } from "three";
import { TERRAIN_HALF_SIZE } from "../scene/terrain";

const THIRD = (2 * TERRAIN_HALF_SIZE) / 3;

/** South third ends here (everything with smaller Z is winter). */
export const BIOME_BLUE_MAX_Z = -TERRAIN_HALF_SIZE + THIRD;

/** North third starts here (everything with larger Z is forest). */
export const BIOME_RED_MIN_Z = TERRAIN_HALF_SIZE - THIRD;

/** Meters — soft blend between biomes at the two internal boundaries. */
export const BIOME_EDGE_BLEND = 52;

const SAND_GROUND = 0xd7b56d;
const WINTER_GROUND = 0xd8e4ea;
const FOREST_GROUND = 0x86a870;

const SAND_MOUNTAIN = 0x7a5a36;
const WINTER_MOUNTAIN = 0x8e939e;
const FOREST_MOUNTAIN = 0x3d5234;

const SAND_ROCK = 0x9a7a4a;
const WINTER_ROCK = 0xb8c2cc;
const FOREST_ROCK = 0x6b7a58;

const _a = new Color();
const _b = new Color();

function smoothRange(z: number, z0: number, z1: number): number {
  if (z1 <= z0) {
    return 0;
  }
  const t = (z - z0) / (z1 - z0);
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}

/** Vertex albedo for terrain at world Z (smooth transitions at boundaries). */
export function setBiomeGroundColor(z: number, out: Color): void {
  const b = BIOME_BLUE_MAX_Z;
  const r = BIOME_RED_MIN_Z;
  const w = BIOME_EDGE_BLEND;

  _a.setHex(SAND_GROUND);
  _b.setHex(WINTER_GROUND);
  if (z < b - w) {
    out.copy(_b);
    return;
  }
  if (z < b + w) {
    const t = smoothRange(z, b - w, b + w);
    out.lerpColors(_b, _a, t);
    return;
  }
  if (z < r - w) {
    out.copy(_a);
    return;
  }
  if (z < r + w) {
    _b.setHex(FOREST_GROUND);
    const t = smoothRange(z, r - w, r + w);
    out.lerpColors(_a, _b, t);
    return;
  }
  out.setHex(FOREST_GROUND);
}

export function biomeMountainColor(z: number): number {
  const b = BIOME_BLUE_MAX_Z;
  const r = BIOME_RED_MIN_Z;
  const w = BIOME_EDGE_BLEND;
  _a.setHex(WINTER_MOUNTAIN);
  _b.setHex(SAND_MOUNTAIN);
  if (z < b - w) {
    return WINTER_MOUNTAIN;
  }
  if (z < b + w) {
    const t = smoothRange(z, b - w, b + w);
    return _a.lerp(_b, t).getHex();
  }
  if (z < r - w) {
    return SAND_MOUNTAIN;
  }
  if (z < r + w) {
    _a.setHex(SAND_MOUNTAIN);
    _b.setHex(FOREST_MOUNTAIN);
    const t = smoothRange(z, r - w, r + w);
    return _a.lerp(_b, t).getHex();
  }
  return FOREST_MOUNTAIN;
}

export function biomeRockColor(z: number): number {
  const b = BIOME_BLUE_MAX_Z;
  const r = BIOME_RED_MIN_Z;
  const w = BIOME_EDGE_BLEND;
  _a.setHex(WINTER_ROCK);
  _b.setHex(SAND_ROCK);
  if (z < b - w) {
    return WINTER_ROCK;
  }
  if (z < b + w) {
    const t = smoothRange(z, b - w, b + w);
    return _a.lerp(_b, t).getHex();
  }
  if (z < r - w) {
    return SAND_ROCK;
  }
  if (z < r + w) {
    _a.setHex(SAND_ROCK);
    _b.setHex(FOREST_ROCK);
    const t = smoothRange(z, r - w, r + w);
    return _a.lerp(_b, t).getHex();
  }
  return FOREST_ROCK;
}
