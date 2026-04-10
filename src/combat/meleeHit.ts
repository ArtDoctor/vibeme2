import { EYE_HEIGHT } from "../game/constants";
import {
  forwardFromCameraYaw,
  HIT_CYLINDER_HEIGHT,
  MELEE_BOX_FORWARD_MAX,
  MELEE_BOX_FORWARD_MIN,
  MELEE_BOX_HALF_WIDTH,
} from "./constants";

export interface FeetPosition {
  x: number;
  z: number;
  eyeY: number;
}

/**
 * Returns true if `target` lies inside the melee hit box in front of `attacker`.
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
  const y = attacker.yaw;
  const f = forwardFromCameraYaw(y);
  const fDot = dx * f.x + dz * f.z;
  if (fDot < MELEE_BOX_FORWARD_MIN || fDot > MELEE_BOX_FORWARD_MAX) {
    return false;
  }
  const rx = Math.cos(y);
  const rz = Math.sin(y);
  const rDot = dx * rx + dz * rz;
  if (Math.abs(rDot) > MELEE_BOX_HALF_WIDTH) {
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
