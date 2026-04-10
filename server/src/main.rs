mod combat;
mod mobs;
mod validate;
mod world;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

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

use crate::combat::{
    arrow_hits_player, damage_after_shield_melee, damage_after_shield_ranged, frontal_dot,
    integrate_arrow, melee_hit_valid, point_in_spawn_safe_zone, spawn_arrow_from_player, Arrow,
    WeaponKind, ARROW_DAMAGE, BOW_MIN_CHARGE, MAX_HP, MAX_STAMINA, MELEE_DAMAGE,
    STAMINA_BLOCK_PER_S, STAMINA_BOW_CHARGE_PER_S, STAMINA_BOW_FIRE, STAMINA_MELEE,
    STAMINA_REGEN_PER_S, SWING_COOLDOWN_S,
};
use crate::mobs::{
    mob_arrow_hit, mob_max_hp, spawn_training_dummy, tick_mobs, MobKind, MobPlayerHit,
};
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
    arrows: Vec<Arrow>,
    next_arrow_id: u32,
    mobs: Vec<crate::mobs::Mob>,
    mob_spawn_timer: f64,
    next_mob_id: u32,
    /** Drained into each broadcast snapshot (damage numbers for clients). */
    damage_floats: Vec<DamageFloatSnapshot>,
    /** Player ids who died this tick (before respawn); drained into snapshots. */
    deaths_this_tick: Vec<Uuid>,
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
    hp: f64,
    stamina: f64,
    gold: u32,
    weapon: WeaponKind,
    blocking: bool,
    bow_charge: f64,
    last_swing: Instant,
    /** Seconds remaining for remote swing animation (decayed in tick loop). */
    swing_visual_s: f64,
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
        #[serde(default)]
        weapon: Option<String>,
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
    hp: f64,
    stamina: f64,
    gold: u32,
    weapon: WeaponKind,
    blocking: bool,
    bow_charge: f64,
    swing_t: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArrowSnapshot {
    id: u32,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MobSnapshot {
    id: u32,
    kind: &'static str,
    max_hp: f64,
    x: f64,
    y: f64,
    z: f64,
    hp: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DamageFloatSnapshot {
    source_id: String,
    x: f64,
    y: f64,
    z: f64,
    amount: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotOut {
    #[serde(rename = "type")]
    msg_type: &'static str,
    tick: u64,
    players: Vec<PlayerSnapshot>,
    arrows: Vec<ArrowSnapshot>,
    mobs: Vec<MobSnapshot>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    damage_floats: Vec<DamageFloatSnapshot>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    deaths: Vec<String>,
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

fn mob_kind_tag(m: &crate::mobs::Mob) -> &'static str {
    match m.kind {
        MobKind::Creep => "creep",
        MobKind::TrainingDummy => "trainingDummy",
    }
}

fn respawn_player(p: &mut Player) {
    p.hp = MAX_HP;
    p.stamina = MAX_STAMINA;
    p.gold = 0;
    p.weapon = WeaponKind::Sword;
    p.blocking = false;
    p.bow_charge = 0.0;
    p.swing_visual_s = 0.0;
    p.x = 0.0;
    p.z = 0.0;
    p.y = spawn_eye_y();
    p.yaw = 0.0;
    p.pitch = 0.0;
}

fn tick_hub_world(h: &mut Hub, dt: f64, world_tick: u64, colliders: &[AabbCollider]) {
    let dt = dt.clamp(0.0, 0.12);
    for p in h.players.values_mut() {
        p.stamina = (p.stamina + STAMINA_REGEN_PER_S * dt).min(MAX_STAMINA);
        if p.blocking && p.weapon == WeaponKind::Shield {
            p.stamina = (p.stamina - STAMINA_BLOCK_PER_S * dt).max(0.0);
        }
        if p.weapon == WeaponKind::Bow && p.bow_charge > 0.05 {
            p.stamina =
                (p.stamina - STAMINA_BOW_CHARGE_PER_S * dt * p.bow_charge).max(0.0);
        }
        p.swing_visual_s = (p.swing_visual_s - dt).max(0.0);
    }

    for a in &mut h.arrows {
        integrate_arrow(a, dt);
    }

    process_arrow_hits(h);

    h.arrows.retain(|a| a.y > -30.0 && a.x.abs() <= 250.0 && a.z.abs() <= 250.0);

    let poses: Vec<(Uuid, f64, f64, f64)> = h
        .players
        .iter()
        .map(|(id, p)| (*id, p.x, p.y, p.z))
        .collect();
    let mob_hits = tick_mobs(
        &mut h.mobs,
        &poses,
        dt,
        colliders,
        &mut h.mob_spawn_timer,
        &mut h.next_mob_id,
        world_tick,
    );
    apply_mob_player_hits(h, mob_hits);
}

fn apply_mob_player_hits(h: &mut Hub, hits: Vec<MobPlayerHit>) {
    for hit in hits {
        let Some(p) = h.players.get_mut(&hit.player) else {
            continue;
        };
        if point_in_spawn_safe_zone(p.x, p.z) {
            continue;
        }
        p.hp = (p.hp - hit.damage).max(0.0);
        if p.hp <= 0.0 {
            h.deaths_this_tick.push(hit.player);
            respawn_player(p);
        }
    }
}

fn resolve_sword_swing(hub: &mut Hub, attacker_id: Uuid) {
    let can = {
        let p = match hub.players.get(&attacker_id) {
            Some(p) => p,
            None => return,
        };
        p.weapon == WeaponKind::Sword
            && p.last_swing.elapsed() >= Duration::from_secs_f64(SWING_COOLDOWN_S)
            && p.stamina >= STAMINA_MELEE
    };
    if !can {
        return;
    }

    let attacker_in_safe = {
        let p = hub.players.get(&attacker_id).unwrap();
        point_in_spawn_safe_zone(p.x, p.z)
    };

    {
        let p = hub.players.get_mut(&attacker_id).unwrap();
        p.stamina -= STAMINA_MELEE;
        p.last_swing = Instant::now();
        p.swing_visual_s = 0.4;
    }

    let (ax, az, ayaw, ay) = {
        let p = hub.players.get(&attacker_id).unwrap();
        (p.x, p.z, p.yaw, p.y)
    };

    let mob_hit_indices: Vec<usize> = hub
        .mobs
        .iter()
        .enumerate()
        .filter_map(|(i, m)| {
            if melee_hit_valid(ax, az, ayaw, ay, m.x, m.z, m.y) {
                Some(i)
            } else {
                None
            }
        })
        .collect();

    for mi in mob_hit_indices {
        let pos = {
            let Some(m) = hub.mobs.get_mut(mi) else {
                continue;
            };
            m.hp -= MELEE_DAMAGE;
            if m.kind == MobKind::TrainingDummy && m.hp <= 0.0 {
                m.hp = crate::mobs::TRAINING_DUMMY_HP;
            }
            (m.x, m.y + 0.35, m.z)
        };
        hub.damage_floats.push(DamageFloatSnapshot {
            source_id: attacker_id.to_string(),
            x: pos.0,
            y: pos.1,
            z: pos.2,
            amount: MELEE_DAMAGE,
        });
    }

    // No PvP melee damage while standing in the spawn safe zone (mobs/dummy still take hits above).
    if attacker_in_safe {
        return;
    }

    let victims: Vec<(Uuid, f64)> = hub
        .players
        .iter()
        .filter_map(|(oid, other)| {
            if *oid == attacker_id {
                return None;
            }
            if point_in_spawn_safe_zone(other.x, other.z) {
                return None;
            }
            if !melee_hit_valid(ax, az, ayaw, ay, other.x, other.z, other.y) {
                return None;
            }
            let vx = ax - other.x;
            let vz = az - other.z;
            let fd = frontal_dot(other.yaw, vx, vz);
            let dmg = damage_after_shield_melee(MELEE_DAMAGE, other.blocking, other.weapon, fd);
            Some((*oid, dmg))
        })
        .collect();

    for (oid, dmg) in victims {
        let pos = hub
            .players
            .get(&oid)
            .map(|t| (t.x, t.y - 0.2, t.z));
        if let Some((fx, fy, fz)) = pos {
            hub.damage_floats.push(DamageFloatSnapshot {
                source_id: attacker_id.to_string(),
                x: fx,
                y: fy,
                z: fz,
                amount: dmg,
            });
        }
        if let Some(t) = hub.players.get_mut(&oid) {
            t.hp = (t.hp - dmg).max(0.0);
            if t.hp <= 0.0 {
                hub.deaths_this_tick.push(oid);
                respawn_player(t);
            }
        }
    }
}

fn resolve_bow_fire(hub: &mut Hub, attacker_id: Uuid) {
    let can = {
        let p = match hub.players.get(&attacker_id) {
            Some(p) => p,
            None => return,
        };
        p.weapon == WeaponKind::Bow
            && p.bow_charge >= BOW_MIN_CHARGE
            && p.stamina >= STAMINA_BOW_FIRE
    };
    if !can {
        return;
    }

    let (x, y, z, yaw, pitch, deals_damage) = {
        let p = hub.players.get(&attacker_id).unwrap();
        let deals_damage = !point_in_spawn_safe_zone(p.x, p.z);
        (p.x, p.y, p.z, p.yaw, p.pitch, deals_damage)
    };

    let id = hub.next_arrow_id;
    hub.next_arrow_id = hub.next_arrow_id.wrapping_add(1);
    let arr = spawn_arrow_from_player(attacker_id, id, x, y, z, yaw, pitch, deals_damage);
    hub.arrows.push(arr);

    if let Some(p) = hub.players.get_mut(&attacker_id) {
        p.stamina -= STAMINA_BOW_FIRE;
    }
}

fn process_arrow_hits(h: &mut Hub) {
    let mut i = 0;
    while i < h.arrows.len() {
        let owner = h.arrows[i].owner;
        let ax = h.arrows[i].x;
        let ay = h.arrows[i].y;
        let az = h.arrows[i].z;
        let heavy = h.arrows[i].heavy;
        let deals_damage = h.arrows[i].deals_damage;

        let mut mob_hit_idx: Option<usize> = None;
        for (mi, m) in h.mobs.iter().enumerate() {
            if mob_arrow_hit(ax, ay, az, m) {
                let allow = deals_damage || m.kind == MobKind::TrainingDummy;
                if allow {
                    mob_hit_idx = Some(mi);
                }
                break;
            }
        }
        if let Some(mi) = mob_hit_idx {
            let pos = {
                let m = &mut h.mobs[mi];
                m.hp -= ARROW_DAMAGE;
                if m.kind == MobKind::TrainingDummy && m.hp <= 0.0 {
                    m.hp = crate::mobs::TRAINING_DUMMY_HP;
                }
                (m.x, m.y + 0.35, m.z)
            };
            h.damage_floats.push(DamageFloatSnapshot {
                source_id: owner.to_string(),
                x: pos.0,
                y: pos.1,
                z: pos.2,
                amount: ARROW_DAMAGE,
            });
            h.arrows.swap_remove(i);
            continue;
        }

        let mut victim: Option<(Uuid, f64)> = None;
        for (pid, p) in &h.players {
            if *pid == owner {
                continue;
            }
            if point_in_spawn_safe_zone(p.x, p.z) {
                continue;
            }
            if arrow_hits_player(ax, ay, az, p.x, p.y, p.z) {
                let vx = ax - p.x;
                let vz = az - p.z;
                let fd = frontal_dot(p.yaw, vx, vz);
                let dmg = damage_after_shield_ranged(
                    ARROW_DAMAGE,
                    heavy,
                    p.blocking,
                    p.weapon,
                    fd,
                );
                victim = Some((*pid, dmg));
                break;
            }
        }

        if let Some((pid, dmg)) = victim {
            if deals_damage {
                let pos = h.players.get(&pid).map(|p| (p.x, p.y - 0.2, p.z));
                if let Some((fx, fy, fz)) = pos {
                    h.damage_floats.push(DamageFloatSnapshot {
                        source_id: owner.to_string(),
                        x: fx,
                        y: fy,
                        z: fz,
                        amount: dmg,
                    });
                }
                if let Some(p) = h.players.get_mut(&pid) {
                    p.hp = (p.hp - dmg).max(0.0);
                    if p.hp <= 0.0 {
                        h.deaths_this_tick.push(pid);
                        respawn_player(p);
                    }
                }
            }
            h.arrows.swap_remove(i);
            continue;
        }
        i += 1;
    }
}

impl Hub {
    fn new() -> Self {
        Self {
            players: HashMap::new(),
            nick_to_id: HashMap::new(),
            sessions: HashMap::new(),
            arrows: Vec::new(),
            next_arrow_id: 1,
            mobs: vec![spawn_training_dummy(1)],
            mob_spawn_timer: 0.0,
            next_mob_id: 2,
            damage_floats: Vec::new(),
            deaths_this_tick: Vec::new(),
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
                hp: MAX_HP,
                stamina: MAX_STAMINA,
                gold: 0,
                weapon: WeaponKind::Sword,
                blocking: false,
                bow_charge: 0.0,
                last_swing: Instant::now()
                    - Duration::from_secs_f64(SWING_COOLDOWN_S + 0.05),
                swing_visual_s: 0.0,
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
        let dt = 1.0_f64 / f64::from(TICK_HZ);
        loop {
            interval.tick().await;
            tick = tick.saturating_add(1);
            let mut hub = tick_state.hub.write().await;
            tick_hub_world(&mut hub, dt, tick, tick_state.colliders.as_slice());
            let damage_floats = std::mem::take(&mut hub.damage_floats);
            let deaths = std::mem::take(&mut hub.deaths_this_tick)
                .into_iter()
                .map(|id| id.to_string())
                .collect::<Vec<_>>();
            let players: Vec<PlayerSnapshot> = hub
                .players
                .iter()
                .map(|(id, p)| {
                    let swing_t = if p.swing_visual_s > 0.0 {
                        (p.swing_visual_s / 0.4).min(1.0)
                    } else {
                        0.0
                    };
                    PlayerSnapshot {
                        id: id.to_string(),
                        nickname: p.nickname.clone(),
                        x: p.x,
                        y: p.y,
                        z: p.z,
                        yaw: p.yaw,
                        pitch: p.pitch,
                        hp: p.hp,
                        stamina: p.stamina,
                        gold: p.gold,
                        weapon: p.weapon,
                        blocking: p.blocking,
                        bow_charge: p.bow_charge,
                        swing_t,
                    }
                })
                .collect();
            let arrows: Vec<ArrowSnapshot> = hub
                .arrows
                .iter()
                .map(|a| ArrowSnapshot {
                    id: a.id,
                    x: a.x,
                    y: a.y,
                    z: a.z,
                    yaw: a.vx.atan2(a.vz),
                })
                .collect();
            let mobs: Vec<MobSnapshot> = hub
                .mobs
                .iter()
                .map(|m| MobSnapshot {
                    id: m.id,
                    kind: mob_kind_tag(m),
                    max_hp: mob_max_hp(m),
                    x: m.x,
                    y: m.y,
                    z: m.z,
                    hp: m.hp,
                })
                .collect();
            drop(hub);
            let msg = SnapshotOut {
                msg_type: "snapshot",
                tick,
                players,
                arrows,
                mobs,
                damage_floats,
                deaths,
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
                            weapon,
                            blocking,
                            bow_charge,
                            swing,
                            fire_arrow,
                            ..
                        } = parsed
                        {
                            let mut h = hub.write().await;
                            {
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
                                match weapon.as_deref() {
                                    None => {}
                                    Some(s) => {
                                        p.weapon = WeaponKind::from_str(s).unwrap_or_default();
                                    }
                                }
                                p.blocking = blocking;
                                p.bow_charge = bow_charge.clamp(0.0, 1.0);
                            }
                            if swing {
                                resolve_sword_swing(&mut h, pid);
                            }
                            if fire_arrow {
                                resolve_bow_fire(&mut h, pid);
                            }
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
