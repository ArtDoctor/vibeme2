/**
 * Desert heightfield — analytic, deterministic, cheap.
 *
 * The whole world height is one pure function `sampleTerrainHeight(x, z)`.
 * Both the rendering mesh and the player ground-follow read from it, so they
 * cannot drift out of sync.
 *
 * NOTE: heightfield only — no caves, no overhangs. Mountains that need true
 * 3D shapes are added separately as box/cone meshes with AABB colliders in
 * DesertScene.ts. See docs/ARCHITECTURE.md ("Collision model") for limits.
 */

const DUNE_AMPLITUDE = 0.6;
const DUNE_FREQ_X = 0.045;
const DUNE_FREQ_Z = 0.038;
const RIPPLE_AMPLITUDE = 0.18;
const RIPPLE_FREQ = 0.22;

/** Returns the desert ground Y at world (x, z). Slight, dune-like variation. */
export function sampleTerrainHeight(x: number, z: number): number {
  const dunes =
    Math.sin(x * DUNE_FREQ_X) * Math.cos(z * DUNE_FREQ_Z) * DUNE_AMPLITUDE +
    Math.sin((x + z) * 0.018) * DUNE_AMPLITUDE * 0.6;
  const ripples =
    Math.sin(x * RIPPLE_FREQ + z * 0.13) * RIPPLE_AMPLITUDE * 0.5 +
    Math.cos(z * RIPPLE_FREQ * 0.8 - x * 0.09) * RIPPLE_AMPLITUDE * 0.5;
  return dunes + ripples;
}

export const TERRAIN_HALF_SIZE = 200;
export const TERRAIN_SEGMENTS = 160;
