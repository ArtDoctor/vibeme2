//! Deterministic world data shared with the TypeScript client (`scene/terrain.ts`,
//! `scene/DesertScene.ts`). Colliders must stay in sync — see `docs/ARCHITECTURE.md`.

pub const TERRAIN_HALF_SIZE: f64 = 600.0;
/// Half-extent of each PvP-safe courtyard (matches `SPAWN_SAFE_ZONE_HALF` in `spawnSafeZone.ts`).
pub const SPAWN_SAFE_ZONE_HALF: f64 = 5.0;
/// Inset from the terrain edge for corner/north outposts (matches `SAFE_ZONE_EDGE_INSET`).
pub const SAFE_ZONE_EDGE_INSET: f64 = 15.0;

/// Axis-aligned safe zones `(min_x, max_x, min_z, max_z)` — same layout as `ALL_SPAWN_SAFE_ZONE_AABBS` in `spawnSafeZone.ts`.
/// Fixed boss arenas (flat desert, outside safe castles). See `docs/TASKS.md` Milestone 3.
pub const BOSS_TANK_X: f64 = -155.0;
pub const BOSS_TANK_Z: f64 = 175.0;
pub const BOSS_SUMMONER_X: f64 = 165.0;
pub const BOSS_SUMMONER_Z: f64 = -170.0;

pub const SPAWN_SAFE_ZONES: [(f64, f64, f64, f64); 6] = {
    let h = SPAWN_SAFE_ZONE_HALF;
    let e = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
    [
        (-h, h, -h, h),
        (-h, h, e - h, e + h),
        (-e - h, -e + h, e - h, e + h),
        (e - h, e + h, e - h, e + h),
        (-e - h, -e + h, -e - h, -e + h),
        (e - h, e + h, -e - h, -e + h),
    ]
};

pub const EYE_HEIGHT: f64 = 1.65;
pub const PLAYER_RADIUS: f64 = 0.35;
pub const MAX_STEP_UP: f64 = 0.6;
pub const GROUND_EPSILON: f64 = 0.05;

#[derive(Clone, Copy, Debug)]
pub struct AabbCollider {
    pub min_x: f64,
    pub max_x: f64,
    pub min_z: f64,
    pub max_z: f64,
    pub top_y: f64,
}

#[inline]
pub fn hash2(x: f64, y: f64) -> f64 {
    let s = (x * 127.1 + y * 311.7).sin() * 43758.5453;
    s - s.floor()
}

#[inline]
pub fn sample_terrain_height(x: f64, z: f64) -> f64 {
    const DUNE_AMPLITUDE: f64 = 0.6;
    const DUNE_FREQ_X: f64 = 0.045;
    const DUNE_FREQ_Z: f64 = 0.038;
    const RIPPLE_AMPLITUDE: f64 = 0.18;
    const RIPPLE_FREQ: f64 = 0.22;
    let dunes = (x * DUNE_FREQ_X).sin() * (z * DUNE_FREQ_Z).cos() * DUNE_AMPLITUDE
        + ((x + z) * 0.018).sin() * DUNE_AMPLITUDE * 0.6;
    let ripples = (x * RIPPLE_FREQ + z * 0.13).sin() * RIPPLE_AMPLITUDE * 0.5
        + (z * RIPPLE_FREQ * 0.8 - x * 0.09).cos() * RIPPLE_AMPLITUDE * 0.5;
    dunes + ripples
}

/// Same procedural colliders as `buildDesertScene` in `DesertScene.ts`.
pub fn build_colliders() -> Vec<AabbCollider> {
    let mut colliders: Vec<AabbCollider> = Vec::new();

    const MOUNTAIN_COUNT: i32 = 36;
    for i in 0..MOUNTAIN_COUNT {
        let i_f = f64::from(i);
        let r = 60.0 + hash2(i_f, 11.0) * (TERRAIN_HALF_SIZE - 80.0);
        let a = hash2(i_f, 23.0) * std::f64::consts::PI * 2.0;
        let x = a.cos() * r;
        let z = a.sin() * r;
        let radius = 8.0 + hash2(i_f, 31.0) * 14.0;
        let height = 18.0 + hash2(i_f, 41.0) * 26.0;
        let base_y = sample_terrain_height(x, z);
        colliders.push(AabbCollider {
            min_x: x - radius * 0.65,
            max_x: x + radius * 0.65,
            min_z: z - radius * 0.65,
            max_z: z + radius * 0.65,
            top_y: base_y + height,
        });
    }

    const SMALL_MOUNTAIN_COUNT: i32 = 72;
    for i in 0..SMALL_MOUNTAIN_COUNT {
        let i_f = f64::from(i);
        let x = (hash2(i_f, 71.0) - 0.5) * (TERRAIN_HALF_SIZE * 1.6);
        let z = (hash2(i_f, 83.0) - 0.5) * (TERRAIN_HALF_SIZE * 1.6);
        if near_any_safe_zone_castle(x, z, 32.0) {
            continue;
        }
        let radius = 3.0 + hash2(i_f, 97.0) * 5.0;
        let height = 5.0 + hash2(i_f, 113.0) * 8.0;
        let base_y = sample_terrain_height(x, z);
        colliders.push(AabbCollider {
            min_x: x - radius * 0.6,
            max_x: x + radius * 0.6,
            min_z: z - radius * 0.6,
            max_z: z + radius * 0.6,
            top_y: base_y + height,
        });
    }

    const ROCK_COUNT: i32 = 140;
    for i in 0..ROCK_COUNT {
        let i_f = f64::from(i);
        let x = (hash2(i_f, 5.0) - 0.5) * TERRAIN_HALF_SIZE * 1.7;
        let z = (hash2(i_f, 7.0) - 0.5) * TERRAIN_HALF_SIZE * 1.7;
        if near_any_safe_zone_castle(x, z, 28.0) {
            continue;
        }
        let w = 0.8 + hash2(i_f, 17.0) * 1.6;
        let h = 0.6 + hash2(i_f, 19.0) * 1.4;
        let d = 0.8 + hash2(i_f, 29.0) * 1.6;
        let base_y = sample_terrain_height(x, z);
        colliders.push(AabbCollider {
            min_x: x - w / 2.0,
            max_x: x + w / 2.0,
            min_z: z - d / 2.0,
            max_z: z + d / 2.0,
            top_y: base_y + h,
        });
    }

    let out_e = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
    add_spawn_castle(&mut colliders, 0.0, 0.0);
    add_spawn_castle(&mut colliders, 0.0, out_e);
    add_spawn_castle(&mut colliders, -out_e, out_e);
    add_spawn_castle(&mut colliders, out_e, out_e);
    add_spawn_castle(&mut colliders, -out_e, -out_e);
    add_spawn_castle(&mut colliders, out_e, -out_e);
    colliders
}

/// Matches `isNearAnySafeZoneCastle` in `spawnSafeZone.ts` (procedural clearance).
fn near_any_safe_zone_castle(x: f64, z: f64, radius: f64) -> bool {
    if (x * x + z * z).sqrt() < radius {
        return true;
    }
    let e = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
    for &(cx, cz) in &[(0.0, e), (-e, e), (e, e), (-e, -e), (e, -e)] {
        let dx = x - cx;
        let dz = z - cz;
        if (dx * dx + dz * dz).sqrt() < radius {
            return true;
        }
    }
    false
}

/// `SPAWN_COURTYARD_HALF`, `CASTLE_*` in `world/spawnSafeZone.ts`.
const SPAWN_COURTYARD_HALF: f64 = 5.0;
const CASTLE_WALL_THICKNESS: f64 = 0.6;
const CASTLE_WALL_HEIGHT: f64 = 3.5;
const CASTLE_GATE_HALF_WIDTH: f64 = 1.5;

fn add_spawn_castle(colliders: &mut Vec<AabbCollider>, center_x: f64, center_z: f64) {
    let half = SPAWN_COURTYARD_HALF;
    let t = CASTLE_WALL_THICKNESS;
    let h = CASTLE_WALL_HEIGHT;
    let wall_z_span = 2.0 * half + 2.0 * t;
    let wall_x_span = wall_z_span;

    let mut add_segment = |cx: f64, cz: f64, size_x: f64, size_z: f64| {
        let base_y = sample_terrain_height(cx, cz);
        colliders.push(AabbCollider {
            min_x: cx - size_x / 2.0,
            max_x: cx + size_x / 2.0,
            min_z: cz - size_z / 2.0,
            max_z: cz + size_z / 2.0,
            top_y: base_y + h,
        });
    };

    let east_x = center_x + half + t / 2.0;
    add_segment(east_x, center_z, t, wall_z_span);

    let west_x = center_x - half - t / 2.0;
    add_segment(west_x, center_z, t, wall_z_span);

    let north_z = center_z + half + t / 2.0;
    add_segment(center_x, north_z, wall_x_span, t);

    let south_z = center_z - half - t / 2.0;
    let south_west_outer = center_x - half - t;
    let south_east_outer = center_x + half + t;
    let gate_half = CASTLE_GATE_HALF_WIDTH;
    let south_left_w = (center_x - gate_half) - south_west_outer;
    let south_right_w = south_east_outer - (center_x + gate_half);
    let south_left_cx = (south_west_outer + (center_x - gate_half)) / 2.0;
    let south_right_cx = ((center_x + gate_half) + south_east_outer) / 2.0;
    add_segment(south_left_cx, south_z, south_left_w, t);
    add_segment(south_right_cx, south_z, south_right_w, t);
}

#[inline]
fn clamp(v: f64, min_v: f64, max_v: f64) -> f64 {
    v.clamp(min_v, max_v)
}

/// Circle-vs-AABB separation in XZ (matches `FirstPersonControls.ts`).
pub fn resolve_colliders(px: &mut f64, py: &mut f64, pz: &mut f64, colliders: &[AabbCollider]) {
    resolve_colliders_entity(px, py, pz, colliders, EYE_HEIGHT, PLAYER_RADIUS);
}

/// Same resolver with a custom eye height and XZ circle radius (e.g. small mobs).
pub fn resolve_colliders_entity(
    px: &mut f64,
    py: &mut f64,
    pz: &mut f64,
    colliders: &[AabbCollider],
    eye_height: f64,
    radius: f64,
) {
    let feet_y = *py - eye_height;
    for _ in 0..4 {
        resolve_world_bounds(px, pz);
        for c in colliders {
            if feet_y > c.top_y - 0.05 {
                continue;
            }
            resolve_one_collider(px, pz, c, radius);
        }
    }
}

fn resolve_world_bounds(px: &mut f64, pz: &mut f64) {
    let limit = TERRAIN_HALF_SIZE - 1.0;
    *px = clamp(*px, -limit, limit);
    *pz = clamp(*pz, -limit, limit);
}

fn resolve_one_collider(px: &mut f64, pz: &mut f64, c: &AabbCollider, radius: f64) {
    let cx = clamp(*px, c.min_x, c.max_x);
    let cz = clamp(*pz, c.min_z, c.max_z);
    let dx = *px - cx;
    let dz = *pz - cz;
    let dist = (dx * dx + dz * dz).sqrt();

    if dist >= radius - 1e-6 {
        return;
    }

    if dist > 1e-7 {
        let push = (radius - dist) / dist;
        *px += dx * push;
        *pz += dz * push;
        return;
    }

    let d_min_x = *px - c.min_x;
    let d_max_x = c.max_x - *px;
    let d_min_z = *pz - c.min_z;
    let d_max_z = c.max_z - *pz;
    let mut m = d_min_x;
    let mut ax = -1.0_f64;
    let mut az = 0.0_f64;
    if d_max_x < m {
        m = d_max_x;
        ax = 1.0;
        az = 0.0;
    }
    if d_min_z < m {
        m = d_min_z;
        ax = 0.0;
        az = -1.0;
    }
    if d_max_z < m {
        m = d_max_z;
        ax = 0.0;
        az = 1.0;
    }
    let push = radius + 0.02 - m;
    if push > 0.0 {
        *px += ax * push;
        *pz += az * push;
    }
}

/// Snap feet to terrain and small step-ups (aligned with client behavior).
pub fn snap_to_ground(py: &mut f64, px: f64, pz: f64) {
    snap_to_ground_with_eye(py, px, pz, EYE_HEIGHT);
}

pub fn snap_to_ground_with_eye(py: &mut f64, px: f64, pz: f64, eye_height: f64) {
    let ground_y = sample_terrain_height(px, pz);
    let target_eye_y = ground_y + eye_height;
    let mut feet_y = *py - eye_height;
    if feet_y <= ground_y + GROUND_EPSILON {
        *py = target_eye_y;
        return;
    }
    feet_y = *py - eye_height;
    if feet_y < ground_y && ground_y - feet_y <= MAX_STEP_UP {
        *py = ground_y + eye_height;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terrain_origin_matches_ts_reference() {
        let y = sample_terrain_height(0.0, 0.0);
        assert!(
            (y - 0.09).abs() < 1e-9,
            "keep in sync with src/scene/terrain.test.ts"
        );
    }

    #[test]
    fn hash2_deterministic_and_fractional() {
        let h = hash2(12.7, -3.2);
        assert_eq!(h, hash2(12.7, -3.2));
        assert!((0.0..1.0).contains(&h), "h={h}");
    }

    #[test]
    fn colliders_non_empty() {
        assert!(build_colliders().len() > 220);
    }
}
