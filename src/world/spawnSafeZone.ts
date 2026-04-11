/**
 * PvP-safe courtyards — Milestone 1.5 (`docs/TASKS.md`).
 * Server must use these AABBs before applying PvP damage, mob aggro, or spawning mobs
 * inside a courtyard. Client uses them only for UI and matching visuals.
 */

import { TERRAIN_HALF_SIZE } from "../scene/terrain";

/** Inset from ±terrain edge for the north and corner outposts (matches server `SAFE_ZONE_EDGE_INSET`). */
export const SAFE_ZONE_EDGE_INSET = 15;

/** Half-size of each square courtyard on X and Z. */
export const SPAWN_SAFE_ZONE_HALF = 5;

const H = SPAWN_SAFE_ZONE_HALF;
const E = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;

/** All safe zones: spawn castle, north and south edges, and four corners (matches `SPAWN_SAFE_ZONES` in `server/src/world.rs`). */
export const ALL_SPAWN_SAFE_ZONE_AABBS = [
  { minX: -H, maxX: H, minZ: -H, maxZ: H },
  { minX: -H, maxX: H, minZ: E - H, maxZ: E + H },
  { minX: -E - H, maxX: -E + H, minZ: E - H, maxZ: E + H },
  { minX: E - H, maxX: E + H, minZ: E - H, maxZ: E + H },
  { minX: -E - H, maxX: -E + H, minZ: -E - H, maxZ: -E + H },
  { minX: E - H, maxX: E + H, minZ: -E - H, maxZ: -E + H },
  { minX: -H, maxX: H, minZ: -E - H, maxZ: -E + H },
] as const;

/** Courtyard centers — same order as `ALL_SPAWN_SAFE_ZONE_AABBS` / server `SPAWN_SAFE_ZONES`. Shop interaction XZ is offset via `shops.ts`. */
export function safeZoneCenterXZ(
  index: number,
): { readonly x: number; readonly z: number } {
  const a = ALL_SPAWN_SAFE_ZONE_AABBS[index];
  if (!a) {
    return { x: 0, z: 0 };
  }
  return { x: (a.minX + a.maxX) / 2, z: (a.minZ + a.maxZ) / 2 };
}

/** Corner outposts (indices 2–5) sell advanced gear; 0, 1, 6 are traveler stalls. */
export function isAdvancedShopSafeZoneIndex(index: number): boolean {
  return index >= 2 && index <= 5;
}

/** Primary spawn courtyard only (backward compat). */
export const SPAWN_SAFE_ZONE_AABB = ALL_SPAWN_SAFE_ZONE_AABBS[0];

export type SpawnSafeZoneAabb = typeof SPAWN_SAFE_ZONE_AABB;

/** Half-size of the square courtyard on X and Z (matches primary `SPAWN_SAFE_ZONE_AABB`). */
export const SPAWN_COURTYARD_HALF = SPAWN_SAFE_ZONE_HALF;

export const CASTLE_WALL_THICKNESS = 0.6;
/** Taller than `MAX_STEP_UP` in FirstPersonControls so step-up never clears walls. */
export const CASTLE_WALL_HEIGHT = 3.5;
/** Gate gap is 2 × this width on X at the south wall. */
export const CASTLE_GATE_HALF_WIDTH = 1.5;

/** Distance from terrain edge to the center of each non-spawn outpost (north, south, corners). */
export const SAFE_ZONE_OUTPOST_EDGE_CENTER = E;

/**
 * True if (x,z) is within `radius` of any safe-zone castle (spawn + outposts).
 * Used to keep procedural rocks/mountains out of courtyards.
 */
export function isNearAnySafeZoneCastle(
  x: number,
  z: number,
  radius: number,
): boolean {
  if (Math.hypot(x, z) < radius) {
    return true;
  }
  const c: [number, number][] = [
    [0, E],
    [0, -E],
    [-E, E],
    [E, E],
    [-E, -E],
    [E, -E],
  ];
  return c.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < radius);
}

export function isPointInSpawnSafeZone(x: number, z: number): boolean {
  return ALL_SPAWN_SAFE_ZONE_AABBS.some(
    (s) => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ,
  );
}
