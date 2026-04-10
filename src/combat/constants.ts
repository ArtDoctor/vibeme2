/**
 * Combat tuning shared conceptually with `server/src/combat.rs`.
 * Keep numeric gameplay rules in sync when changing either side.
 */

export const MAX_HP = 100;
export const MAX_STAMINA = 100;

/** Horizontal hit radius (matches `PLAYER_RADIUS` / server `PLAYER_RADIUS`). */
export const HIT_CYLINDER_RADIUS = 0.35;

/** Feet-to-head approximate height for cylinder hit tests. */
export const HIT_CYLINDER_HEIGHT = 1.75;

/** Melee reach from attacker feet (XZ plane). */
export const MELEE_RANGE = 1.35;

/** Half-angle of the melee cone in radians (~50°). */
export const MELEE_HALF_ANGLE_RAD = (50 * Math.PI) / 180;

/** Minimum dot(forward, toTarget) for a melee hit (cos of half angle). */
export const MELEE_MIN_FORWARD_DOT = Math.cos(MELEE_HALF_ANGLE_RAD);

/**
 * World-space horizontal forward from camera yaw (Three.js Y rotation, radians).
 * Matches `server/src/combat.rs` `forward_from_yaw`.
 */
export function forwardFromCameraYaw(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: -Math.cos(yaw) };
}
