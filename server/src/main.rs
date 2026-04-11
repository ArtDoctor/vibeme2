mod combat;
mod interest;
mod items;
mod mobs;
mod protocol;
mod sim;
mod validate;
mod world;

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
use tokio::sync::{broadcast, RwLock};
use tower_http::services::ServeDir;
use tracing::info;
use uuid::Uuid;

use crate::items::inventory_item_kind_from_client;
use crate::protocol::{ClientMsg, JoinErrorOut, WelcomeOut};
use crate::sim::{valid_nickname, InputCommand, SimConfig, Simulation, SnapshotFrame};
use crate::world::{build_colliders, AabbCollider};

const TICK_HZ: u32 = 30;
const SESSION_KEY: &str = "vibeme2.session";

#[derive(Clone)]
struct AppState {
    colliders: Arc<Vec<AabbCollider>>,
    sim: Arc<RwLock<Simulation>>,
    latest_frame: Arc<RwLock<Option<Arc<SnapshotFrame>>>>,
    snapshot_ticks: broadcast::Sender<u64>,
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
    let (snap_tx, _) = broadcast::channel::<u64>(64);
    let state = AppState {
        colliders,
        sim: Arc::new(RwLock::new(Simulation::new(SimConfig::default()))),
        latest_frame: Arc::new(RwLock::new(None)),
        snapshot_ticks: snap_tx.clone(),
    };

    let tick_state = state.clone();
    tokio::spawn(async move {
        let mut tick: u64 = 0;
        let mut interval =
            tokio::time::interval(tokio::time::Duration::from_millis(1000 / TICK_HZ as u64));
        let dt = 1.0_f64 / f64::from(TICK_HZ);
        loop {
            interval.tick().await;
            tick = tick.saturating_add(1);
            let mut sim = tick_state.sim.write().await;
            sim.tick(dt, tick, tick_state.colliders.as_slice());
            let frame = sim.build_snapshot_frame(tick);
            drop(sim);
            let mut latest_frame = tick_state.latest_frame.write().await;
            *latest_frame = Some(Arc::new(frame));
            drop(latest_frame);
            let _ = tick_state.snapshot_ticks.send(tick);
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

async fn ws_upgrade(State(state): State<AppState>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let colliders = state.colliders.clone();
    let sim = state.sim.clone();
    let latest_frame = state.latest_frame.clone();
    let snapshots = state.snapshot_ticks.subscribe();

    let (mut write_half, mut read_half) = socket.split();

    let first = match read_half.next().await {
        Some(Ok(Message::Text(text))) => text.to_string(),
        _ => {
            let _ = write_half.close().await;
            return;
        }
    };

    let msg: ClientMsg = match serde_json::from_str(&first) {
        Ok(msg) => msg,
        Err(_) => {
            send_join_error(&mut write_half, "Invalid join message.").await;
            let _ = write_half.close().await;
            return;
        }
    };

    let (player_id, session_token) = match msg {
        ClientMsg::Join { nickname, session } => {
            match resolve_join(&sim, &mut write_half, nickname, session).await {
                Some(join) => join,
                None => return,
            }
        }
        ClientMsg::Input { .. } | ClientMsg::Shop { .. } => {
            send_join_error(&mut write_half, "First message must be a join.").await;
            let _ = write_half.close().await;
            return;
        }
    };

    let welcome = WelcomeOut {
        msg_type: "welcome",
        session: session_token.to_string(),
        player_id: player_id.to_string(),
        tick_hz: TICK_HZ,
        session_storage_key: Some(SESSION_KEY),
    };
    if let Ok(json) = serde_json::to_string(&welcome) {
        if write_half.send(Message::Text(json.into())).await.is_err() {
            let mut simulation = sim.write().await;
            simulation.remove_player(player_id);
            return;
        }
    }

    let mut snapshot_rx = snapshots;
    let mut last_input_at = Instant::now();

    loop {
        tokio::select! {
            ws_msg = read_half.next() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        let parsed: ClientMsg = match serde_json::from_str(&text) {
                            Ok(msg) => msg,
                            Err(_) => continue,
                        };
                        match parsed {
                            ClientMsg::Input {
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
                                ..
                            } => {
                                let dt = last_input_at.elapsed().as_secs_f64();
                                last_input_at = Instant::now();
                                let input = InputCommand {
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
                                };
                                let mut simulation = sim.write().await;
                                if !simulation.apply_input(player_id, &input, dt, colliders.as_slice())
                                {
                                    break;
                                }
                            }
                            ClientMsg::Shop {
                                shop_index,
                                buy_sku,
                                sell,
                            } => {
                                let mut simulation = sim.write().await;
                                if let Some(sku) = buy_sku {
                                    let _ = simulation.shop_buy(player_id, shop_index, sku.trim());
                                } else if let Some(s) = sell {
                                    if let Some(kind) = inventory_item_kind_from_client(&s.kind) {
                                        let _ = simulation.shop_sell(
                                            player_id,
                                            shop_index,
                                            kind,
                                            s.count,
                                        );
                                    }
                                }
                            }
                            ClientMsg::Join { .. } => {}
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(Message::Ping(payload))) => {
                        if write_half.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
            snapshot = snapshot_rx.recv() => {
                match snapshot {
                    Ok(_) => {
                        let frame = {
                            let latest = latest_frame.read().await;
                            latest.clone()
                        };
                        let Some(frame) = frame else {
                            continue;
                        };
                        let view = frame.for_viewer(player_id);
                        let Ok(json) = serde_json::to_string(&view) else {
                            continue;
                        };
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

    let mut simulation = sim.write().await;
    simulation.remove_player(player_id);
    let _ = write_half.close().await;
}

async fn resolve_join(
    sim: &Arc<RwLock<Simulation>>,
    write_half: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    nickname: String,
    session: Option<String>,
) -> Option<(Uuid, Uuid)> {
    if let Some(raw_session) = session {
        return resolve_session_join(sim, write_half, raw_session).await;
    }
    if !valid_nickname(&nickname) {
        send_join_error(
            write_half,
            "Nickname must be 1-24 characters (letters, digits, _ or -).",
        )
        .await;
        let _ = write_half.close().await;
        return None;
    }

    let mut simulation = sim.write().await;
    match simulation.join_player(nickname.trim().to_string()) {
        Ok(join) => Some(join),
        Err(message) => {
            send_join_error(write_half, &message).await;
            let _ = write_half.close().await;
            None
        }
    }
}

async fn resolve_session_join(
    sim: &Arc<RwLock<Simulation>>,
    write_half: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    raw_session: String,
) -> Option<(Uuid, Uuid)> {
    let session = match Uuid::parse_str(&raw_session) {
        Ok(session) => session,
        Err(_) => {
            send_join_error(write_half, "Invalid session token.").await;
            let _ = write_half.close().await;
            return None;
        }
    };

    let simulation = sim.read().await;
    match simulation.player_by_session(session) {
        Some(player_id) if simulation.has_player(player_id) => Some((player_id, session)),
        _ => {
            send_join_error(
                write_half,
                "Unknown or expired session. Pick a nickname to join.",
            )
            .await;
            let _ = write_half.close().await;
            None
        }
    }
}

async fn send_join_error(
    write_half: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: &str,
) {
    let err = JoinErrorOut {
        msg_type: "joinError",
        message: message.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&err) {
        let _ = write_half.send(Message::Text(json.into())).await;
    }
}
