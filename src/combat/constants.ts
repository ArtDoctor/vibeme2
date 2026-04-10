/**
 * Combat tuning shared conceptually with `server/src/combat.rs`.
 * Keep numeric gameplay rules in sync when changing either side.
 */

import type { Camera } from "three";
import { Vector3 } from "three";

const directionScratch = new Vector3();

export const MAX_HP = 100;
export const MAX_STAMINA = 100;

/** Matches `server/src/mobs.rs` `MOB_HP`. */
export const MOB_HP = 28;
/** Matches `server/src/mobs.rs` `TRAINING_DUMMY_HP`. */
export const TRAINING_DUMMY_HP = 10_000;

/** Must match `server/src/combat.rs` `BOW_MIN_CHARGE`. */
export const BOW_MIN_CHARGE = 0.25;

/** Horizontal hit radius (matches `PLAYER_RADIUS` / server `PLAYER_RADIUS`). */
export const HIT_CYLINDER_RADIUS = 0.35;

/** Feet-to-head approximate height for cylinder hit tests. */
export const HIT_CYLINDER_HEIGHT = 1.75;

/** Melee reach from attacker feet (XZ plane). Matches `MELEE_BOX_FORWARD_MAX` on server. */
export const MELEE_RANGE = 1.47;

/**
 * Melee hit box: forward extent from attacker feet (XZ), matches `server/src/combat.rs`.
 * Shifted forward so the strike volume sits clearly ahead of the body.
 */
export const MELEE_BOX_FORWARD_MIN = 0.34;
export const MELEE_BOX_FORWARD_MAX = MELEE_RANGE;
export const MELEE_BOX_HALF_WIDTH = 0.38;

/**
 * World-space horizontal forward from camera yaw (Three.js Y rotation, radians).
 * Matches `server/src/combat.rs` `forward_from_yaw`.
 */
export function forwardFromCameraYaw(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: -Math.cos(yaw) };
}

/**
 * `Object3D.rotation.y` so local +Z aims along combat forward `(sin ψ, -cos ψ)` on XZ.
 * (Three maps local +Z to `(sin r, cos r)`, hence `r = π − ψ`.)
 */
export function avatarRotationYFromCombatYaw(combatYaw: number): number {
  return Math.PI - combatYaw;
}

/**
 * Yaw (radians) for horizontal facing: same convention as `forwardFromCameraYaw` and the server.
 * Uses the camera's true look direction projected onto XZ so Euler `rotation.y` is not used
 * (with default `XYZ` order, pitch changes the relationship between `rotation.y` and bearing).
 */
export function horizontalYawFromCamera(camera: Camera): number {
  camera.getWorldDirection(directionScratch);
  directionScratch.y = 0;
  const lenSq = directionScratch.lengthSq();
  if (lenSq < 1e-10) {
    return camera.rotation.y;
  }
  directionScratch.multiplyScalar(1 / Math.sqrt(lenSq));
  /** Must satisfy `forwardFromCameraYaw(y) === (sin y, -cos y)` on XZ — use `atan2(fx, -fz)`, not `-atan2(fx, fz)`. */
  return Math.atan2(directionScratch.x, -directionScratch.z);
}
