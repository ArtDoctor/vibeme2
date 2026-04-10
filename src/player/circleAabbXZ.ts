import type { AABBCollider } from "../scene/DesertScene";
import { PLAYER_RADIUS } from "../game/constants";
import { clamp } from "../utils/math";

/**
 * Circle-vs-axis-aligned box separation in the XZ plane (see `docs/ARCHITECTURE.md`).
 * Used by `FirstPersonControls` and covered by unit tests; server mirrors the same math
 * in Rust (`server/src/world.rs`).
 */

export function clampWorldBoundsXz(
  x: number,
  z: number,
  worldHalfSize: number,
): { x: number; z: number } {
  const limit = worldHalfSize - 1;
  return { x: clamp(x, -limit, limit), z: clamp(z, -limit, limit) };
}

/** One resolution step against a single AABB (XZ only). */
export function resolveCircleAgainstAabbXz(
  px: number,
  pz: number,
  c: Pick<AABBCollider, "minX" | "maxX" | "minZ" | "maxZ">,
  playerRadius: number,
): { x: number; z: number } {
  let x = px;
  let z = pz;
  const cx = clamp(x, c.minX, c.maxX);
  const cz = clamp(z, c.minZ, c.maxZ);
  const dx = x - cx;
  const dz = z - cz;
  const dist = Math.hypot(dx, dz);

  if (dist >= playerRadius - 1e-6) {
    return { x, z };
  }

  if (dist > 1e-7) {
    const push = (playerRadius - dist) / dist;
    x += dx * push;
    z += dz * push;
    return { x, z };
  }

  const dMinX = x - c.minX;
  const dMaxX = c.maxX - x;
  const dMinZ = z - c.minZ;
  const dMaxZ = c.maxZ - z;
  let m = dMinX;
  let ax = -1;
  let az = 0;
  if (dMaxX < m) {
    m = dMaxX;
    ax = 1;
    az = 0;
  }
  if (dMinZ < m) {
    m = dMinZ;
    ax = 0;
    az = -1;
  }
  if (dMaxZ < m) {
    m = dMaxZ;
    ax = 0;
    az = 1;
  }
  const push = playerRadius + 0.02 - m;
  if (push > 0) {
    x += ax * push;
    z += az * push;
  }
  return { x, z };
}

const FEET_ABOVE_COLLIDER_EPS = 0.05;

/**
 * Sub-step loop matching `FirstPersonControls` (four iterations): bounds clamp,
 * then each collider when the feet are not above the obstacle top.
 */
export function iterativelyResolvePlayerXz(
  px: number,
  pz: number,
  feetY: number,
  colliders: readonly AABBCollider[],
  options: {
    playerRadius?: number;
    worldHalfSize: number;
    iterations?: number;
  },
): { x: number; z: number } {
  const playerRadius = options.playerRadius ?? PLAYER_RADIUS;
  const iterations = options.iterations ?? 4;
  let x = px;
  let z = pz;
  for (let iter = 0; iter < iterations; iter += 1) {
    ({ x, z } = clampWorldBoundsXz(x, z, options.worldHalfSize));
    for (const c of colliders) {
      if (feetY > c.topY - FEET_ABOVE_COLLIDER_EPS) continue;
      ({ x, z } = resolveCircleAgainstAabbXz(x, z, c, playerRadius));
    }
  }
  return { x, z };
}
