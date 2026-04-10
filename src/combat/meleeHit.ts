import { EYE_HEIGHT } from "../game/constants";
import {
  forwardFromCameraYaw,
  HIT_CYLINDER_HEIGHT,
  MELEE_MIN_FORWARD_DOT,
  MELEE_RANGE,
} from "./constants";

export interface FeetPosition {
  x: number;
  z: number;
  eyeY: number;
}

/**
 * Returns true if `target` is within melee cone and range of `attacker`.
 * Pure helper — server runs the authoritative check in Rust.
 */
export function isInMeleeArc(
  attacker: FeetPosition & { yaw: number },
  target: FeetPosition,
): boolean {
  const afx = attacker.x;
  const afz = attacker.z;
  const tfx = target.x;
  const tfz = target.z;
  const dx = tfx - afx;
  const dz = tfz - afz;
  const distSq = dx * dx + dz * dz;
  if (distSq > MELEE_RANGE * MELEE_RANGE) {
    return false;
  }
  if (distSq < 1e-8) {
    return true;
  }
  const inv = 1 / Math.sqrt(distSq);
  const ndx = dx * inv;
  const ndz = dz * inv;
  const f = forwardFromCameraYaw(attacker.yaw);
  const dot = f.x * ndx + f.z * ndz;
  if (dot < MELEE_MIN_FORWARD_DOT) {
    return false;
  }

  const attackerFeetY = attacker.eyeY - EYE_HEIGHT;
  const targetFeetY = target.eyeY - EYE_HEIGHT;
  const aTop = attackerFeetY + HIT_CYLINDER_HEIGHT;
  const tTop = targetFeetY + HIT_CYLINDER_HEIGHT;
  /** Vertical extent overlap of the two standing cylinders. */
  const verticalOverlap = !(tTop < attackerFeetY || targetFeetY > aTop);
  return verticalOverlap;
}
