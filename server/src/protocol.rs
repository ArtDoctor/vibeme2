use serde::{Deserialize, Serialize};

use crate::team::Team;

/// Returns the first decoded client message from the WebSocket stream.
/// Limits: this is transport-level validation only; gameplay validation happens in `sim.rs`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShopSellIn {
    pub kind: String,
    pub count: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ClientMsg {
    #[serde(rename = "join")]
    Join {
        nickname: String,
        #[serde(default)]
        session: Option<String>,
        /// Required for a fresh join (`session` absent): `red`, `blue`, or `neutral`.
        #[serde(default)]
        team: Option<String>,
    },
    #[serde(rename = "shop")]
    Shop {
        #[serde(rename = "shopIndex")]
        shop_index: usize,
        #[serde(default)]
        #[serde(rename = "buySku")]
        buy_sku: Option<String>,
        #[serde(default)]
        sell: Option<ShopSellIn>,
    },
    #[serde(rename = "chat")]
    Chat { text: String },
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
        #[serde(rename = "mainHand")]
        main_hand: Option<String>,
        #[serde(default)]
        #[serde(rename = "offHand")]
        off_hand: Option<String>,
        #[serde(default)]
        blocking: bool,
        #[serde(default)]
        #[serde(rename = "bowCharge")]
        bow_charge: f64,
        #[serde(default)]
        swing: bool,
        #[serde(default)]
        #[serde(rename = "fireArrow")]
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
    pub team: Team,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_shop_buy_from_camel_case_json() {
        let msg = serde_json::from_str::<ClientMsg>(
            r#"{"type":"shop","shopIndex":7,"buySku":"ironSword"}"#,
        )
        .expect("shop buy should parse");

        match msg {
            ClientMsg::Shop {
                shop_index,
                buy_sku,
                sell,
            } => {
                assert_eq!(shop_index, 7);
                assert_eq!(buy_sku.as_deref(), Some("ironSword"));
                assert!(sell.is_none());
            }
            other => panic!("expected shop message, got {other:?}"),
        }
    }

    #[test]
    fn parses_input_optional_camel_case_fields() {
        let msg = serde_json::from_str::<ClientMsg>(
            r#"{
                "type":"input",
                "seq":1,
                "x":1.0,
                "y":2.0,
                "z":3.0,
                "yaw":0.25,
                "pitch":-0.5,
                "creative":true,
                "flying":false,
                "sprinting":true,
                "mainHand":"ironSword",
                "offHand":"basicShield",
                "blocking":true,
                "bowCharge":0.75,
                "swing":true,
                "fireArrow":true
            }"#,
        )
        .expect("input should parse");

        match msg {
            ClientMsg::Input {
                _seq,
                x,
                y,
                z,
                yaw,
                pitch,
                creative,
                flying,
                sprinting,
                main_hand,
                off_hand,
                blocking,
                bow_charge,
                swing,
                fire_arrow,
            } => {
                assert_eq!(_seq, 1);
                assert_eq!((x, y, z), (1.0, 2.0, 3.0));
                assert_eq!((yaw, pitch), (0.25, -0.5));
                assert!(creative);
                assert!(!flying);
                assert!(sprinting);
                assert_eq!(main_hand.as_deref(), Some("ironSword"));
                assert_eq!(off_hand.as_deref(), Some("basicShield"));
                assert!(blocking);
                assert_eq!(bow_charge, 0.75);
                assert!(swing);
                assert!(fire_arrow);
            }
            other => panic!("expected input message, got {other:?}"),
        }
    }
}
