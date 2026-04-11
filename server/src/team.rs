//! PvP teams (Milestone 5). Serialized as lowercase strings for JSON.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Team {
    Red,
    Blue,
    Neutral,
}

impl Team {
    /// Same roster membership (no friendly fire within this group).
    #[inline]
    pub fn is_same_side(self, other: Team) -> bool {
        self == other
    }
}
