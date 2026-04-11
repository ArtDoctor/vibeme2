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

/// Parses client join `team` strings (`red` / `blue` / `neutral`, case-insensitive).
pub fn team_from_join_str(raw: &str) -> Option<Team> {
    let s = raw.trim();
    if s.eq_ignore_ascii_case("red") {
        Some(Team::Red)
    } else if s.eq_ignore_ascii_case("blue") {
        Some(Team::Blue)
    } else if s.eq_ignore_ascii_case("neutral") {
        Some(Team::Neutral)
    } else {
        None
    }
}
