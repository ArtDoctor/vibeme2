//! Deterministic world data shared with the TypeScript client (`scene/terrain.ts`,
//! `scene/DesertScene.ts`). Colliders must stay in sync — see `docs/ARCHITECTURE.md`.

use crate::team::Team;

pub const TERRAIN_HALF_SIZE: f64 = 600.0;
/// Half-extent of each PvP-safe courtyard (matches `SPAWN_SAFE_ZONE_HALF` in `spawnSafeZone.ts`).
pub const SPAWN_SAFE_ZONE_HALF: f64 = 5.0;
/// Inset from the terrain edge for edge/corner outposts (matches `SAFE_ZONE_EDGE_INSET`).
pub const SAFE_ZONE_EDGE_INSET: f64 = 15.0;

/// Axis-aligned safe zones `(min_x, max_x, min_z, max_z)` — same layout as `ALL_SPAWN_SAFE_ZONE_AABBS` in `spawnSafeZone.ts`.
/// Fixed boss arenas (flat desert, outside safe castles). See `docs/TASKS.md` Milestone 3.
pub const BOSS_TANK_X: f64 = -155.0;
pub const BOSS_TANK_Z: f64 = 175.0;
pub const BOSS_SUMMONER_X: f64 = 165.0;
pub const BOSS_SUMMONER_Z: f64 = -170.0;

pub const SPAWN_SAFE_ZONES: [(f64, f64, f64, f64); 8] = {
    let h = SPAWN_SAFE_ZONE_HALF;
    let e = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
    [
        (-h, h, -h, h),
        (-h, h, e - h, e + h),
        (-e - h, -e + h, e - h, e + h),
        (e - h, e + h, e - h, e + h),
        (-e - h, -e + h, -e - h, -e + h),
        (e - h, e + h, -e - h, -e + h),
        (-h, h, -e - h, -e + h),
        (e - h, e + h, -h, h),
    ]
};

/// North edge safe zone — red team spawn / war camp (matches `TEAM_RED_SAFE_ZONE_INDEX` on the client).
pub const TEAM_RED_SAFE_ZONE_INDEX: usize = 1;
/// South edge safe zone — blue team spawn / war camp.
pub const TEAM_BLUE_SAFE_ZONE_INDEX: usize = 6;
/// East edge safe zone — neutral team spawn / mixed-team truce when rules apply.
pub const TEAM_NEUTRAL_SAFE_ZONE_INDEX: usize = 7;

#[inline]
pub fn safe_zone_index_at(x: f64, z: f64) -> Option<usize> {
    SPAWN_SAFE_ZONES
        .iter()
        .enumerate()
        .find(|(_, &(min_x, max_x, min_z, max_z))| {
            x >= min_x && x <= max_x && z >= min_z && z <= max_z
        })
        .map(|(i, _)| i)
}

/// Shortest distance from `(x,z)` to any spawn safe AABB edge. `0` inside a courtyard; positive
/// in open desert (used by unit tests; passive creeps sample uniformly instead of biasing on this).
#[allow(dead_code)]
#[inline]
pub fn min_distance_to_any_spawn_safe_aabb(x: f64, z: f64) -> f64 {
    let mut best = f64::MAX;
    for &(min_x, max_x, min_z, max_z) in SPAWN_SAFE_ZONES.iter() {
        let cx = x.clamp(min_x, max_x);
        let cz = z.clamp(min_z, max_z);
        let dx = x - cx;
        let dz = z - cz;
        let d = (dx * dx + dz * dz).sqrt();
        if d < best {
            best = d;
        }
    }
    best
}

/// Red/blue home courtyards — PvP allowed between enemies here (not a mixed-team truce yard).
#[inline]
pub fn is_team_war_camp_zone_index(idx: usize) -> bool {
    matches!(idx, i if i == TEAM_RED_SAFE_ZONE_INDEX || i == TEAM_BLUE_SAFE_ZONE_INDEX)
}

/// Disk radius around each enemy war-camp center that the opposing team cannot enter (matches client tint).
pub const ENEMY_WAR_CAMP_EXCLUSION_RADIUS: f64 = 22.0;

#[inline]
pub fn red_war_camp_center_xz() -> (f64, f64) {
    let e = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
    (0.0, e)
}

#[inline]
pub fn blue_war_camp_center_xz() -> (f64, f64) {
    let e = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
    (0.0, -e)
}

/// Pushes `(x, z)` to the disk boundary if inside the enemy team's home territory.
pub fn extrude_from_enemy_war_camps(team: Team, x: &mut f64, z: &mut f64) {
    let r = ENEMY_WAR_CAMP_EXCLUSION_RADIUS;
    match team {
        Team::Neutral => {}
        Team::Red => {
            let (cx, cz) = blue_war_camp_center_xz();
            extrude_from_disk(x, z, cx, cz, r);
        }
        Team::Blue => {
            let (cx, cz) = red_war_camp_center_xz();
            extrude_from_disk(x, z, cx, cz, r);
        }
    }
}

fn extrude_from_disk(x: &mut f64, z: &mut f64, cx: f64, cz: f64, r: f64) {
    let dx = *x - cx;
    let dz = *z - cz;
    let d2 = dx * dx + dz * dz;
    let r2 = r * r;
    if d2 > r2 {
        return;
    }
    if d2 < 1e-18 {
        let to_ox = -cx;
        let to_oz = -cz;
        let len = (to_ox * to_ox + to_oz * to_oz).sqrt().max(1e-9);
        *x = cx + (to_ox / len) * r;
        *z = cz + (to_oz / len) * r;
        return;
    }
    let d = d2.sqrt();
    let s = r / d;
    *x = cx + dx * s;
    *z = cz + dz * s;
}

/// Offset from courtyard center toward the map edge — matches `SHOP_SERVICE_SPOT_OFFSET` in `shops.ts`.
const SHOP_SERVICE_SPOT_OFFSET: f64 = 1.85;

fn shop_service_spot(cx: f64, cz: f64) -> (f64, f64) {
    let h2 = cx * cx + cz * cz;
    if h2 < 1e-8 {
        return (cx, cz + SHOP_SERVICE_SPOT_OFFSET);
    }
    let h = h2.sqrt();
    (
        cx + (cx / h) * SHOP_SERVICE_SPOT_OFFSET,
        cz + (cz / h) * SHOP_SERVICE_SPOT_OFFSET,
    )
}

/// World XZ for shop buy/sell distance checks — `shop_index` matches [`SPAWN_SAFE_ZONES`] order.
pub fn safe_zone_shop_spot_xz(shop_index: usize) -> Option<(f64, f64)> {
    let e = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
    let (cx, cz) = match shop_index {
        0 => (0.0, 0.0),
        1 => (0.0, e),
        2 => (-e, e),
        3 => (e, e),
        4 => (-e, -e),
        5 => (e, -e),
        6 => (0.0, -e),
        7 => (e, 0.0),
        _ => return None,
    };
    Some(shop_service_spot(cx, cz))
}

pub const EYE_HEIGHT: f64 = 1.65;
pub const PLAYER_RADIUS: f64 = 0.35;
pub const MAX_STEP_UP: f64 = 0.6;
pub const GROUND_EPSILON: f64 = 0.05;
const COLLIDER_RESOLVE_ITERATIONS: usize = 6;
const LARGE_MOUNTAIN_COLLIDER_SCALE: f64 = 0.75;
const SMALL_MOUNTAIN_COLLIDER_SCALE: f64 = 0.7;

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
            min_x: x - radius * LARGE_MOUNTAIN_COLLIDER_SCALE,
            max_x: x + radius * LARGE_MOUNTAIN_COLLIDER_SCALE,
            min_z: z - radius * LARGE_MOUNTAIN_COLLIDER_SCALE,
            max_z: z + radius * LARGE_MOUNTAIN_COLLIDER_SCALE,
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
            min_x: x - radius * SMALL_MOUNTAIN_COLLIDER_SCALE,
            max_x: x + radius * SMALL_MOUNTAIN_COLLIDER_SCALE,
            min_z: z - radius * SMALL_MOUNTAIN_COLLIDER_SCALE,
            max_z: z + radius * SMALL_MOUNTAIN_COLLIDER_SCALE,
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
    add_spawn_castle(&mut colliders, 0.0, -out_e);
    add_spawn_castle(&mut colliders, -out_e, out_e);
    add_spawn_castle(&mut colliders, out_e, out_e);
    add_spawn_castle(&mut colliders, -out_e, -out_e);
    add_spawn_castle(&mut colliders, out_e, -out_e);
    add_spawn_castle(&mut colliders, out_e, 0.0);
    add_shop_stall_colliders(&mut colliders);
    colliders
}

fn stall_fwd_from_center(cx: f64, cz: f64) -> (f64, f64) {
    let h2 = cx * cx + cz * cz;
    if h2 < 1e-8 {
        return (0.0, 1.0);
    }
    let h = h2.sqrt();
    (cx / h, cz / h)
}

fn push_stall_obb_wall(
    colliders: &mut Vec<AabbCollider>,
    cx: f64,
    cz: f64,
    y0: f64,
    fx: f64,
    fz: f64,
    rx: f64,
    rz: f64,
    along_fwd: f64,
    along_right: f64,
    half_along_right: f64,
    half_along_fwd: f64,
    height: f64,
) {
    let px = cx + fx * along_fwd + rx * along_right;
    let pz = cz + fz * along_fwd + rz * along_right;
    let corners = [
        (
            px + rx * half_along_right + fx * half_along_fwd,
            pz + rz * half_along_right + fz * half_along_fwd,
        ),
        (
            px - rx * half_along_right + fx * half_along_fwd,
            pz - rz * half_along_right + fz * half_along_fwd,
        ),
        (
            px + rx * half_along_right - fx * half_along_fwd,
            pz + rz * half_along_right - fz * half_along_fwd,
        ),
        (
            px - rx * half_along_right - fx * half_along_fwd,
            pz - rz * half_along_right - fz * half_along_fwd,
        ),
    ];
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_z = f64::INFINITY;
    let mut max_z = f64::NEG_INFINITY;
    for (x, z) in corners {
        min_x = min_x.min(x);
        max_x = max_x.max(x);
        min_z = min_z.min(z);
        max_z = max_z.max(z);
    }
    colliders.push(AabbCollider {
        min_x,
        max_x,
        min_z,
        max_z,
        top_y: y0 + height,
    });
}

/// Matches shop stall meshes in `DesertScene.ts` (`addShopStall`).
fn add_shop_stall_colliders(colliders: &mut Vec<AabbCollider>) {
    let e = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
    let centers = [
        (0.0_f64, 0.0_f64),
        (0.0_f64, e),
        (-e, e),
        (e, e),
        (-e, -e),
        (e, -e),
        (0.0_f64, -e),
        (e, 0.0_f64),
    ];
    for &(cx, cz) in &centers {
        let (fx, fz) = stall_fwd_from_center(cx, cz);
        let rx = -fz;
        let rz = fx;
        let y0 = sample_terrain_height(cx, cz);
        push_stall_obb_wall(colliders, cx, cz, y0, fx, fz, rx, rz, 3.88, 0.0, 1.75, 0.16, 2.75);
        push_stall_obb_wall(colliders, cx, cz, y0, fx, fz, rx, rz, 3.1, -1.62, 0.15, 0.74, 2.55);
        push_stall_obb_wall(colliders, cx, cz, y0, fx, fz, rx, rz, 3.1, 1.62, 0.15, 0.74, 2.55);
        push_stall_obb_wall(colliders, cx, cz, y0, fx, fz, rx, rz, 2.08, 0.0, 1.1, 0.475, 0.94);
    }
}

/// Matches `isNearAnySafeZoneCastle` in `spawnSafeZone.ts` (procedural clearance).
fn near_any_safe_zone_castle(x: f64, z: f64, radius: f64) -> bool {
    if (x * x + z * z).sqrt() < radius {
        return true;
    }
    let e = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
    for &(cx, cz) in &[(0.0, e), (0.0, -e), (e, 0.0), (-e, e), (e, e), (-e, -e), (e, -e)] {
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

#[derive(Clone, Copy)]
enum GateSide {
    North,
    South,
    East,
    West,
}

fn gate_side_for_castle(center_x: f64, center_z: f64) -> GateSide {
    if center_x.abs() < 1e-9 && center_z.abs() < 1e-9 {
        return GateSide::South;
    }
    if center_z.abs() >= center_x.abs() {
        if center_z >= 0.0 {
            GateSide::South
        } else {
            GateSide::North
        }
    } else if center_x >= 0.0 {
        GateSide::West
    } else {
        GateSide::East
    }
}

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

    let gate_side = gate_side_for_castle(center_x, center_z);
    let gate_half = CASTLE_GATE_HALF_WIDTH;

    let east_x = center_x + half + t / 2.0;
    let west_x = center_x - half - t / 2.0;
    let north_z = center_z + half + t / 2.0;
    let south_z = center_z - half - t / 2.0;

    match gate_side {
        GateSide::East => {
            let north_outer = center_z + half + t;
            let south_outer = center_z - half - t;
            let lower_h = (center_z - gate_half) - south_outer;
            let upper_h = north_outer - (center_z + gate_half);
            let lower_cz = (south_outer + (center_z - gate_half)) / 2.0;
            let upper_cz = ((center_z + gate_half) + north_outer) / 2.0;
            add_segment(east_x, lower_cz, t, lower_h);
            add_segment(east_x, upper_cz, t, upper_h);
        }
        _ => add_segment(east_x, center_z, t, wall_z_span),
    }

    match gate_side {
        GateSide::West => {
            let north_outer = center_z + half + t;
            let south_outer = center_z - half - t;
            let lower_h = (center_z - gate_half) - south_outer;
            let upper_h = north_outer - (center_z + gate_half);
            let lower_cz = (south_outer + (center_z - gate_half)) / 2.0;
            let upper_cz = ((center_z + gate_half) + north_outer) / 2.0;
            add_segment(west_x, lower_cz, t, lower_h);
            add_segment(west_x, upper_cz, t, upper_h);
        }
        _ => add_segment(west_x, center_z, t, wall_z_span),
    }

    match gate_side {
        GateSide::North => {
            let west_outer = center_x - half - t;
            let east_outer = center_x + half + t;
            let left_w = (center_x - gate_half) - west_outer;
            let right_w = east_outer - (center_x + gate_half);
            let left_cx = (west_outer + (center_x - gate_half)) / 2.0;
            let right_cx = ((center_x + gate_half) + east_outer) / 2.0;
            add_segment(left_cx, north_z, left_w, t);
            add_segment(right_cx, north_z, right_w, t);
        }
        _ => add_segment(center_x, north_z, wall_x_span, t),
    }

    match gate_side {
        GateSide::South => {
            let west_outer = center_x - half - t;
            let east_outer = center_x + half + t;
            let left_w = (center_x - gate_half) - west_outer;
            let right_w = east_outer - (center_x + gate_half);
            let left_cx = (west_outer + (center_x - gate_half)) / 2.0;
            let right_cx = ((center_x + gate_half) + east_outer) / 2.0;
            add_segment(left_cx, south_z, left_w, t);
            add_segment(right_cx, south_z, right_w, t);
        }
        _ => add_segment(center_x, south_z, wall_x_span, t),
    }
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
    for _ in 0..COLLIDER_RESOLVE_ITERATIONS {
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

    #[test]
    fn safe_zone_index_matches_layout() {
        let e = TERRAIN_HALF_SIZE - SAFE_ZONE_EDGE_INSET;
        assert_eq!(safe_zone_index_at(0.0, 0.0), Some(0));
        assert_eq!(safe_zone_index_at(e, 0.0), Some(TEAM_NEUTRAL_SAFE_ZONE_INDEX));
        assert_eq!(safe_zone_index_at(0.0, e), Some(TEAM_RED_SAFE_ZONE_INDEX));
        assert!(is_team_war_camp_zone_index(TEAM_RED_SAFE_ZONE_INDEX));
        assert!(is_team_war_camp_zone_index(TEAM_BLUE_SAFE_ZONE_INDEX));
        assert!(!is_team_war_camp_zone_index(0));
        assert!(!is_team_war_camp_zone_index(TEAM_NEUTRAL_SAFE_ZONE_INDEX));
    }

    #[test]
    fn chaos_zones_cover_most_of_the_map() {
        let map_area = (2.0 * TERRAIN_HALF_SIZE).powi(2);
        let w = 2.0 * SPAWN_SAFE_ZONE_HALF;
        let safe_area = w * w * (SPAWN_SAFE_ZONES.len() as f64);
        let ratio = safe_area / map_area;
        assert!(
            ratio < 0.002,
            "safe courtyards should be a small fraction of the world (got {ratio})"
        );
    }

    #[test]
    fn min_distance_zero_inside_safe_zone() {
        assert!(min_distance_to_any_spawn_safe_aabb(0.0, 0.0).abs() < 1e-9);
    }

    #[test]
    fn min_distance_positive_deep_in_chaos() {
        let d = min_distance_to_any_spawn_safe_aabb(120.0, -220.0);
        assert!(d > 30.0, "expected far from any courtyard, got {d}");
    }

    #[test]
    fn extrude_pushes_red_out_of_blue_disk() {
        let (cx, cz) = blue_war_camp_center_xz();
        let mut x = cx;
        let mut z = cz;
        extrude_from_enemy_war_camps(crate::team::Team::Red, &mut x, &mut z);
        let dx = x - cx;
        let dz = z - cz;
        let d = (dx * dx + dz * dz).sqrt();
        assert!(
            (d - ENEMY_WAR_CAMP_EXCLUSION_RADIUS).abs() < 1e-6,
            "expected on boundary, got d={d}"
        );
    }

    #[test]
    fn safe_zone_shop_spot_center_stall_matches_ts_offset() {
        let (x, z) = safe_zone_shop_spot_xz(0).expect("index 0");
        assert!(x.abs() < 1e-9);
        assert!((z - 1.85).abs() < 1e-9, "z={z}");
    }

    #[test]
    fn safe_zone_shop_spot_each_index_is_some() {
        for i in 0..SPAWN_SAFE_ZONES.len() {
            assert!(safe_zone_shop_spot_xz(i).is_some(), "index {i}");
        }
        assert!(safe_zone_shop_spot_xz(99).is_none());
    }
}
