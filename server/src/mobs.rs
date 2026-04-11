//! Mobs: Milestone 3 AI — idle / chase / telegraphed attack, aggro + chained pull, safe-zone rules.
//! Milestone 7 **chaos** desert: passive creeps spawn away from castle courtyards; physics extrudes
//! mobs so they never sit inside safe AABBs; players in a safe zone are ignored for aggro/chase.
//! Bosses: tank (heavy shot, spread volley, melee stomp), summoner (summon adds + soul bolts).
//! Authoritative HP lives here + `sim`.

use uuid::Uuid;

use crate::combat::{arrow_hits_vertical_cylinder, point_in_spawn_safe_zone, BOSS_ARROW_SPEED};
use crate::world::{
    hash2, min_distance_to_any_spawn_safe_aabb, resolve_colliders_entity, sample_terrain_height,
    snap_to_ground_with_eye, AabbCollider, BOSS_SUMMONER_X, BOSS_SUMMONER_Z, BOSS_TANK_X, BOSS_TANK_Z,
    SPAWN_SAFE_ZONES, TERRAIN_HALF_SIZE,
};

pub const MOB_RADIUS: f64 = 0.28;
pub const MOB_EYE_HEIGHT: f64 = 0.82;
pub const MOB_HP: f64 = 28.0;
/// High pool; resets when depleted so the courtyard dummy never despawns.
pub const TRAINING_DUMMY_HP: f64 = 10_000.0;
pub const BOSS_TANK_HP: f64 = 900.0;
pub const BOSS_SUMMONER_HP: f64 = 320.0;

pub const MOB_SPEED: f64 = 3.6;
pub const MOB_WANDER_SPEED: f64 = 1.15;
pub const BOSS_TANK_SPEED: f64 = 1.05;
pub const BOSS_SUMMONER_SPEED: f64 = 2.85;

pub const MOB_DAMAGE: f64 = 7.0;
/// Seconds of wind-up before melee damage resolves (telegraph).
pub const MOB_MELEE_WINDUP_S: f64 = 0.38;
/// Recovery after a swing before another wind-up can start.
pub const MOB_MELEE_RECOVER_S: f64 = 0.55;

pub const MOB_STRIKE_RANGE: f64 = 0.92;
pub const MOB_HIT_COOLDOWN_S: f64 = 0.85;

/// Base aggro radius (m) for small creeps; bosses use larger values.
pub const CREEP_AGGRO_BASE: f64 = 10.0;
pub const BOSS_AGGRO_BASE: f64 = 25.0;
pub const AGGRO_EXTENDED_MULT: f64 = 1.8;
/// Chained aggro: fight anchor must be this close (XZ) to this mob.
pub const CHAIN_ANCHOR_RANGE: f64 = 14.0;

pub const BOSS_SHOOT_CD_S: f64 = 2.65;
pub const BOSS_SHOOT_WINDUP_S: f64 = 0.45;
/// Quick triple shot; projectiles are non-heavy (shield soft-blocks only).
pub const BOSS_VOLLEY_WINDUP_S: f64 = 0.32;
pub const BOSS_VOLLEY_CD_S: f64 = 2.15;
pub const BOSS_VOLLEY_SPEED: f64 = 34.0;
pub const BOSS_VOLLEY_SPREAD: f64 = 1.35;
pub const BOSS_STOMP_WINDUP_S: f64 = 0.58;
pub const BOSS_STOMP_CD_S: f64 = 2.9;
pub const BOSS_STOMP_RANGE: f64 = 4.15;
pub const BOSS_STOMP_DAMAGE: f64 = 32.0;
pub const BOSS_SUMMON_CD_S: f64 = 4.2;
pub const BOSS_SUMMON_WINDUP_S: f64 = 0.35;
pub const BOSS_BOLT_WINDUP_S: f64 = 0.28;
pub const BOSS_BOLT_CD_S: f64 = 1.85;
pub const BOSS_BOLT_SPEED: f64 = 40.0;
pub const SUMMON_OFFSET: f64 = 2.8;

/// Engagement memory for chained aggro (player recently hit a same-kind mob near this fight).
pub const ENGAGEMENT_TTL_S: f64 = 4.0;

/// Max creeps on the map at once (bosses + training dummy are not counted).
pub const MAX_MOBS: usize = 512;
/// Passive creep spawns: lower = fills toward [`MAX_MOBS`] faster.
pub const SPAWN_ATTEMPT_INTERVAL_S: f64 = 0.075;
/// Random trials per spawn tick; best trial (deepest **chaos** clearance) wins (Milestone 7).
const CHAOS_SPAWN_TRIALS: u32 = 40;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MobKind {
    Creep,
    TrainingDummy,
    BossTank,
    BossSummoner,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MobMoveState {
    Idle,
    Pursuing,
    MeleeWindup,
    MeleeRecover,
    ShootWindup,
    VolleyWindup,
    StompWindup,
    SummonWindup,
    BoltWindup,
}

pub struct Mob {
    pub id: u32,
    pub kind: MobKind,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub hp: f64,
    pub move_state: MobMoveState,
    pub state_timer: f64,
    pub aggro: Option<Uuid>,
    pub wander_yaw: f64,
    pub wander_timer: f64,
    pub boss_cd: f64,
    /// Rotates boss attack patterns (heavy / volley / stomp or summon / bolt).
    pub boss_attack_idx: u8,
    pub facing_yaw: f64,
    /// Creep melee: time until another telegraphed swing can start.
    pub melee_cd: f64,
}

impl Mob {
    fn sync_y_from_terrain(&mut self) {
        let g = sample_terrain_height(self.x, self.z);
        self.y = g + MOB_EYE_HEIGHT;
    }
}

#[derive(Clone, Debug)]
pub struct MobEngagement {
    pub player: Uuid,
    pub anchor_x: f64,
    pub anchor_z: f64,
    pub kind: MobKind,
    pub ttl_s: f64,
}

pub struct BossArrowPlan {
    pub mob_id: u32,
    pub tx: f64,
    pub ty: f64,
    pub tz: f64,
    pub heavy: bool,
    pub speed: f64,
}

#[inline]
pub fn mob_max_hp(m: &Mob) -> f64 {
    match m.kind {
        MobKind::Creep => MOB_HP,
        MobKind::TrainingDummy => TRAINING_DUMMY_HP,
        MobKind::BossTank => BOSS_TANK_HP,
        MobKind::BossSummoner => BOSS_SUMMONER_HP,
    }
}

fn aggro_base_radius(kind: MobKind) -> f64 {
    match kind {
        MobKind::Creep => CREEP_AGGRO_BASE,
        MobKind::BossTank | MobKind::BossSummoner => BOSS_AGGRO_BASE,
        MobKind::TrainingDummy => 0.0,
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
        move_state: MobMoveState::Idle,
        state_timer: 0.0,
        aggro: None,
        wander_yaw: 0.0,
        wander_timer: 0.0,
        boss_cd: 0.0,
        boss_attack_idx: 0,
        facing_yaw: 0.0,
        melee_cd: 0.0,
    };
    m.sync_y_from_terrain();
    m
}

pub fn spawn_boss_tank(id: u32) -> Mob {
    let mut m = Mob {
        id,
        kind: MobKind::BossTank,
        x: BOSS_TANK_X,
        z: BOSS_TANK_Z,
        y: 0.0,
        hp: BOSS_TANK_HP,
        move_state: MobMoveState::Idle,
        state_timer: 0.0,
        aggro: None,
        wander_yaw: 0.0,
        wander_timer: 0.0,
        boss_cd: BOSS_SHOOT_CD_S * 0.4,
        boss_attack_idx: 0,
        facing_yaw: 0.0,
        melee_cd: 0.0,
    };
    m.sync_y_from_terrain();
    m
}

pub fn spawn_boss_summoner(id: u32) -> Mob {
    let mut m = Mob {
        id,
        kind: MobKind::BossSummoner,
        x: BOSS_SUMMONER_X,
        z: BOSS_SUMMONER_Z,
        y: 0.0,
        hp: BOSS_SUMMONER_HP,
        move_state: MobMoveState::Idle,
        state_timer: 0.0,
        aggro: None,
        wander_yaw: 0.0,
        wander_timer: 0.0,
        boss_cd: BOSS_SUMMON_CD_S * 0.5,
        boss_attack_idx: 0,
        facing_yaw: 0.0,
        melee_cd: 0.0,
    };
    m.sync_y_from_terrain();
    m
}

pub struct MobPlayerHit {
    pub player: Uuid,
    pub damage: f64,
    pub mob_x: f64,
    pub mob_z: f64,
}

pub fn mob_arrow_hit(ax: f64, ay: f64, az: f64, m: &Mob) -> bool {
    arrow_hits_vertical_cylinder(ax, ay, az, m.x, m.y, m.z, MOB_RADIUS)
}

fn extrude_mob_from_aabb(
    x: &mut f64,
    z: &mut f64,
    min_x: f64,
    max_x: f64,
    min_z: f64,
    max_z: f64,
) {
    let px = x.clamp(min_x, max_x);
    let pz = z.clamp(min_z, max_z);
    let dx = *x - px;
    let dz = *z - pz;
    let dist = (dx * dx + dz * dz).sqrt();
    if dist >= MOB_RADIUS - 1e-9 {
        return;
    }
    if dist < 1e-9 {
        let d_left = *x - min_x;
        let d_right = max_x - *x;
        let d_bottom = *z - min_z;
        let d_top = max_z - *z;
        let m = d_left.min(d_right).min(d_bottom).min(d_top);
        if m == d_left {
            *x = min_x - MOB_RADIUS;
        } else if m == d_right {
            *x = max_x + MOB_RADIUS;
        } else if m == d_bottom {
            *z = min_z - MOB_RADIUS;
        } else {
            *z = max_z + MOB_RADIUS;
        }
        return;
    }
    let push = (MOB_RADIUS - dist) / dist;
    *x += dx * push;
    *z += dz * push;
}

/// Push mob so its XZ circle does not overlap any spawn safe AABB.
pub fn extrude_mob_from_spawn_safe_zone(x: &mut f64, z: &mut f64) {
    for _ in 0..16 {
        let mut any = false;
        for &(min_x, max_x, min_z, max_z) in SPAWN_SAFE_ZONES.iter() {
            let before = (*x, *z);
            extrude_mob_from_aabb(x, z, min_x, max_x, min_z, max_z);
            if (*x - before.0).abs() > 1e-12 || (*z - before.1).abs() > 1e-12 {
                any = true;
            }
        }
        if !any {
            break;
        }
    }
}

#[inline]
fn circle_overlaps_any_safe_zone(x: f64, z: f64) -> bool {
    for &(min_x, max_x, min_z, max_z) in SPAWN_SAFE_ZONES.iter() {
        let px = x.clamp(min_x, max_x);
        let pz = z.clamp(min_z, max_z);
        let dx = x - px;
        let dz = z - pz;
        if dx * dx + dz * dz < MOB_RADIUS * MOB_RADIUS - 1e-6 {
            return true;
        }
    }
    false
}

#[inline]
fn spawn_position_valid(x: f64, z: f64) -> bool {
    !circle_overlaps_any_safe_zone(x, z)
}

fn try_spawn_mob(id: u32, world_tick: u64, colliders: &[AabbCollider]) -> Option<Mob> {
    let mut best: Option<Mob> = None;
    let mut best_clear = -1.0_f64;
    for k in 0..CHAOS_SPAWN_TRIALS {
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
            move_state: MobMoveState::Idle,
            state_timer: 0.0,
            aggro: None,
            wander_yaw: hash2(xf + 3.0, zf) * std::f64::consts::TAU,
            wander_timer: 1.5 + hash2(zf, xf) * 2.0,
            boss_cd: 0.0,
            boss_attack_idx: 0,
            facing_yaw: 0.0,
            melee_cd: MOB_HIT_COOLDOWN_S * 0.5,
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
            let c = min_distance_to_any_spawn_safe_aabb(m.x, m.z);
            if c > best_clear {
                best_clear = c;
                best = Some(m);
            }
        }
    }
    best
}

fn dist2_xz(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    let dx = ax - bx;
    let dz = az - bz;
    dx * dx + dz * dz
}

fn pick_aggro_target(
    mx: f64,
    mz: f64,
    kind: MobKind,
    players: &[(Uuid, f64, f64, f64)],
    engagements: &[MobEngagement],
) -> Option<Uuid> {
    if kind == MobKind::TrainingDummy {
        return None;
    }
    let base = aggro_base_radius(kind);
    let ext = base * AGGRO_EXTENDED_MULT;
    let base2 = base * base;
    let ext2 = ext * ext;

    let mut best: Option<(f64, Uuid)> = None;
    for &(pid, px, _, pz) in players {
        if point_in_spawn_safe_zone(px, pz) {
            continue;
        }
        let d2 = dist2_xz(mx, mz, px, pz);
        let mut ok = false;
        if d2 <= base2 {
            ok = true;
        } else if d2 <= ext2 {
            for e in engagements {
                if e.player != pid || e.kind != kind {
                    continue;
                }
                let ad = dist2_xz(mx, mz, e.anchor_x, e.anchor_z);
                if ad <= CHAIN_ANCHOR_RANGE * CHAIN_ANCHOR_RANGE {
                    ok = true;
                    break;
                }
            }
        }
        if ok {
            match best {
                None => best = Some((d2, pid)),
                Some((bd, _)) if d2 < bd => best = Some((d2, pid)),
                _ => {}
            }
        }
    }
    best.map(|(_, id)| id)
}

fn player_by_id<'a>(
    players: &'a [(Uuid, f64, f64, f64)],
    id: Uuid,
) -> Option<(f64, f64, f64)> {
    players
        .iter()
        .find_map(|&(pid, x, y, z)| if pid == id { Some((x, y, z)) } else { None })
}

fn resolve_physics(mob: &mut Mob, colliders: &[AabbCollider]) {
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

fn creep_count(mobs: &[Mob]) -> usize {
    mobs.iter().filter(|m| m.kind == MobKind::Creep).count()
}

fn spawn_creep_minion(id: u32, x: f64, z: f64, colliders: &[AabbCollider]) -> Option<Mob> {
    if !spawn_position_valid(x, z) {
        return None;
    }
    let mut m = Mob {
        id,
        kind: MobKind::Creep,
        x,
        z,
        y: 0.0,
        hp: MOB_HP,
        move_state: MobMoveState::Idle,
        state_timer: 0.0,
        aggro: None,
        wander_yaw: 0.0,
        wander_timer: 2.0,
        boss_cd: 0.0,
        boss_attack_idx: 0,
        facing_yaw: 0.0,
        melee_cd: 0.0,
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
    m.wander_yaw = hash2(m.x + 0.7, m.z - 1.2) * std::f64::consts::TAU;
    if spawn_position_valid(m.x, m.z) {
        Some(m)
    } else {
        None
    }
}

/// Advance mob AI. `pending_arrows` are turned into real arrows in `sim`.
pub fn tick_mobs(
    mobs: &mut Vec<Mob>,
    players: &[(Uuid, f64, f64, f64)],
    engagements: &mut Vec<MobEngagement>,
    dt: f64,
    colliders: &[AabbCollider],
    spawn_timer: &mut f64,
    next_id: &mut u32,
    world_tick: u64,
    pending_arrows: &mut Vec<BossArrowPlan>,
) -> Vec<MobPlayerHit> {
    let dt = dt.clamp(0.0, 0.12);

    for e in engagements.iter_mut() {
        e.ttl_s -= dt;
    }
    engagements.retain(|e| e.ttl_s > 0.0);

    for m in mobs.iter_mut() {
        if m.kind == MobKind::TrainingDummy && m.hp <= 0.0 {
            m.hp = TRAINING_DUMMY_HP;
        }
    }
    mobs.retain(|m| m.hp > 0.0);

    if *spawn_timer >= 0.0 {
        *spawn_timer += dt;
    }
    while *spawn_timer >= SPAWN_ATTEMPT_INTERVAL_S && creep_count(mobs) < MAX_MOBS {
        *spawn_timer -= SPAWN_ATTEMPT_INTERVAL_S;
        if let Some(m) = try_spawn_mob(*next_id, world_tick, colliders) {
            mobs.push(m);
            *next_id = next_id.wrapping_add(1);
        } else {
            break;
        }
    }

    let eligible: Vec<(Uuid, f64, f64, f64)> = players.to_vec();

    let mut hits: Vec<MobPlayerHit> = Vec::new();
    let mut summoned: Vec<Mob> = Vec::new();
    let mut creep_pop = creep_count(mobs);

    for mob in mobs.iter_mut() {
        if mob.kind == MobKind::TrainingDummy {
            mob.sync_y_from_terrain();
            continue;
        }

        mob.boss_cd = (mob.boss_cd - dt).max(0.0);

        let target = pick_aggro_target(mob.x, mob.z, mob.kind, &eligible, engagements);
        mob.aggro = target;

        match mob.kind {
            MobKind::Creep => {
                tick_creep(mob, target, &eligible, dt, colliders, &mut hits);
            }
            MobKind::BossTank => {
                tick_boss_tank(
                    mob,
                    target,
                    &eligible,
                    dt,
                    colliders,
                    pending_arrows,
                    &mut hits,
                );
            }
            MobKind::BossSummoner => {
                if let Some(spawned) = tick_boss_summoner(
                    mob,
                    target,
                    &eligible,
                    dt,
                    colliders,
                    creep_pop,
                    *next_id,
                    world_tick,
                    pending_arrows,
                ) {
                    summoned.push(spawned);
                    creep_pop += 1;
                    *next_id = next_id.wrapping_add(1);
                }
            }
            MobKind::TrainingDummy => {}
        }
    }

    mobs.extend(summoned);

    hits
}

fn tick_creep(
    mob: &mut Mob,
    target: Option<Uuid>,
    eligible: &[(Uuid, f64, f64, f64)],
    dt: f64,
    colliders: &[AabbCollider],
    hits: &mut Vec<MobPlayerHit>,
) {
    mob.melee_cd = (mob.melee_cd - dt).max(0.0);
    match mob.move_state {
        MobMoveState::Idle => {
            if let Some(_pid) = target {
                mob.move_state = MobMoveState::Pursuing;
                mob.state_timer = 0.0;
            } else {
                mob.wander_timer -= dt;
                if mob.wander_timer <= 0.0 {
                    mob.wander_timer = 2.0 + hash2(mob.x, mob.z + f64::from(mob.id)) * 2.5;
                    mob.wander_yaw = hash2(mob.z, mob.x + 3.0) * std::f64::consts::TAU;
                }
                let s = MOB_WANDER_SPEED * dt;
                mob.x += mob.wander_yaw.sin() * s;
                mob.z += -mob.wander_yaw.cos() * s;
                mob.facing_yaw = mob.wander_yaw;
            }
        }
        MobMoveState::Pursuing => {
            if target.is_none() {
                mob.move_state = MobMoveState::Idle;
                mob.state_timer = 0.0;
                mob.wander_timer = 1.0;
                return;
            }
            let pid = target.expect("checked");
            let Some((px, _, pz)) = player_by_id(eligible, pid) else {
                mob.move_state = MobMoveState::Idle;
                return;
            };
            if point_in_spawn_safe_zone(px, pz) {
                mob.move_state = MobMoveState::Idle;
                return;
            }
            let dx = px - mob.x;
            let dz = pz - mob.z;
            let len = (dx * dx + dz * dz).sqrt().max(1e-6);
            mob.facing_yaw = dx.atan2(dz);
            let d = len;
            if d <= MOB_STRIKE_RANGE && mob.melee_cd <= 0.0 {
                mob.move_state = MobMoveState::MeleeWindup;
                mob.state_timer = MOB_MELEE_WINDUP_S;
                return;
            }
            mob.x += (dx / len) * MOB_SPEED * dt;
            mob.z += (dz / len) * MOB_SPEED * dt;
        }
        MobMoveState::MeleeWindup => {
            mob.state_timer -= dt;
            if mob.state_timer <= 0.0 {
                if let Some(pid) = target {
                    if let Some((px, _, pz)) = player_by_id(eligible, pid) {
                        if !point_in_spawn_safe_zone(px, pz) {
                            let d = dist2_xz(mob.x, mob.z, px, pz).sqrt();
                            if d <= MOB_STRIKE_RANGE + 0.12 {
                                hits.push(MobPlayerHit {
                                    player: pid,
                                    damage: MOB_DAMAGE,
                                    mob_x: mob.x,
                                    mob_z: mob.z,
                                });
                            }
                        }
                    }
                }
                mob.melee_cd = MOB_HIT_COOLDOWN_S;
                mob.move_state = MobMoveState::MeleeRecover;
                mob.state_timer = MOB_MELEE_RECOVER_S;
            }
        }
        MobMoveState::MeleeRecover => {
            mob.state_timer -= dt;
            if mob.state_timer <= 0.0 {
                mob.move_state = if target.is_some() {
                    MobMoveState::Pursuing
                } else {
                    MobMoveState::Idle
                };
            }
        }
        _ => {
            mob.move_state = MobMoveState::Idle;
        }
    }
    resolve_physics(mob, colliders);
}

fn tick_boss_tank(
    mob: &mut Mob,
    target: Option<Uuid>,
    eligible: &[(Uuid, f64, f64, f64)],
    dt: f64,
    colliders: &[AabbCollider],
    pending_arrows: &mut Vec<BossArrowPlan>,
    hits: &mut Vec<MobPlayerHit>,
) {
    match mob.move_state {
        MobMoveState::ShootWindup => {
            mob.state_timer -= dt;
            if mob.state_timer <= 0.0 {
                if let Some(pid) = mob.aggro {
                    if let Some((px, py, pz)) = player_by_id(eligible, pid) {
                        if !point_in_spawn_safe_zone(px, pz) {
                            pending_arrows.push(BossArrowPlan {
                                mob_id: mob.id,
                                tx: px,
                                ty: py,
                                tz: pz,
                                heavy: true,
                                speed: BOSS_ARROW_SPEED,
                            });
                        }
                    }
                }
                mob.boss_cd = BOSS_SHOOT_CD_S;
                mob.boss_attack_idx = mob.boss_attack_idx.wrapping_add(1);
                mob.move_state = MobMoveState::Pursuing;
            }
        }
        MobMoveState::VolleyWindup => {
            mob.state_timer -= dt;
            if mob.state_timer <= 0.0 {
                if let Some(pid) = mob.aggro {
                    if let Some((px, py, pz)) = player_by_id(eligible, pid) {
                        if !point_in_spawn_safe_zone(px, pz) {
                            let dx = px - mob.x;
                            let dz = pz - mob.z;
                            let len = (dx * dx + dz * dz).sqrt().max(1e-6);
                            let pxn = dx / len;
                            let pzn = dz / len;
                            let perp_x = -pzn;
                            let perp_z = pxn;
                            for i in -1_i32..=1 {
                                let off = f64::from(i) * BOSS_VOLLEY_SPREAD;
                                pending_arrows.push(BossArrowPlan {
                                    mob_id: mob.id,
                                    tx: px + perp_x * off,
                                    ty: py,
                                    tz: pz + perp_z * off,
                                    heavy: false,
                                    speed: BOSS_VOLLEY_SPEED,
                                });
                            }
                        }
                    }
                }
                mob.boss_cd = BOSS_VOLLEY_CD_S;
                mob.boss_attack_idx = mob.boss_attack_idx.wrapping_add(1);
                mob.move_state = MobMoveState::Pursuing;
            }
        }
        MobMoveState::StompWindup => {
            mob.state_timer -= dt;
            if mob.state_timer <= 0.0 {
                if let Some(pid) = mob.aggro {
                    if let Some((px, _, pz)) = player_by_id(eligible, pid) {
                        if !point_in_spawn_safe_zone(px, pz) {
                            let d = dist2_xz(mob.x, mob.z, px, pz).sqrt();
                            if d <= BOSS_STOMP_RANGE + 0.18 {
                                hits.push(MobPlayerHit {
                                    player: pid,
                                    damage: BOSS_STOMP_DAMAGE,
                                    mob_x: mob.x,
                                    mob_z: mob.z,
                                });
                            }
                        }
                    }
                }
                mob.boss_cd = BOSS_STOMP_CD_S;
                mob.boss_attack_idx = mob.boss_attack_idx.wrapping_add(1);
                mob.move_state = MobMoveState::Pursuing;
            }
        }
        _ => {
            if let Some(pid) = target {
                if let Some((px, _, pz)) = player_by_id(eligible, pid) {
                    if !point_in_spawn_safe_zone(px, pz) {
                        let dx = px - mob.x;
                        let dz = pz - mob.z;
                        let len = (dx * dx + dz * dz).sqrt().max(1e-6);
                        mob.facing_yaw = dx.atan2(dz);
                        mob.x += (dx / len) * BOSS_TANK_SPEED * dt;
                        mob.z += (dz / len) * BOSS_TANK_SPEED * dt;
                    }
                }
                let _ = pid;
            }
            if mob.boss_cd <= 0.0 && target.is_some() {
                if let Some(pid) = target {
                    if let Some((px, _, pz)) = player_by_id(eligible, pid) {
                        if !point_in_spawn_safe_zone(px, pz) {
                            let dist = dist2_xz(mob.x, mob.z, px, pz).sqrt();
                            let stomp_ok = dist <= BOSS_STOMP_RANGE
                                && mob.boss_attack_idx.wrapping_rem(5) == 3;
                            if stomp_ok {
                                mob.move_state = MobMoveState::StompWindup;
                                mob.state_timer = BOSS_STOMP_WINDUP_S;
                            } else if mob.boss_attack_idx % 2 == 0 {
                                mob.move_state = MobMoveState::ShootWindup;
                                mob.state_timer = BOSS_SHOOT_WINDUP_S;
                            } else {
                                mob.move_state = MobMoveState::VolleyWindup;
                                mob.state_timer = BOSS_VOLLEY_WINDUP_S;
                            }
                        }
                    }
                }
            }
        }
    }
    resolve_physics(mob, colliders);
}

fn tick_boss_summoner(
    mob: &mut Mob,
    target: Option<Uuid>,
    eligible: &[(Uuid, f64, f64, f64)],
    dt: f64,
    colliders: &[AabbCollider],
    creep_pop: usize,
    next_id: u32,
    world_tick: u64,
    pending_arrows: &mut Vec<BossArrowPlan>,
) -> Option<Mob> {
    let mut spawned: Option<Mob> = None;
    match mob.move_state {
        MobMoveState::SummonWindup => {
            mob.state_timer -= dt;
            if mob.state_timer <= 0.0 {
                if creep_pop < MAX_MOBS {
                    let a = hash2(f64::from(mob.id), world_tick as f64) * std::f64::consts::TAU;
                    let ox = mob.x + a.cos() * SUMMON_OFFSET;
                    let oz = mob.z + a.sin() * SUMMON_OFFSET;
                    spawned = spawn_creep_minion(next_id, ox, oz, colliders);
                }
                mob.boss_cd = BOSS_SUMMON_CD_S;
                mob.boss_attack_idx = mob.boss_attack_idx.wrapping_add(1);
                mob.move_state = MobMoveState::Pursuing;
            }
        }
        MobMoveState::BoltWindup => {
            mob.state_timer -= dt;
            if mob.state_timer <= 0.0 {
                if let Some(pid) = mob.aggro {
                    if let Some((px, py, pz)) = player_by_id(eligible, pid) {
                        if !point_in_spawn_safe_zone(px, pz) {
                            pending_arrows.push(BossArrowPlan {
                                mob_id: mob.id,
                                tx: px,
                                ty: py,
                                tz: pz,
                                heavy: false,
                                speed: BOSS_BOLT_SPEED,
                            });
                        }
                    }
                }
                mob.boss_cd = BOSS_BOLT_CD_S;
                mob.boss_attack_idx = mob.boss_attack_idx.wrapping_add(1);
                mob.move_state = MobMoveState::Pursuing;
            }
        }
        _ => {
            if let Some(pid) = target {
                if let Some((px, _, pz)) = player_by_id(eligible, pid) {
                    if !point_in_spawn_safe_zone(px, pz) {
                        let dx = px - mob.x;
                        let dz = pz - mob.z;
                        let len = (dx * dx + dz * dz).sqrt().max(1e-6);
                        mob.facing_yaw = dx.atan2(dz);
                        mob.x += (dx / len) * BOSS_SUMMONER_SPEED * dt;
                        mob.z += (dz / len) * BOSS_SUMMONER_SPEED * dt;
                    }
                }
            }
            if mob.boss_cd <= 0.0 && target.is_some() {
                let want_summon = mob.boss_attack_idx % 2 == 0;
                if want_summon && creep_pop < MAX_MOBS {
                    mob.move_state = MobMoveState::SummonWindup;
                    mob.state_timer = BOSS_SUMMON_WINDUP_S;
                } else {
                    mob.move_state = MobMoveState::BoltWindup;
                    mob.state_timer = BOSS_BOLT_WINDUP_S;
                }
            }
        }
    }
    spawned
}

/// Record chained-aggro anchor when a player damages a mob (server calls this).
pub fn push_engagement(
    engagements: &mut Vec<MobEngagement>,
    player: Uuid,
    anchor_x: f64,
    anchor_z: f64,
    kind: MobKind,
) {
    if kind == MobKind::TrainingDummy {
        return;
    }
    engagements.push(MobEngagement {
        player,
        anchor_x,
        anchor_z,
        kind,
        ttl_s: ENGAGEMENT_TTL_S,
    });
}

/// Gold pile + optional token when a mob dies (not training dummy).
pub fn loot_for_death(kind: MobKind, id: u32, salt: u64) -> Option<(u32, bool)> {
    let xf = f64::from(id) + salt as f64 * 0.01;
    match kind {
        MobKind::TrainingDummy => None,
        MobKind::Creep => {
            let g = 2 + (hash2(xf, 3.0) * 4.0).floor() as u32 % 4;
            Some((g, false))
        }
        MobKind::BossTank => {
            let g = 45 + (hash2(xf, 8.0) * 36.0).floor() as u32 % 36;
            let token = hash2(xf + 1.0, 2.0) < 0.28;
            Some((g, token))
        }
        MobKind::BossSummoner => {
            let g = 28 + (hash2(xf, 1.5) * 29.0).floor() as u32 % 28;
            let token = hash2(xf + 2.0, 4.0) < 0.22;
            Some((g, token))
        }
    }
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use crate::world::min_distance_to_any_spawn_safe_aabb;

    use super::*;

    #[test]
    fn loot_creep_gold_in_range() {
        let (g, token) = loot_for_death(MobKind::Creep, 42, 9).unwrap();
        assert!((2..=5).contains(&g));
        assert!(!token);
    }

    #[test]
    fn loot_training_dummy_none() {
        assert!(loot_for_death(MobKind::TrainingDummy, 1, 0).is_none());
    }

    #[test]
    fn aggro_safe_zone_player_ignored() {
        let pid = Uuid::new_v4();
        let players = vec![(pid, 0.5, 2.0, 0.5)];
        let eng = Vec::new();
        let t = pick_aggro_target(20.0, 0.0, MobKind::Creep, &players, &eng);
        assert!(t.is_none());
    }

    #[test]
    fn aggro_extended_requires_chain() {
        let pid = Uuid::new_v4();
        // Creep at origin; player 15 m away: outside 10 m base, inside 18 m extended.
        let players = vec![(pid, 15.0, 2.0, 0.0)];
        assert!(pick_aggro_target(0.0, 0.0, MobKind::Creep, &players, &[]).is_none());
        let eng = vec![MobEngagement {
            player: pid,
            anchor_x: 2.0,
            anchor_z: 0.0,
            kind: MobKind::Creep,
            ttl_s: 3.0,
        }];
        assert_eq!(
            pick_aggro_target(0.0, 0.0, MobKind::Creep, &players, &eng),
            Some(pid)
        );
    }

    #[test]
    fn aggro_base_picks_nearest() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let players = vec![
            (a, 8.0, 2.0, 0.0),
            (b, 9.0, 2.0, 0.0),
        ];
        assert_eq!(
            pick_aggro_target(0.0, 0.0, MobKind::Creep, &players, &[]),
            Some(a)
        );
    }

    #[test]
    fn extrude_keeps_mob_clear_of_safe_zone_aabbs() {
        let mut x = 0.0_f64;
        let mut z = 0.0_f64;
        extrude_mob_from_spawn_safe_zone(&mut x, &mut z);
        assert!(
            min_distance_to_any_spawn_safe_aabb(x, z) + 1e-6 >= MOB_RADIUS,
            "mob disk should not overlap courtyard interior"
        );
    }
}
