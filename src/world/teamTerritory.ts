/**
 * Enemy war-camp no-go disks — must match `ENEMY_WAR_CAMP_EXCLUSION_RADIUS` and
 * `red_war_camp_center_xz` / `blue_war_camp_center_xz` in `server/src/world.rs`.
 */

import { TERRAIN_HALF_SIZE } from "../scene/terrain";
import { SAFE_ZONE_EDGE_INSET } from "./spawnSafeZone";
import type { PlayerTeam } from "../net/types";

/** Same as server `ENEMY_WAR_CAMP_EXCLUSION_RADIUS`. */
export const ENEMY_WAR_CAMP_EXCLUSION_RADIUS = 22;

function edgeE(): number {
  return TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
}

export function redWarCampCenterXZ(): { x: number; z: number } {
  return { x: 0, z: edgeE() };
}

export function blueWarCampCenterXZ(): { x: number; z: number } {
  return { x: 0, z: -edgeE() };
}

/**
 * If feet `(x,z)` lie inside the enemy team's exclusion disk, push to the boundary.
 */
export function extrudeFromEnemyWarCamps(
  team: PlayerTeam,
  x: number,
  z: number,
): { x: number; z: number } {
  const r = ENEMY_WAR_CAMP_EXCLUSION_RADIUS;
  if (team === "neutral") {
    return { x, z };
  }
  const target =
    team === "red" ? blueWarCampCenterXZ() : redWarCampCenterXZ();
  return extrudeFromDisk(x, z, target.x, target.z, r);
}

function extrudeFromDisk(
  x: number,
  z: number,
  cx: number,
  cz: number,
  r: number,
): { x: number; z: number } {
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  const r2 = r * r;
  if (d2 > r2) {
    return { x, z };
  }
  if (d2 < 1e-18) {
    const toOx = -cx;
    const toOz = -cz;
    const len = Math.hypot(toOx, toOz) || 1e-9;
    return {
      x: cx + (toOx / len) * r,
      z: cz + (toOz / len) * r,
    };
  }
  const d = Math.sqrt(d2);
  const s = r / d;
  return { x: cx + dx * s, z: cz + dz * s };
}
