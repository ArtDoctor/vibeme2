/**
 * Authoritative client-side player state. Will be mirrored server-side once
 * the multiplayer layer exists — see docs/TASKS.md (Multiplayer).
 */
export interface PlayerState {
  /** World velocity in m/s. */
  velocity: { x: number; y: number; z: number };
  onGround: boolean;
}
