use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct CellKey {
    x: i32,
    z: i32,
}

/// Returns a grid-backed spatial index for nearby-entity queries.
/// Limits: entities are bucketed by center point only, so very large entities may need a more exact broadphase later.
#[derive(Clone, Debug)]
pub struct SpatialIndex {
    cell_size: f64,
    cells: HashMap<CellKey, Vec<usize>>,
}

impl SpatialIndex {
    /// Returns an index built from XZ positions.
    /// Limits: `cell_size` must be positive and tuned to the query radius for good performance.
    pub fn from_positions(cell_size: f64, positions: &[(f64, f64)]) -> Self {
        let safe_cell_size = cell_size.max(1.0);
        let mut cells: HashMap<CellKey, Vec<usize>> = HashMap::new();
        for (index, &(x, z)) in positions.iter().enumerate() {
            cells
                .entry(cell_key(x, z, safe_cell_size))
                .or_default()
                .push(index);
        }
        Self {
            cell_size: safe_cell_size,
            cells,
        }
    }

    /// Returns indices from cells intersecting the requested XZ radius.
    /// Limits: callers should still run an exact distance check if they need a strict circle rather than square cell coverage.
    pub fn query_radius(&self, x: f64, z: f64, radius: f64) -> Vec<usize> {
        let steps = (radius.max(0.0) / self.cell_size).ceil() as i32;
        let center = cell_key(x, z, self.cell_size);
        let mut out = Vec::new();
        for dz in -steps..=steps {
            for dx in -steps..=steps {
                let key = CellKey {
                    x: center.x + dx,
                    z: center.z + dz,
                };
                if let Some(indices) = self.cells.get(&key) {
                    out.extend(indices.iter().copied());
                }
            }
        }
        out
    }
}

fn cell_key(x: f64, z: f64, cell_size: f64) -> CellKey {
    CellKey {
        x: (x / cell_size).floor() as i32,
        z: (z / cell_size).floor() as i32,
    }
}

#[cfg(test)]
mod tests {
    use super::SpatialIndex;

    #[test]
    fn query_radius_returns_only_neighboring_cells() {
        let index = SpatialIndex::from_positions(10.0, &[(2.0, 2.0), (8.0, 0.0), (31.0, 0.0)]);
        let mut hits = index.query_radius(0.0, 0.0, 12.0);
        hits.sort_unstable();
        assert_eq!(hits, vec![0, 1]);
    }
}
