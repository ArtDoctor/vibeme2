//! Authoritative combat rules (Milestone 2). Numbers mirror `src/combat/constants.ts` where applicable.

use uuid::Uuid;

use crate::world::{EYE_HEIGHT, PLAYER_RADIUS};

pub const MAX_HP: f64 = 100.0;
pub const MAX_STAMINA: f64 = 100.0;
pub const MELEE_DAMAGE: f64 = 25.0;
pub const ARROW_DAMAGE: f64 = 18.0;
pub const MELEE_RANGE: f64 = 1.47;
/// Melee hit volume: rectangle in the attacker's forward/right plane (XZ), in front of the body.
pub const MELEE_BOX_FORWARD_MIN: f64 = 0.34;
pub const MELEE_BOX_FORWARD_MAX: f64 = MELEE_RANGE;
pub const MELEE_BOX_HALF_WIDTH: f64 = 0.38;

pub const STAMINA_REGEN_PER_S: f64 = 18.0;
pub const STAMINA_MELEE: f64 = 15.0;
pub const STAMINA_BLOCK_PER_S: f64 = 12.0;
pub const STAMINA_BOW_CHARGE_PER_S: f64 = 8.0;
pub const STAMINA_BOW_FIRE: f64 = 20.0;

pub const SWING_COOLDOWN_S: f64 = 0.45;
pub const BOW_MIN_CHARGE: f64 = 0.25;
pub const ARROW_SPEED: f64 = 42.0;
pub const ARROW_GRAVITY: f64 = 12.0;
pub const HIT_CYLINDER_HEIGHT: f64 = 1.75;

/// Shield + frontal blocks this damage type completely (boss tank projectile — Milestone 3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WeaponKind {
    Sword,
    Shield,
    Bow,
}

impl Default for WeaponKind {
    fn default() -> Self {
        WeaponKind::Sword
    }
}

impl WeaponKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "sword" => Some(WeaponKind::Sword),
            "shield" => Some(WeaponKind::Shield),
            "bow" => Some(WeaponKind::Bow),
            _ => None,
        }
    }
}

#[inline]
pub fn point_in_spawn_safe_zone(x: f64, z: f64) -> bool {
    x >= -5.0 && x <= 5.0 && z >= -5.0 && z <= 5.0
}

/// Matches `forwardFromCameraYaw` in `src/combat/constants.ts`.
#[inline]
pub fn forward_from_yaw(yaw: f64) -> (f64, f64) {
    (yaw.sin(), -yaw.cos())
}

#[inline]
fn feet_y(eye_y: f64) -> f64 {
    eye_y - EYE_HEIGHT
}

/// Vertical overlap of standing hit cylinders (same heights).
fn cylinders_vertical_overlap(eye_a: f64, eye_b: f64) -> bool {
    let fa = feet_y(eye_a);
    let fb = feet_y(eye_b);
    let ta = fa + HIT_CYLINDER_HEIGHT;
    let tb = fb + HIT_CYLINDER_HEIGHT;
    !(tb < fa || fb > ta)
}

pub fn melee_hit_valid(
    ax: f64,
    az: f64,
    a_yaw: f64,
    a_eye_y: f64,
    tx: f64,
    tz: f64,
    t_eye_y: f64,
) -> bool {
    let dx = tx - ax;
    let dz = tz - az;
    let (fx, fz) = forward_from_yaw(a_yaw);
    let f_dot = dx * fx + dz * fz;
    if f_dot < MELEE_BOX_FORWARD_MIN || f_dot > MELEE_BOX_FORWARD_MAX {
        return false;
    }
    let rx = a_yaw.cos();
    let rz = a_yaw.sin();
    let r_dot = dx * rx + dz * rz;
    if r_dot.abs() > MELEE_BOX_HALF_WIDTH {
        return false;
    }
    cylinders_vertical_overlap(a_eye_y, t_eye_y)
}

pub fn frontal_dot(defender_yaw: f64, from_attacker_x: f64, from_attacker_z: f64) -> f64 {
    let (fx, fz) = forward_from_yaw(defender_yaw);
    let len = (from_attacker_x * from_attacker_x + from_attacker_z * from_attacker_z).sqrt();
    if len < 1e-9 {
        return 1.0;
    }
    let nx = from_attacker_x / len;
    let nz = from_attacker_z / len;
    fx * nx + fz * nz
}

/// `from_*` is vector **from defender toward attacker** (XZ), flattened.
pub fn damage_after_shield_melee(
    base: f64,
    blocking: bool,
    weapon: WeaponKind,
    frontal_dot: f64,
) -> f64 {
    if !blocking || weapon != WeaponKind::Shield {
        return base;
    }
    if frontal_dot < 0.35 {
        return base;
    }
    base * 0.3
}

pub fn damage_after_shield_ranged(
    base: f64,
    heavy: bool,
    blocking: bool,
    weapon: WeaponKind,
    frontal_dot: f64,
) -> f64 {
    if blocking && weapon == WeaponKind::Shield && frontal_dot >= 0.35 {
        if heavy {
            return 0.0;
        }
        return base * 0.3;
    }
    base
}

pub struct Arrow {
    pub id: u32,
    pub owner: Uuid,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vx: f64,
    pub vy: f64,
    pub vz: f64,
    /// When true, shield frontal blocks completely (boss heavy shot).
    pub heavy: bool,
    /// When false, arrow still flies but does not apply HP damage (fired from spawn safe zone).
    pub deals_damage: bool,
}

pub fn integrate_arrow(a: &mut Arrow, dt: f64) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.z += a.vz * dt;
    a.vy -= ARROW_GRAVITY * dt;
}

/// Point arrow vs vertical cylinder (XZ circle + Y slab). `flat_radius` is XZ hit radius.
pub fn arrow_hits_vertical_cylinder(
    ax: f64,
    ay: f64,
    az: f64,
    px: f64,
    eye_y: f64,
    pz: f64,
    flat_radius: f64,
) -> bool {
    let dx = px - ax;
    let dz = pz - az;
    if dx * dx + dz * dz > flat_radius * flat_radius * 1.44 {
        return false;
    }
    let feet = feet_y(eye_y);
    ay >= feet - 0.08 && ay <= feet + HIT_CYLINDER_HEIGHT + 0.08
}

/// Point arrow vs vertical cylinder at player feet (XZ circle + Y slab).
pub fn arrow_hits_player(ax: f64, ay: f64, az: f64, px: f64, eye_y: f64, pz: f64) -> bool {
    arrow_hits_vertical_cylinder(ax, ay, az, px, eye_y, pz, PLAYER_RADIUS)
}

pub fn spawn_arrow_from_player(
    owner: Uuid,
    id: u32,
    x: f64,
    eye_y: f64,
    z: f64,
    yaw: f64,
    pitch: f64,
    deals_damage: bool,
) -> Arrow {
    let (fx, fz) = forward_from_yaw(yaw);
    let c = pitch.cos();
    let s = pitch.sin();
    let vx = fx * c;
    let vz = fz * c;
    let vy = -s;
    let len = (vx * vx + vy * vy + vz * vz).sqrt().max(1e-6);
    let vx = vx / len * ARROW_SPEED;
    let vy = vy / len * ARROW_SPEED;
    let vz = vz / len * ARROW_SPEED;
    let hand_y = eye_y - 0.35;
    Arrow {
        id,
        owner,
        x,
        y: hand_y,
        z,
        vx,
        vy,
        vz,
        heavy: false,
        deals_damage,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forward_matches_ts_yaw_zero() {
        let (fx, fz) = forward_from_yaw(0.0);
        assert!((fx - 0.0).abs() < 1e-9);
        assert!((fz - (-1.0)).abs() < 1e-9);
    }

    #[test]
    fn melee_straight_ahead() {
        let eye = 2.0;
        assert!(melee_hit_valid(0.0, 0.0, 0.0, eye, 0.0, -1.0, eye));
    }

    #[test]
    fn melee_behind_misses() {
        let eye = 2.0;
        assert!(!melee_hit_valid(0.0, 0.0, 0.0, eye, 0.0, 1.0, eye));
    }

    #[test]
    fn melee_wide_lateral_misses() {
        let eye = 2.0;
        assert!(!melee_hit_valid(0.0, 0.0, 0.0, eye, 0.55, -1.0, eye));
    }
}
