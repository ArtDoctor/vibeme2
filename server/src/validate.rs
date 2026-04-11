//! Authoritative movement clamp + collision (see `docs/ARCHITECTURE.md`).

use crate::world::{resolve_colliders, snap_to_ground, AabbCollider};

/// Half of legacy 7.5 m/s — default running is slower.
const MOVE_SPEED: f64 = 3.75;
/// 3× legacy default — creative locomotion cap.
const CREATIVE_MOVE_SPEED: f64 = 22.5;
const SPEED_BOOST_MULTIPLIER: f64 = 3.0;
const MAX_VERTICAL_SPEED: f64 = 28.0;
const MIN_INPUT_DT_SECS: f64 = 1.0 / 45.0;

pub fn clamp_claimed_position(
    prev: (f64, f64, f64),
    claimed: (f64, f64, f64),
    dt_secs: f64,
    colliders: &[AabbCollider],
    creative: bool,
    flying: bool,
    sprinting: bool,
) -> (f64, f64, f64) {
    if dt_secs <= 0.0 {
        return prev;
    }
    // Small socket jitter can make consecutive packets arrive much faster than the
    // nominal client send cadence, which otherwise causes needless clamp/correct cycles.
    let dt = dt_secs.clamp(MIN_INPUT_DT_SECS, 0.25);
    let flying = creative && flying;
    let speed_multiplier = if sprinting {
        SPEED_BOOST_MULTIPLIER
    } else {
        1.0
    };
    let move_cap = if creative {
        CREATIVE_MOVE_SPEED
    } else {
        MOVE_SPEED
    };

    let mut x = claimed.0;
    let mut y = claimed.1;
    let mut z = claimed.2;

    let dx = x - prev.0;
    let dz = z - prev.2;
    let horiz = (dx * dx + dz * dz).sqrt();
    let max_h = move_cap * speed_multiplier * dt * 1.55;
    if horiz > max_h && horiz > 1e-9 {
        let s = max_h / horiz;
        x = prev.0 + dx * s;
        z = prev.2 + dz * s;
    }

    let dy = y - prev.1;
    let max_v = if flying {
        move_cap * speed_multiplier * dt * 1.55
    } else {
        MAX_VERTICAL_SPEED * dt
    };
    if dy.abs() > max_v {
        y = prev.1 + dy.signum() * max_v;
    }

    resolve_colliders(&mut x, &mut y, &mut z, colliders);
    if !flying {
        snap_to_ground(&mut y, x, z);
    }
    (x, y, z)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::{build_colliders, sample_terrain_height, EYE_HEIGHT};

    #[test]
    fn zero_dt_returns_prev() {
        let colliders = build_colliders();
        let prev = (1.0, 2.5, -3.0);
        let out = clamp_claimed_position(prev, (99.0, 99.0, 99.0), 0.0, &colliders, false, false, false);
        assert!((out.0 - prev.0).abs() < 1e-9);
        assert!((out.1 - prev.1).abs() < 1e-9);
        assert!((out.2 - prev.2).abs() < 1e-9);
    }

    #[test]
    fn tiny_move_from_spawn_is_stable() {
        let colliders = build_colliders();
        let gy = sample_terrain_height(0.0, 0.0);
        let prev = (0.0, gy + EYE_HEIGHT, 0.0);
        let claimed = (0.02, prev.1, 0.02);
        let out =
            clamp_claimed_position(prev, claimed, 0.05, &colliders, false, false, false);
        assert!((out.0 - claimed.0).abs() < 1.0);
        assert!((out.2 - claimed.2).abs() < 1.0);
    }

    #[test]
    fn sprinting_allows_faster_horizontal_claims() {
        let colliders = build_colliders();
        let gy = sample_terrain_height(0.0, 0.0);
        let prev = (0.0, gy + EYE_HEIGHT, 0.0);
        let dt = 0.05;
        let claimed = (MOVE_SPEED * SPEED_BOOST_MULTIPLIER * dt, prev.1, 0.0);
        let walk = clamp_claimed_position(prev, claimed, dt, &colliders, false, false, false);
        let sprint = clamp_claimed_position(prev, claimed, dt, &colliders, false, false, true);
        assert!(sprint.0 > walk.0 + 0.1, "walk={} sprint={}", walk.0, sprint.0);
    }

    #[test]
    fn flying_does_not_snap_back_to_ground() {
        let colliders = build_colliders();
        let gy = sample_terrain_height(0.0, 0.0);
        let prev = (0.0, gy + EYE_HEIGHT, 0.0);
        let claimed = (0.0, prev.1 + 0.04, 0.0);
        let grounded =
            clamp_claimed_position(prev, claimed, 0.05, &colliders, true, false, false);
        let flying = clamp_claimed_position(prev, claimed, 0.05, &colliders, true, true, false);
        assert!(grounded.1 <= gy + EYE_HEIGHT + 1e-9);
        assert!(flying.1 > grounded.1 + 0.01, "grounded={} flying={}", grounded.1, flying.1);
    }

    #[test]
    fn tiny_input_jitter_does_not_overclamp_legit_sprint_step() {
        let colliders = build_colliders();
        let gy = sample_terrain_height(0.0, 0.0);
        let prev = (0.0, gy + EYE_HEIGHT, 0.0);
        let claimed = (0.32, prev.1, 0.0);
        let out = clamp_claimed_position(prev, claimed, 0.008, &colliders, false, false, true);
        assert!(
            out.0 > 0.24,
            "expected jitter floor to keep most of the sprint step, got {}",
            out.0
        );
    }
}
