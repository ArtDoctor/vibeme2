//! Small ambient mobs: spawn outside the spawn safe zone, cannot enter it, and do not
//! pursue or damage players who are inside the safe zone.

use uuid::Uuid;

use crate::combat::{arrow_hits_vertical_cylinder, point_in_spawn_safe_zone};
use crate::world::{
    hash2, resolve_colliders_entity, sample_terrain_height, snap_to_ground_with_eye, AabbCollider,
    TERRAIN_HALF_SIZE,
};

pub const MOB_RADIUS: f64 = 0.28;
pub const MOB_EYE_HEIGHT: f64 = 0.82;
pub const MOB_HP: f64 = 28.0;
/// High pool; resets when depleted so the courtyard dummy never despawns.
pub const TRAINING_DUMMY_HP: f64 = 10_000.0;
pub const MOB_SPEED: f64 = 3.6;
pub const MOB_DAMAGE: f64 = 7.0;
pub const MOB_HIT_RANGE: f64 = 0.88;
pub const MOB_HIT_COOLDOWN_S: f64 = 0.85;
// The world is much larger now, so keep creep density high enough that players
// still encounter enemies within the per-view snapshot radius.
pub const MAX_MOBS: usize = 160;
pub const SPAWN_ATTEMPT_INTERVAL_S: f64 = 0.5;

/// Matches `SPAWN_SAFE_ZONE_AABB` in `src/world/spawnSafeZone.ts`.
const SAFE_MIN_X: f64 = -5.0;
const SAFE_MAX_X: f64 = 5.0;
const SAFE_MIN_Z: f64 = -5.0;
const SAFE_MAX_Z: f64 = 5.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MobKind {
    Creep,
    TrainingDummy,
}

pub struct Mob {
    pub id: u32,
    pub kind: MobKind,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub hp: f64,
    pub hit_cd: f64,
}

impl Mob {
    fn sync_y_from_terrain(&mut self) {
        let g = sample_terrain_height(self.x, self.z);
        self.y = g + MOB_EYE_HEIGHT;
    }
}

#[inline]
pub fn mob_max_hp(m: &Mob) -> f64 {
    match m.kind {
        MobKind::Creep => MOB_HP,
        MobKind::TrainingDummy => TRAINING_DUMMY_HP,
    }
}

/// Fixed spawn-courtyard position; does not use extrude-from-safe-zone (it lives inside the zone).
pub fn spawn_training_dummy(id: u32) -> Mob {
    let mut m = Mob {
        id,
        kind: MobKind::TrainingDummy,
        x: 2.6,
        z: 3.1,
        y: 0.0,
        hp: TRAINING_DUMMY_HP,
        hit_cd: 1_000.0,
    };
    m.sync_y_from_terrain();
    m
}

pub struct MobPlayerHit {
    pub player: Uuid,
    pub damage: f64,
}

pub fn mob_arrow_hit(ax: f64, ay: f64, az: f64, m: &Mob) -> bool {
    arrow_hits_vertical_cylinder(ax, ay, az, m.x, m.y, m.z, MOB_RADIUS)
}

/// Push mob so its XZ circle does not overlap the spawn safe AABB.
pub fn extrude_mob_from_spawn_safe_zone(x: &mut f64, z: &mut f64) {
    let px = x.clamp(SAFE_MIN_X, SAFE_MAX_X);
    let pz = z.clamp(SAFE_MIN_Z, SAFE_MAX_Z);
    let dx = *x - px;
    let dz = *z - pz;
    let dist = (dx * dx + dz * dz).sqrt();
    if dist >= MOB_RADIUS - 1e-9 {
        return;
    }
    if dist < 1e-9 {
        let d_left = *x - SAFE_MIN_X;
        let d_right = SAFE_MAX_X - *x;
        let d_bottom = *z - SAFE_MIN_Z;
        let d_top = SAFE_MAX_Z - *z;
        let m = d_left.min(d_right).min(d_bottom).min(d_top);
        if m == d_left {
            *x = SAFE_MIN_X - MOB_RADIUS;
        } else if m == d_right {
            *x = SAFE_MAX_X + MOB_RADIUS;
        } else if m == d_bottom {
            *z = SAFE_MIN_Z - MOB_RADIUS;
        } else {
            *z = SAFE_MAX_Z + MOB_RADIUS;
        }
        return;
    }
    let push = (MOB_RADIUS - dist) / dist;
    *x += dx * push;
    *z += dz * push;
}

#[inline]
fn spawn_position_valid(x: f64, z: f64) -> bool {
    let px = x.clamp(SAFE_MIN_X, SAFE_MAX_X);
    let pz = z.clamp(SAFE_MIN_Z, SAFE_MAX_Z);
    let dx = x - px;
    let dz = z - pz;
    dx * dx + dz * dz >= MOB_RADIUS * MOB_RADIUS - 1e-6
}

fn try_spawn_mob(id: u32, world_tick: u64, colliders: &[AabbCollider]) -> Option<Mob> {
    for k in 0..32_u32 {
        let s = world_tick
            .wrapping_mul(1_103_515_245)
            .wrapping_add(u64::from(k).wrapping_mul(12_345))
            .wrapping_add(u64::from(id).wrapping_mul(97));
        let xf = s as f64 * 0.25;
        let zf = (s >> 17) as f64 * 0.31;
        let x = (hash2(xf, 2.0) - 0.5) * 2.0 * (TERRAIN_HALF_SIZE - 28.0);
        let z = (hash2(zf, 5.0) - 0.5) * 2.0 * (TERRAIN_HALF_SIZE - 28.0);
        if !spawn_position_valid(x, z) {
            continue;
        }
        let mut m = Mob {
            id,
            kind: MobKind::Creep,
            x,
            z,
            y: 0.0,
            hp: MOB_HP,
            hit_cd: MOB_HIT_COOLDOWN_S * 0.5,
        };
        m.sync_y_from_terrain();
        extrude_mob_from_spawn_safe_zone(&mut m.x, &mut m.z);
        m.sync_y_from_terrain();
        resolve_colliders_entity(
            &mut m.x,
            &mut m.y,
            &mut m.z,
            colliders,
            MOB_EYE_HEIGHT,
            MOB_RADIUS,
        );
        snap_to_ground_with_eye(&mut m.y, m.x, m.z, MOB_EYE_HEIGHT);
        extrude_mob_from_spawn_safe_zone(&mut m.x, &mut m.z);
        m.sync_y_from_terrain();
        if spawn_position_valid(m.x, m.z) {
            return Some(m);
        }
    }
    None
}

fn nearest_target(mx: f64, mz: f64, players: &[(Uuid, f64, f64, f64)]) -> Option<(f64, f64)> {
    let mut best: Option<(f64, f64, f64)> = None;
    for &(_, px, _, pz) in players {
        let dx = px - mx;
        let dz = pz - mz;
        let d2 = dx * dx + dz * dz;
        match best {
            None => best = Some((d2, px, pz)),
            Some((bd, _, _)) if d2 < bd => best = Some((d2, px, pz)),
            _ => {}
        }
    }
    best.map(|(_, x, z)| (x, z))
}

pub fn tick_mobs(
    mobs: &mut Vec<Mob>,
    players: &[(Uuid, f64, f64, f64)],
    dt: f64,
    colliders: &[AabbCollider],
    spawn_timer: &mut f64,
    next_id: &mut u32,
    world_tick: u64,
) -> Vec<MobPlayerHit> {
    let dt = dt.clamp(0.0, 0.12);
    for m in mobs.iter_mut() {
        if m.kind == MobKind::TrainingDummy && m.hp <= 0.0 {
            m.hp = TRAINING_DUMMY_HP;
        }
    }
    mobs.retain(|m| m.hp > 0.0);
    *spawn_timer += dt;
    while *spawn_timer >= SPAWN_ATTEMPT_INTERVAL_S
        && mobs.iter().filter(|m| m.kind == MobKind::Creep).count() < MAX_MOBS
    {
        *spawn_timer -= SPAWN_ATTEMPT_INTERVAL_S;
        if let Some(m) = try_spawn_mob(*next_id, world_tick, colliders) {
            mobs.push(m);
            *next_id = next_id.wrapping_add(1);
        } else {
            break;
        }
    }

    let mut hits: Vec<MobPlayerHit> = Vec::new();

    for mob in mobs.iter_mut() {
        if mob.kind == MobKind::TrainingDummy {
            continue;
        }
        mob.hit_cd = (mob.hit_cd - dt).max(0.0);
    }

    let eligible: Vec<(Uuid, f64, f64, f64)> = players
        .iter()
        .copied()
        .filter(|&(_, x, _, z)| !point_in_spawn_safe_zone(x, z))
        .collect();

    for mob in mobs.iter_mut() {
        if mob.kind == MobKind::TrainingDummy {
            mob.sync_y_from_terrain();
            continue;
        }
        if let Some((tx, tz)) = nearest_target(mob.x, mob.z, &eligible) {
            let dx = tx - mob.x;
            let dz = tz - mob.z;
            let len = (dx * dx + dz * dz).sqrt().max(1e-6);
            mob.x += (dx / len) * MOB_SPEED * dt;
            mob.z += (dz / len) * MOB_SPEED * dt;
        }
        mob.sync_y_from_terrain();
        extrude_mob_from_spawn_safe_zone(&mut mob.x, &mut mob.z);
        mob.sync_y_from_terrain();
        resolve_colliders_entity(
            &mut mob.x,
            &mut mob.y,
            &mut mob.z,
            colliders,
            MOB_EYE_HEIGHT,
            MOB_RADIUS,
        );
        snap_to_ground_with_eye(&mut mob.y, mob.x, mob.z, MOB_EYE_HEIGHT);
        extrude_mob_from_spawn_safe_zone(&mut mob.x, &mut mob.z);
        mob.sync_y_from_terrain();
    }

    for mob in mobs.iter_mut() {
        if mob.kind == MobKind::TrainingDummy {
            continue;
        }
        if mob.hit_cd > 0.0 {
            continue;
        }
        for &(pid, px, _, pz) in &eligible {
            let dx = px - mob.x;
            let dz = pz - mob.z;
            if dx * dx + dz * dz > MOB_HIT_RANGE * MOB_HIT_RANGE {
                continue;
            }
            mob.hit_cd = MOB_HIT_COOLDOWN_S;
            hits.push(MobPlayerHit {
                player: pid,
                damage: MOB_DAMAGE,
            });
            break;
        }
    }

    hits
}
