/**
 * Spawn castle safe zone — Milestone 1.5 (`docs/TASKS.md`).
 * Server must use this AABB before applying PvP damage, mob aggro, or spawning mobs
 * inside the courtyard. Client uses it only for UI.
 */

export const SPAWN_SAFE_ZONE_AABB = {
  minX: -5,
  maxX: 5,
  minZ: -5,
  maxZ: 5,
} as const;

export type SpawnSafeZoneAabb = typeof SPAWN_SAFE_ZONE_AABB;

/** Half-size of the square courtyard on X and Z (matches `SPAWN_SAFE_ZONE_AABB`). */
export const SPAWN_COURTYARD_HALF = 5;

export const CASTLE_WALL_THICKNESS = 0.6;
/** Taller than `MAX_STEP_UP` in FirstPersonControls so step-up never clears walls. */
export const CASTLE_WALL_HEIGHT = 3.5;
/** Gate gap is 2 × this width on X at the south wall. */
export const CASTLE_GATE_HALF_WIDTH = 1.5;

export function isPointInSpawnSafeZone(x: number, z: number): boolean {
  const s = SPAWN_SAFE_ZONE_AABB;
  return x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ;
}
