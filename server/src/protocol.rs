use serde::{Deserialize, Serialize};

/// Returns the first decoded client message from the WebSocket stream.
/// Limits: this is transport-level validation only; gameplay validation happens in `sim.rs`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ClientMsg {
    #[serde(rename = "join")]
    Join {
        nickname: String,
        #[serde(default)]
        session: Option<String>,
    },
    #[serde(rename = "input")]
    Input {
        #[serde(default, rename = "seq")]
        _seq: u64,
        x: f64,
        y: f64,
        z: f64,
        yaw: f64,
        pitch: f64,
        #[serde(default)]
        creative: bool,
        #[serde(default)]
        flying: bool,
        #[serde(default)]
        sprinting: bool,
        #[serde(default)]
        main_hand: Option<String>,
        #[serde(default)]
        off_hand: Option<String>,
        #[serde(default)]
        blocking: bool,
        #[serde(default)]
        bow_charge: f64,
        #[serde(default)]
        swing: bool,
        #[serde(default)]
        fire_arrow: bool,
    },
}

/// Returns the welcome payload for a successfully joined player.
/// Limits: session persistence is in-memory only; reconnects do not survive process restarts.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WelcomeOut {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    pub session: String,
    pub player_id: String,
    pub tick_hz: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_storage_key: Option<&'static str>,
}

/// Returns a user-facing join failure message.
/// Limits: these strings are transport errors, not a stable machine-readable error contract.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinErrorOut {
    #[serde(rename = "type")]
    pub msg_type: &'static str,
    pub message: String,
}
