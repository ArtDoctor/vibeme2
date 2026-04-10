/**
 * Local kinematic state for the first-person controller. Combat stats (HP,
 * stamina, gold, weapon) are authoritative on the server and mirrored via
 * `SnapshotMsg` — see `docs/TASKS.md` Milestone 2.
 */
export interface PlayerState {
  /** World velocity in m/s. */
  velocity: { x: number; y: number; z: number };
  onGround: boolean;
}
