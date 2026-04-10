//! Authoritative movement clamp + collision (see `docs/ARCHITECTURE.md`).

use crate::world::{resolve_colliders, snap_to_ground, AabbCollider};

const MOVE_SPEED: f64 = 7.5;
const MAX_VERTICAL_SPEED: f64 = 28.0;

pub fn clamp_claimed_position(
    prev: (f64, f64, f64),
    claimed: (f64, f64, f64),
    dt_secs: f64,
    colliders: &[AabbCollider],
) -> (f64, f64, f64) {
    let dt = dt_secs.clamp(0.0, 0.25);
    if dt <= 0.0 {
        return prev;
    }

    let mut x = claimed.0;
    let mut y = claimed.1;
    let mut z = claimed.2;

    let dx = x - prev.0;
    let dz = z - prev.2;
    let horiz = (dx * dx + dz * dz).sqrt();
    let max_h = MOVE_SPEED * dt * 1.55;
    if horiz > max_h && horiz > 1e-9 {
        let s = max_h / horiz;
        x = prev.0 + dx * s;
        z = prev.2 + dz * s;
    }

    let dy = y - prev.1;
    let max_v = MAX_VERTICAL_SPEED * dt;
    if dy.abs() > max_v {
        y = prev.1 + dy.signum() * max_v;
    }

    resolve_colliders(&mut x, &mut y, &mut z, colliders);
    snap_to_ground(&mut y, x, z);
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
        let out = clamp_claimed_position(prev, (99.0, 99.0, 99.0), 0.0, &colliders);
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
        let out = clamp_claimed_position(prev, claimed, 0.05, &colliders);
        assert!((out.0 - claimed.0).abs() < 1.0);
        assert!((out.2 - claimed.2).abs() < 1.0);
    }
}
