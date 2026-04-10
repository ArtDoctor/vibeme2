mod validate;
mod world;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};
use tower_http::services::ServeDir;
use tracing::info;
use uuid::Uuid;

use crate::validate::clamp_claimed_position;
use crate::world::{build_colliders, sample_terrain_height, AabbCollider, EYE_HEIGHT};

const TICK_HZ: u32 = 20;
const SESSION_KEY: &str = "vibeme2.session";

#[derive(Clone)]
struct AppState {
    colliders: Arc<Vec<AabbCollider>>,
    hub: Arc<RwLock<Hub>>,
    snapshots: broadcast::Sender<String>,
}

struct Hub {
    players: HashMap<Uuid, Player>,
    /** Lowercase nickname -> player id (connected players only). */
    nick_to_id: HashMap<String, Uuid>,
    /** Session token -> player id (for reconnect). */
    sessions: HashMap<Uuid, Uuid>,
}

struct Player {
    nickname: String,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
    pitch: f64,
    last_update: Instant,
    session: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum ClientMsg {
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
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WelcomeOut {
    #[serde(rename = "type")]
    msg_type: &'static str,
    session: String,
    player_id: String,
    tick_hz: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_storage_key: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JoinErrorOut {
    #[serde(rename = "type")]
    msg_type: &'static str,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerSnapshot {
    id: String,
    nickname: String,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
    pitch: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotOut {
    #[serde(rename = "type")]
    msg_type: &'static str,
    tick: u64,
    players: Vec<PlayerSnapshot>,
}

fn valid_nickname(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() || t.len() > 24 {
        return false;
    }
    t.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn spawn_eye_y() -> f64 {
    sample_terrain_height(0.0, 0.0) + EYE_HEIGHT
}

impl Hub {
    fn new() -> Self {
        Self {
            players: HashMap::new(),
            nick_to_id: HashMap::new(),
            sessions: HashMap::new(),
        }
    }

    fn join_player(&mut self, nickname: String) -> Result<(Uuid, Uuid), String> {
        let key = nickname.to_lowercase();
        if self.nick_to_id.contains_key(&key) {
            return Err("That nickname is already in use.".to_string());
        }
        let id = Uuid::new_v4();
        let session = Uuid::new_v4();
        let y = spawn_eye_y();
        self.players.insert(
            id,
            Player {
                nickname: nickname.clone(),
                x: 0.0,
                y,
                z: 0.0,
                yaw: 0.0,
                pitch: 0.0,
                last_update: Instant::now(),
                session,
            },
        );
        self.nick_to_id.insert(key, id);
        self.sessions.insert(session, id);
        Ok((id, session))
    }

    fn player_by_session(&self, session: Uuid) -> Option<Uuid> {
        self.sessions.get(&session).copied()
    }

    fn remove_player(&mut self, id: Uuid) {
        if let Some(p) = self.players.remove(&id) {
            self.sessions.remove(&p.session);
            self.nick_to_id.remove(&p.nickname.to_lowercase());
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let colliders = Arc::new(build_colliders());
    let (snap_tx, _) = broadcast::channel::<String>(64);
    let state = AppState {
        colliders,
        hub: Arc::new(RwLock::new(Hub::new())),
        snapshots: snap_tx.clone(),
    };

    let tick_state = state.clone();
    tokio::spawn(async move {
        let mut tick: u64 = 0;
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(1000 / TICK_HZ as u64));
        loop {
            interval.tick().await;
            tick = tick.saturating_add(1);
            let hub = tick_state.hub.read().await;
            let players: Vec<PlayerSnapshot> = hub
                .players
                .iter()
                .map(|(id, p)| PlayerSnapshot {
                    id: id.to_string(),
                    nickname: p.nickname.clone(),
                    x: p.x,
                    y: p.y,
                    z: p.z,
                    yaw: p.yaw,
                    pitch: p.pitch,
                })
                .collect();
            drop(hub);
            let msg = SnapshotOut {
                msg_type: "snapshot",
                tick,
                players,
            };
            if let Ok(json) = serde_json::to_string(&msg) {
                let _ = tick_state.snapshots.send(json);
            }
        }
    });

    let static_root: PathBuf = std::env::var("STATIC_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("dist"));

    info!(?static_root, "serving static files");

    let app = Router::new()
        .route("/ws", get(ws_upgrade))
        .fallback_service(ServeDir::new(static_root))
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("listening on http://{addr} (WebSocket /ws)");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

async fn ws_upgrade(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let colliders = state.colliders.clone();
    let hub = state.hub.clone();
    let snapshots = state.snapshots.subscribe();

    let (mut write_half, mut read_half) = socket.split();

    // First message must be join (or we close).
    let first = match read_half.next().await {
        Some(Ok(Message::Text(t))) => t.to_string(),
        _ => {
            let _ = write_half.close().await;
            return;
        }
    };

    let msg: ClientMsg = match serde_json::from_str(&first) {
        Ok(m) => m,
        Err(_) => {
            let err = JoinErrorOut {
                msg_type: "joinError",
                message: "Invalid join message.".to_string(),
            };
            if let Ok(j) = serde_json::to_string(&err) {
                let _ = write_half.send(Message::Text(j.into())).await;
            }
            let _ = write_half.close().await;
            return;
        }
    };

    let (pid, session_token) = match msg {
        ClientMsg::Join { nickname, session } => {
            if let Some(s) = session {
                if let Ok(token) = Uuid::parse_str(&s) {
                    let h = hub.read().await;
                    match h.player_by_session(token) {
                        Some(player_id) if h.players.contains_key(&player_id) => {
                            (player_id, token)
                        }
                        _ => {
                            let err = JoinErrorOut {
                                msg_type: "joinError",
                                message: "Unknown or expired session. Pick a nickname to join."
                                    .to_string(),
                            };
                            if let Ok(j) = serde_json::to_string(&err) {
                                let _ = write_half.send(Message::Text(j.into())).await;
                            }
                            let _ = write_half.close().await;
                            return;
                        }
                    }
                } else {
                    let err = JoinErrorOut {
                        msg_type: "joinError",
                        message: "Invalid session token.".to_string(),
                    };
                    if let Ok(j) = serde_json::to_string(&err) {
                        let _ = write_half.send(Message::Text(j.into())).await;
                    }
                    let _ = write_half.close().await;
                    return;
                }
            } else if valid_nickname(&nickname) {
                let mut h = hub.write().await;
                match h.join_player(nickname.trim().to_string()) {
                    Ok(pair) => pair,
                    Err(e) => {
                        let err = JoinErrorOut {
                            msg_type: "joinError",
                            message: e,
                        };
                        if let Ok(j) = serde_json::to_string(&err) {
                            let _ = write_half.send(Message::Text(j.into())).await;
                        }
                        let _ = write_half.close().await;
                        return;
                    }
                }
            } else {
                let err = JoinErrorOut {
                    msg_type: "joinError",
                    message: "Nickname must be 1–24 characters (letters, digits, _ or -)."
                        .to_string(),
                };
                if let Ok(j) = serde_json::to_string(&err) {
                    let _ = write_half.send(Message::Text(j.into())).await;
                }
                let _ = write_half.close().await;
                return;
            }
        }
        _ => {
            let err = JoinErrorOut {
                msg_type: "joinError",
                message: "First message must be a join.".to_string(),
            };
            if let Ok(j) = serde_json::to_string(&err) {
                let _ = write_half.send(Message::Text(j.into())).await;
            }
            let _ = write_half.close().await;
            return;
        }
    };

    let welcome = WelcomeOut {
        msg_type: "welcome",
        session: session_token.to_string(),
        player_id: pid.to_string(),
        tick_hz: TICK_HZ,
        session_storage_key: Some(SESSION_KEY),
    };
    if let Ok(j) = serde_json::to_string(&welcome) {
        if write_half.send(Message::Text(j.into())).await.is_err() {
            let mut h = hub.write().await;
            h.remove_player(pid);
            return;
        }
    }

    let mut snapshot_rx = snapshots;

    loop {
        tokio::select! {
            ws_msg = read_half.next() => {
                match ws_msg {
                    Some(Ok(Message::Text(t))) => {
                        let parsed: ClientMsg = match serde_json::from_str(&t) {
                            Ok(m) => m,
                            Err(_) => continue,
                        };
                        if let ClientMsg::Input {
                            x,
                            y,
                            z,
                            yaw,
                            pitch,
                            ..
                        } = parsed
                        {
                            let mut h = hub.write().await;
                            let Some(p) = h.players.get_mut(&pid) else {
                                break;
                            };
                            let prev = (p.x, p.y, p.z);
                            let dt = p.last_update.elapsed().as_secs_f64();
                            p.last_update = Instant::now();
                            let (nx, ny, nz) =
                                clamp_claimed_position(prev, (x, y, z), dt, colliders.as_slice());
                            p.x = nx;
                            p.y = ny;
                            p.z = nz;
                            p.yaw = yaw;
                            p.pitch = pitch;
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(Message::Ping(p))) => {
                        if write_half.send(Message::Pong(p)).await.is_err() {
                            break;
                        }
                    }
                    Some(Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
            snap = snapshot_rx.recv() => {
                match snap {
                    Ok(json) => {
                        if write_half.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    let mut h = hub.write().await;
    h.remove_player(pid);
    let _ = write_half.close().await;
}
