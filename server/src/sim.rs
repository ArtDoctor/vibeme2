use std::collections::{HashMap, HashSet};

use serde::Serialize;
use uuid::Uuid;

use crate::combat::{
    arrow_hits_player, damage_after_armor, damage_after_shield_melee,
    damage_after_shield_ranged, frontal_dot, integrate_arrow, melee_hit_valid,
    point_in_spawn_safe_zone, spawn_arrow_from_player, spawn_boss_projectile, Arrow, WeaponKind,
    ARROW_DAMAGE, BOW_MIN_CHARGE, MAX_HP, MAX_STAMINA, STAMINA_BLOCK_PER_S,
    STAMINA_BOW_CHARGE_PER_S, STAMINA_BOW_FIRE, STAMINA_MELEE, STAMINA_REGEN_PER_S,
    SWING_COOLDOWN_S,
};
use crate::interest::SpatialIndex;
use crate::items::{
    armor_piece_inventory_kind, default_main_hand_from_inventory, inventory_item_for_main_hand,
    inventory_item_for_off_hand, melee_damage_for_main_hand, sell_price_gold,
    ArmorPieceKind, ArmorSlots, EquipmentState, InventoryEntry, InventoryItemKind, InventoryState,
    MainHandKind, OffHandKind, PickupKind,
};
use crate::mobs::{
    loot_for_death, mob_arrow_hit, mob_max_hp, push_engagement, spawn_boss_summoner,
    spawn_boss_tank, spawn_training_dummy, tick_mobs, BossArrowPlan, Mob, MobEngagement, MobKind,
    MobPlayerHit, TRAINING_DUMMY_HP,
};
use crate::validate::clamp_claimed_position;
use crate::world::{
    sample_terrain_height, safe_zone_shop_spot_xz, AabbCollider, EYE_HEIGHT,
};

const PLAYER_VISIBILITY_RADIUS: f64 = 65.0;
const MOB_VISIBILITY_RADIUS: f64 = 70.0;
const ARROW_VISIBILITY_RADIUS: f64 = 75.0;
const DAMAGE_EVENT_VISIBILITY_RADIUS: f64 = 80.0;
const PICKUP_VISIBILITY_RADIUS: f64 = 78.0;
const PICKUP_RADIUS: f64 = 1.25;
const PICKUP_RESPAWN_S: f64 = 4.0;

/// One stall per PvP-safe courtyard — indices match client `ALL_SPAWN_SAFE_ZONE_AABBS` / `safe_zone_shop_spot_xz`.
const SHOP_INTERACT_RADIUS: f64 = 3.85;

#[derive(Clone, Copy)]
struct ShopOffer {
    sku: &'static str,
    item: InventoryItemKind,
    price: u32,
    needs_boss: bool,
}

/// Traveler stalls: spawn, north edge, south edge — iron tier and essentials only.
const SHOP_OFFERS_BASIC: &[ShopOffer] = &[
    ShopOffer {
        sku: "ironSword",
        item: InventoryItemKind::IronSword,
        price: 42,
        needs_boss: false,
    },
    ShopOffer {
        sku: "basicShield",
        item: InventoryItemKind::BasicShield,
        price: 32,
        needs_boss: false,
    },
    ShopOffer {
        sku: "shortBow",
        item: InventoryItemKind::ShortBow,
        price: 52,
        needs_boss: false,
    },
    ShopOffer {
        sku: "scoutHelm",
        item: InventoryItemKind::ScoutHelm,
        price: 18,
        needs_boss: false,
    },
    ShopOffer {
        sku: "scoutChest",
        item: InventoryItemKind::ScoutChest,
        price: 26,
        needs_boss: false,
    },
    ShopOffer {
        sku: "scoutLegs",
        item: InventoryItemKind::ScoutLegs,
        price: 20,
        needs_boss: false,
    },
];

/// Corner outposts — steel, vanguard, full selection (Milestone 4).
const SHOP_OFFERS_ADVANCED: &[ShopOffer] = &[
    ShopOffer {
        sku: "ironSword",
        item: InventoryItemKind::IronSword,
        price: 38,
        needs_boss: false,
    },
    ShopOffer {
        sku: "steelSword",
        item: InventoryItemKind::SteelSword,
        price: 92,
        needs_boss: false,
    },
    ShopOffer {
        sku: "vanguardSword",
        item: InventoryItemKind::VanguardSword,
        price: 185,
        needs_boss: true,
    },
    ShopOffer {
        sku: "basicShield",
        item: InventoryItemKind::BasicShield,
        price: 29,
        needs_boss: false,
    },
    ShopOffer {
        sku: "shortBow",
        item: InventoryItemKind::ShortBow,
        price: 48,
        needs_boss: false,
    },
    ShopOffer {
        sku: "scoutHelm",
        item: InventoryItemKind::ScoutHelm,
        price: 16,
        needs_boss: false,
    },
    ShopOffer {
        sku: "scoutChest",
        item: InventoryItemKind::ScoutChest,
        price: 24,
        needs_boss: false,
    },
    ShopOffer {
        sku: "scoutLegs",
        item: InventoryItemKind::ScoutLegs,
        price: 18,
        needs_boss: false,
    },
];

/// Indices `2..=5` are the four corner safe zones (see `spawnSafeZone.ts` order).
#[inline]
fn shop_is_advanced(shop_index: usize) -> bool {
    matches!(shop_index, 2..=5)
}

fn shop_offers_for(shop_index: usize) -> &'static [ShopOffer] {
    if shop_is_advanced(shop_index) {
        SHOP_OFFERS_ADVANCED
    } else {
        SHOP_OFFERS_BASIC
    }
}

fn shop_offer_for(shop_index: usize, sku: &str) -> Option<&'static ShopOffer> {
    let key = sku.trim();
    shop_offers_for(shop_index)
        .iter()
        .find(|o| o.sku == key)
}

#[inline]
fn pickup_gold_is_zero(n: &u32) -> bool {
    *n == 0
}

#[inline]
fn pickup_item_count_is_zero(n: &u16) -> bool {
    *n == 0
}

#[inline]
fn death_loot_offset(index: u32) -> (f64, f64) {
    let a = index as f64 * 1.47;
    (a.cos() * 0.55, a.sin() * 0.55)
}

/// Returns boot-time simulation options for world setup and automated tests.
/// Limits: these flags only control initial content and passive spawning; runtime content systems still mutate state directly.
#[derive(Clone, Copy, Debug)]
pub struct SimConfig {
    pub spawn_training_dummy: bool,
    pub auto_spawn_creeps: bool,
    pub spawn_world_bosses: bool,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            spawn_training_dummy: true,
            auto_spawn_creeps: true,
            spawn_world_bosses: true,
        }
    }
}

/// Returns the latest player intent to apply to the authoritative simulation.
/// Limits: movement `input_dt_secs` must be supplied by the trusted socket loop; this struct itself carries no timing guarantees.
#[derive(Clone, Debug)]
pub struct InputCommand {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub yaw: f64,
    pub pitch: f64,
    pub creative: bool,
    pub flying: bool,
    pub sprinting: bool,
    pub main_hand: Option<String>,
    pub off_hand: Option<String>,
    pub blocking: bool,
    pub bow_charge: f64,
    pub swing: bool,
    pub fire_arrow: bool,
}

struct Player {
    nickname: String,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
    pitch: f64,
    session: Uuid,
    hp: f64,
    stamina: f64,
    gold: u32,
    inventory: InventoryState,
    equipment: EquipmentState,
    blocking: bool,
    bow_charge: f64,
    swing_cooldown_s: f64,
    /// Seconds remaining for remote swing animation.
    swing_visual_s: f64,
    /// Unlocks boss-tier shop gear for this session (persists across death).
    boss_unlock: bool,
}

#[derive(Clone)]
struct Pickup {
    id: u32,
    kind: PickupKind,
    slot: u32,
    x: f64,
    y: f64,
    z: f64,
    /// Gold pieces when `kind == Gold`; otherwise 0.
    gold_amount: u32,
    /// When `kind == Item`, which stack is on the ground.
    item_kind: Option<InventoryItemKind>,
    item_count: u16,
}

/// Returns a transport-ready full-world snapshot for all connected clients.
/// Limits: this is still a broadcast-all payload with no interest management or delta compression.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotOut {
    #[serde(rename = "type")]
    msg_type: &'static str,
    tick: u64,
    players: Vec<PlayerSnapshot>,
    arrows: Vec<ArrowSnapshot>,
    pickups: Vec<PickupSnapshot>,
    mobs: Vec<MobSnapshot>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    damage_floats: Vec<DamageFloatSnapshot>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    deaths: Vec<String>,
}

#[derive(Clone, Serialize)]
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
    main_hand: MainHandKind,
    off_hand: Option<OffHandKind>,
    armor: ArmorSlots,
    inventory: Vec<InventoryEntry>,
    weapon: WeaponKind,
    blocking: bool,
    bow_charge: f64,
    swing_t: f64,
    boss_unlock: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArrowSnapshot {
    id: u32,
    x: f64,
    y: f64,
    z: f64,
    yaw: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PickupSnapshot {
    id: u32,
    kind: PickupKind,
    x: f64,
    y: f64,
    z: f64,
    #[serde(default, skip_serializing_if = "pickup_gold_is_zero")]
    gold_amount: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    item_kind: Option<InventoryItemKind>,
    #[serde(default, skip_serializing_if = "pickup_item_count_is_zero")]
    item_count: u16,
}

#[derive(Clone, Serialize)]
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DamageFloatSnapshot {
    source_id: String,
    x: f64,
    y: f64,
    z: f64,
    amount: f64,
}

/// Returns one authoritative world frame that can be filtered into a per-client view.
/// Limits: it still holds full-world data in memory for the current tick; only network fan-out is filtered.
#[derive(Clone)]
pub struct SnapshotFrame {
    tick: u64,
    players: Vec<PlayerSnapshot>,
    arrows: Vec<ArrowSnapshot>,
    pickups: Vec<PickupSnapshot>,
    mobs: Vec<MobSnapshot>,
    damage_floats: Vec<DamageFloatSnapshot>,
    deaths: Vec<String>,
    player_lookup: HashMap<String, usize>,
    player_index: SpatialIndex,
    arrow_index: SpatialIndex,
    pickup_index: SpatialIndex,
    mob_index: SpatialIndex,
    damage_index: SpatialIndex,
    damage_by_source: HashMap<String, Vec<usize>>,
}

/// Returns the authoritative game world plus connected-player/session bookkeeping.
/// Limits: state is process-local and single-world only; no persistence or sharding yet.
pub struct Simulation {
    config: SimConfig,
    players: HashMap<Uuid, Player>,
    nick_to_id: HashMap<String, Uuid>,
    sessions: HashMap<Uuid, Uuid>,
    arrows: Vec<Arrow>,
    pickups: Vec<Pickup>,
    next_arrow_id: u32,
    next_pickup_id: u32,
    mobs: Vec<Mob>,
    mob_spawn_timer: f64,
    pickup_spawn_timer: f64,
    next_mob_id: u32,
    mob_engagements: Vec<MobEngagement>,
    loot_salt: u64,
    damage_floats: Vec<DamageFloatSnapshot>,
    deaths_this_tick: Vec<Uuid>,
}

/// Returns whether the raw nickname is allowed for a fresh join.
/// Limits: validation is ASCII-only and does not reserve profane or impersonation-prone names.
pub fn valid_nickname(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 24 {
        return false;
    }
    trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn spawn_eye_y() -> f64 {
    sample_terrain_height(0.0, 0.0) + EYE_HEIGHT
}

fn active_weapon_from_main_hand(kind: MainHandKind) -> WeaponKind {
    match kind {
        MainHandKind::WoodenSword
        | MainHandKind::IronSword
        | MainHandKind::SteelSword
        | MainHandKind::VanguardSword => WeaponKind::Sword,
        MainHandKind::ShortBow => WeaponKind::Bow,
    }
}

fn mob_kind_tag(mob: &Mob) -> &'static str {
    match mob.kind {
        MobKind::Creep => "creep",
        MobKind::TrainingDummy => "trainingDummy",
        MobKind::BossTank => "bossTank",
        MobKind::BossSummoner => "bossSummoner",
    }
}

fn pickup_target_count(kind: PickupKind) -> u32 {
    match kind {
        // Ring layout in `pickup_slot_position`: 10 / 10 / 5 slots on the first ring each.
        // Shops and mob drops still exist; world rings give discoverable gear away from safe zones.
        PickupKind::Shield => 10,
        PickupKind::Bow => 10,
        PickupKind::Armor => 5,
        PickupKind::Gold | PickupKind::GearToken | PickupKind::Item => 0,
    }
}

fn pickup_slot_position(kind: PickupKind, slot: u32) -> (f64, f64) {
    let (per_ring, base_radius, radius_step, angle_offset) = match kind {
        PickupKind::Shield => (10_u32, 24.0, 20.0, 0.2),
        PickupKind::Bow => (10_u32, 34.0, 20.0, 0.52),
        PickupKind::Armor => (5_u32, 52.0, 18.0, 0.88),
        PickupKind::Gold | PickupKind::GearToken | PickupKind::Item => (1_u32, 0.0, 1.0, 0.0),
    };
    let ring = slot / per_ring;
    let ring_slot = slot % per_ring;
    let radius = base_radius + radius_step * f64::from(ring);
    let angle =
        angle_offset + (f64::from(ring_slot) / f64::from(per_ring)) * std::f64::consts::TAU;
    (radius * angle.cos(), radius * angle.sin())
}

impl Player {
    fn new(nickname: String, session: Uuid) -> Self {
        Self {
            nickname,
            x: 0.0,
            y: spawn_eye_y(),
            z: 0.0,
            yaw: 0.0,
            pitch: 0.0,
            session,
            hp: MAX_HP,
            stamina: MAX_STAMINA,
            gold: 0,
            inventory: InventoryState::starter(),
            equipment: EquipmentState::default(),
            blocking: false,
            bow_charge: 0.0,
            swing_cooldown_s: 0.0,
            swing_visual_s: 0.0,
            boss_unlock: false,
        }
    }

    fn reset_for_respawn(&mut self) {
        self.hp = MAX_HP;
        self.stamina = MAX_STAMINA;
        self.gold = 0;
        self.inventory.reset_to_starter();
        self.equipment = EquipmentState::default();
        self.blocking = false;
        self.bow_charge = 0.0;
        self.swing_cooldown_s = 0.0;
        self.swing_visual_s = 0.0;
        self.x = 0.0;
        self.z = 0.0;
        self.y = spawn_eye_y();
        self.yaw = 0.0;
        self.pitch = 0.0;
    }

    fn has_main_hand(&self, kind: MainHandKind) -> bool {
        self.inventory.has(inventory_item_for_main_hand(kind))
    }

    fn has_off_hand(&self, kind: OffHandKind) -> bool {
        self.inventory.has(inventory_item_for_off_hand(kind))
    }

    fn apply_desired_loadout(
        &mut self,
        desired_main_hand: Option<MainHandKind>,
        desired_off_hand: Option<Option<OffHandKind>>,
    ) {
        if let Some(kind) = desired_main_hand {
            if self.has_main_hand(kind) {
                self.equipment.main_hand = kind;
            }
        } else if !self.has_main_hand(self.equipment.main_hand) {
            self.equipment.main_hand = default_main_hand_from_inventory(&self.inventory);
        }

        if let Some(next_off_hand) = desired_off_hand {
            self.equipment.off_hand = next_off_hand.filter(|kind| self.has_off_hand(*kind));
        } else if let Some(kind) = self.equipment.off_hand {
            if !self.has_off_hand(kind) {
                self.equipment.off_hand = None;
            }
        }

        if !self.inventory.has(armor_piece_inventory_kind(ArmorPieceKind::ScoutHelm)) {
            self.equipment.armor.head = None;
        }
        if !self
            .inventory
            .has(armor_piece_inventory_kind(ArmorPieceKind::ScoutChest))
        {
            self.equipment.armor.chest = None;
        }
        if !self.inventory.has(armor_piece_inventory_kind(ArmorPieceKind::ScoutLegs)) {
            self.equipment.armor.legs = None;
        }
    }

    fn can_block_with_shield(&self) -> bool {
        self.blocking
            && self.equipment.main_hand.is_sword()
            && self.equipment.off_hand == Some(OffHandKind::BasicShield)
    }

    fn can_fire_bow(&self) -> bool {
        self.equipment.main_hand == MainHandKind::ShortBow
    }

    fn active_weapon(&self) -> WeaponKind {
        active_weapon_from_main_hand(self.equipment.main_hand)
    }
}

fn respawn_player(player: &mut Player) {
    player.reset_for_respawn();
}

fn dist2_xz(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    let dx = ax - bx;
    let dz = az - bz;
    dx * dx + dz * dz
}

fn within_radius_xz(ax: f64, az: f64, bx: f64, bz: f64, radius: f64) -> bool {
    dist2_xz(ax, az, bx, bz) <= radius * radius
}

fn gather_nearby<T: Clone>(
    items: &[T],
    index: &SpatialIndex,
    viewer_x: f64,
    viewer_z: f64,
    radius: f64,
    position: impl Fn(&T) -> (f64, f64),
    extra_index: Option<usize>,
) -> Vec<T> {
    let mut indices = index.query_radius(viewer_x, viewer_z, radius);
    if let Some(index) = extra_index {
        indices.push(index);
    }
    indices.sort_unstable();
    indices.dedup();
    indices
        .into_iter()
        .filter_map(|index| {
            let item = items.get(index)?;
            let (x, z) = position(item);
            if Some(index) == extra_index || within_radius_xz(viewer_x, viewer_z, x, z, radius) {
                Some(item.clone())
            } else {
                None
            }
        })
        .collect()
}

impl SnapshotFrame {
    /// Returns one network snapshot filtered to the viewer's nearby area plus their own player state.
    /// Limits: deaths remain global and filtering uses grid cells plus XZ radius checks, not occlusion or full shard partitioning.
    pub fn for_viewer(&self, viewer_id: Uuid) -> SnapshotOut {
        let viewer_id = viewer_id.to_string();
        let viewer_index = self.player_lookup.get(&viewer_id).copied();

        let (viewer_index, viewer_x, viewer_z) = match viewer_index {
            Some(index) => {
                let player = &self.players[index];
                (index, player.x, player.z)
            }
            None => {
                return SnapshotOut {
                    msg_type: "snapshot",
                    tick: self.tick,
                    players: Vec::new(),
                    arrows: Vec::new(),
                    pickups: Vec::new(),
                    mobs: Vec::new(),
                    damage_floats: self.damage_floats.clone(),
                    deaths: self.deaths.clone(),
                };
            }
        };

        let players = gather_nearby(
            &self.players,
            &self.player_index,
            viewer_x,
            viewer_z,
            PLAYER_VISIBILITY_RADIUS,
            |player| (player.x, player.z),
            Some(viewer_index),
        );

        let arrows = gather_nearby(
            &self.arrows,
            &self.arrow_index,
            viewer_x,
            viewer_z,
            ARROW_VISIBILITY_RADIUS,
            |arrow| (arrow.x, arrow.z),
            None,
        );

        let pickups = gather_nearby(
            &self.pickups,
            &self.pickup_index,
            viewer_x,
            viewer_z,
            PICKUP_VISIBILITY_RADIUS,
            |pickup| (pickup.x, pickup.z),
            None,
        );

        let mobs = gather_nearby(
            &self.mobs,
            &self.mob_index,
            viewer_x,
            viewer_z,
            MOB_VISIBILITY_RADIUS,
            |mob| (mob.x, mob.z),
            None,
        );

        let mut damage_indices =
            self.damage_index
                .query_radius(viewer_x, viewer_z, DAMAGE_EVENT_VISIBILITY_RADIUS);
        if let Some(own_damage) = self.damage_by_source.get(&viewer_id) {
            damage_indices.extend(own_damage.iter().copied());
        }
        damage_indices.sort_unstable();
        damage_indices.dedup();
        let damage_floats = damage_indices
            .into_iter()
            .filter_map(|index| self.damage_floats.get(index))
            .filter(|event| {
                event.source_id == viewer_id
                    || within_radius_xz(
                        viewer_x,
                        viewer_z,
                        event.x,
                        event.z,
                        DAMAGE_EVENT_VISIBILITY_RADIUS,
                    )
            })
            .cloned()
            .collect();

        SnapshotOut {
            msg_type: "snapshot",
            tick: self.tick,
            players,
            arrows,
            pickups,
            mobs,
            damage_floats,
            deaths: self.deaths.clone(),
        }
    }
}

impl Simulation {
    /// Returns a new authoritative world with optional boot content for production or tests.
    /// Limits: this seeds only the default mobs; terrain/collider data is still supplied externally each step.
    pub fn new(config: SimConfig) -> Self {
        let mut mobs = Vec::new();
        let mut next_mob_id = 1;
        if config.spawn_training_dummy {
            mobs.push(spawn_training_dummy(next_mob_id));
            next_mob_id += 1;
        }
        if config.spawn_world_bosses {
            mobs.push(spawn_boss_tank(next_mob_id));
            next_mob_id += 1;
            mobs.push(spawn_boss_summoner(next_mob_id));
            next_mob_id += 1;
        }
        let mut sim = Self {
            config,
            players: HashMap::new(),
            nick_to_id: HashMap::new(),
            sessions: HashMap::new(),
            arrows: Vec::new(),
            pickups: Vec::new(),
            next_arrow_id: 1,
            next_pickup_id: 1,
            mobs,
            mob_spawn_timer: 0.0,
            pickup_spawn_timer: PICKUP_RESPAWN_S,
            next_mob_id,
            mob_engagements: Vec::new(),
            loot_salt: 1,
            damage_floats: Vec::new(),
            deaths_this_tick: Vec::new(),
        };
        sim.refill_pickups();
        sim
    }

    /// Returns a new player id and session token for a successful join.
    /// Limits: nick uniqueness is only enforced for players connected to this process.
    pub fn join_player(&mut self, nickname: String) -> Result<(Uuid, Uuid), String> {
        let key = nickname.to_lowercase();
        if self.nick_to_id.contains_key(&key) {
            return Err("That nickname is already in use.".to_string());
        }

        let id = Uuid::new_v4();
        let session = Uuid::new_v4();
        self.players.insert(id, Player::new(nickname.clone(), session));
        self.nick_to_id.insert(key, id);
        self.sessions.insert(session, id);
        Ok((id, session))
    }

    /// Returns the player id for a reconnect session token.
    /// Limits: tokens are removed when a player disconnects; reconnect after process restart is unsupported.
    pub fn player_by_session(&self, session: Uuid) -> Option<Uuid> {
        self.sessions.get(&session).copied()
    }

    /// Returns whether the simulation still tracks the given player id.
    /// Limits: this is a point-in-time lookup only; callers still need their own synchronization.
    pub fn has_player(&self, id: Uuid) -> bool {
        self.players.contains_key(&id)
    }

    /// Buy one unit from a safe-zone shop (`shop_index` matches `safe_zone_shop_spot_xz`).
    pub fn shop_buy(
        &mut self,
        player_id: Uuid,
        shop_index: usize,
        sku: &str,
    ) -> Result<(), &'static str> {
        let Some((sx, sz)) = safe_zone_shop_spot_xz(shop_index) else {
            return Err("Invalid shop.");
        };
        let Some(offer) = shop_offer_for(shop_index, sku) else {
            return Err("Unknown item.");
        };
        let Some(player) = self.players.get_mut(&player_id) else {
            return Err("No player.");
        };
        if !point_in_spawn_safe_zone(player.x, player.z) {
            return Err("Shop only in a safe zone.");
        }
        let dx = player.x - sx;
        let dz = player.z - sz;
        if dx * dx + dz * dz > SHOP_INTERACT_RADIUS * SHOP_INTERACT_RADIUS {
            return Err("Too far from shop.");
        }
        if offer.needs_boss && !player.boss_unlock {
            return Err("Requires a boss trophy.");
        }
        if player.gold < offer.price {
            return Err("Not enough gold.");
        }
        player.gold -= offer.price;
        player.inventory.add(offer.item, 1);
        Ok(())
    }

    /// Sell stackable items for gold while near a shop.
    pub fn shop_sell(
        &mut self,
        player_id: Uuid,
        shop_index: usize,
        kind: InventoryItemKind,
        count: u16,
    ) -> Result<(), &'static str> {
        let Some((sx, sz)) = safe_zone_shop_spot_xz(shop_index) else {
            return Err("Invalid shop.");
        };
        let unit = sell_price_gold(kind);
        if unit == 0 || count == 0 {
            return Err("Cannot sell that.");
        }
        let Some(player) = self.players.get_mut(&player_id) else {
            return Err("No player.");
        };
        if !point_in_spawn_safe_zone(player.x, player.z) {
            return Err("Shop only in a safe zone.");
        }
        let dx = player.x - sx;
        let dz = player.z - sz;
        if dx * dx + dz * dz > SHOP_INTERACT_RADIUS * SHOP_INTERACT_RADIUS {
            return Err("Too far from shop.");
        }
        let removed = player.inventory.remove(kind, count);
        if removed == 0 {
            return Err("Nothing to sell.");
        }
        let pay = unit.saturating_mul(u32::from(removed));
        player.gold = player.gold.saturating_add(pay);
        Ok(())
    }

    /// Returns after removing a disconnected player from the live world.
    /// Limits: inventories/world drops are not persisted yet, so disconnect is a hard removal.
    pub fn remove_player(&mut self, id: Uuid) {
        if let Some(player) = self.players.remove(&id) {
            self.sessions.remove(&player.session);
            self.nick_to_id.remove(&player.nickname.to_lowercase());
        }
    }

    /// Returns `true` when the input was applied to a live player.
    /// Limits: `input_dt_secs` must come from socket arrival timing, not world tick time, or movement validation weakens.
    pub fn apply_input(
        &mut self,
        player_id: Uuid,
        input: &InputCommand,
        input_dt_secs: f64,
        colliders: &[AabbCollider],
    ) -> bool {
        {
            let Some(player) = self.players.get_mut(&player_id) else {
                return false;
            };
            let prev = (player.x, player.y, player.z);
            let (next_x, next_y, next_z) = clamp_claimed_position(
                prev,
                (input.x, input.y, input.z),
                input_dt_secs,
                colliders,
                input.creative,
                input.flying,
                input.sprinting,
            );
            player.x = next_x;
            player.y = next_y;
            player.z = next_z;
            player.yaw = input.yaw;
            player.pitch = input.pitch;
            let desired_main_hand = input
                .main_hand
                .as_deref()
                .and_then(MainHandKind::from_input);
            let desired_off_hand = input
                .off_hand
                .as_ref()
                .map(|raw| OffHandKind::from_input(raw));
            player.apply_desired_loadout(desired_main_hand, desired_off_hand);
            player.blocking = input.blocking
                && player.equipment.main_hand.is_sword()
                && player.equipment.off_hand == Some(OffHandKind::BasicShield);
            player.bow_charge = if player.equipment.main_hand == MainHandKind::ShortBow {
                input.bow_charge.clamp(0.0, 1.0)
            } else {
                0.0
            };
        }

        if input.swing {
            self.resolve_sword_swing(player_id);
        }
        if input.fire_arrow {
            self.resolve_bow_fire(player_id);
        }
        true
    }

    /// Returns after advancing the authoritative world by one small step.
    /// Limits: large catch-up steps are clamped to 120 ms; the simulation is tuned for frequent fixed-ish ticks, not long pauses.
    pub fn tick(&mut self, dt: f64, world_tick: u64, colliders: &[AabbCollider]) {
        let dt = dt.clamp(0.0, 0.12);
        for player in self.players.values_mut() {
            player.stamina = (player.stamina + STAMINA_REGEN_PER_S * dt).min(MAX_STAMINA);
            if player.can_block_with_shield() {
                player.stamina = (player.stamina - STAMINA_BLOCK_PER_S * dt).max(0.0);
            }
            if player.can_fire_bow() && player.bow_charge > 0.05 {
                player.stamina =
                    (player.stamina - STAMINA_BOW_CHARGE_PER_S * dt * player.bow_charge).max(0.0);
            }
            player.swing_cooldown_s = (player.swing_cooldown_s - dt).max(0.0);
            player.swing_visual_s = (player.swing_visual_s - dt).max(0.0);
        }

        self.collect_pickups();
        self.pickup_spawn_timer -= dt;
        if self.pickup_spawn_timer <= 0.0 {
            self.pickup_spawn_timer = PICKUP_RESPAWN_S;
            self.refill_pickups();
        }

        for arrow in &mut self.arrows {
            integrate_arrow(arrow, dt);
        }

        self.process_arrow_hits();
        self.arrows
            .retain(|arrow| arrow.y > -30.0 && arrow.x.abs() <= 250.0 && arrow.z.abs() <= 250.0);

        let poses: Vec<(Uuid, f64, f64, f64)> = self
            .players
            .iter()
            .map(|(id, player)| (*id, player.x, player.y, player.z))
            .collect();
        let mut spawn_timer = if self.config.auto_spawn_creeps {
            self.mob_spawn_timer
        } else {
            -1.0
        };
        let mut next_mob_id = self.next_mob_id;
        let mut pending_boss_arrows: Vec<BossArrowPlan> = Vec::new();
        let mob_hits = tick_mobs(
            &mut self.mobs,
            &poses,
            &mut self.mob_engagements,
            dt,
            colliders,
            &mut spawn_timer,
            &mut next_mob_id,
            world_tick,
            &mut pending_boss_arrows,
        );
        if self.config.auto_spawn_creeps {
            self.mob_spawn_timer = spawn_timer.max(0.0);
            self.next_mob_id = next_mob_id;
        } else {
            self.next_mob_id = next_mob_id;
        }
        self.apply_mob_player_hits(mob_hits);
        for plan in pending_boss_arrows {
            if let Some(mob) = self.mobs.iter().find(|m| m.id == plan.mob_id) {
                let arrow = spawn_boss_projectile(
                    self.next_arrow_id,
                    mob.x,
                    mob.y,
                    mob.z,
                    plan.tx,
                    plan.ty,
                    plan.tz,
                    plan.heavy,
                    plan.speed,
                );
                self.next_arrow_id = self.next_arrow_id.wrapping_add(1);
                self.arrows.push(arrow);
            }
        }
    }

    /// Returns the latest full-world frame and drains one-tick visual events like damage floats and deaths.
    /// Limits: callers must turn this into per-view snapshots; sending it raw would reintroduce broadcast-all scaling.
    pub fn build_snapshot_frame(&mut self, tick: u64) -> SnapshotFrame {
        let damage_floats = std::mem::take(&mut self.damage_floats);
        let mut deaths = std::mem::take(&mut self.deaths_this_tick)
            .into_iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>();
        deaths.sort_unstable();

        let mut players = self
            .players
            .iter()
            .map(|(id, player)| {
                let swing_t = if player.swing_visual_s > 0.0 {
                    (player.swing_visual_s / 0.4).min(1.0)
                } else {
                    0.0
                };
                PlayerSnapshot {
                    id: id.to_string(),
                    nickname: player.nickname.clone(),
                    x: player.x,
                    y: player.y,
                    z: player.z,
                    yaw: player.yaw,
                    pitch: player.pitch,
                    hp: player.hp,
                    stamina: player.stamina,
                    gold: player.gold,
                    main_hand: player.equipment.main_hand,
                    off_hand: player.equipment.off_hand,
                    armor: player.equipment.armor,
                    inventory: player.inventory.entries(),
                    weapon: player.active_weapon(),
                    blocking: player.blocking,
                    bow_charge: player.bow_charge,
                    swing_t,
                    boss_unlock: player.boss_unlock,
                }
            })
            .collect::<Vec<_>>();
        players.sort_unstable_by(|a, b| a.id.cmp(&b.id));

        let mut arrows = self
            .arrows
            .iter()
            .map(|arrow| ArrowSnapshot {
                id: arrow.id,
                x: arrow.x,
                y: arrow.y,
                z: arrow.z,
                yaw: arrow.vx.atan2(arrow.vz),
            })
            .collect::<Vec<_>>();
        arrows.sort_unstable_by_key(|arrow| arrow.id);

        let mut pickups = self
            .pickups
            .iter()
            .map(|pickup| PickupSnapshot {
                id: pickup.id,
                kind: pickup.kind,
                x: pickup.x,
                y: pickup.y,
                z: pickup.z,
                gold_amount: pickup.gold_amount,
                item_kind: pickup.item_kind,
                item_count: pickup.item_count,
            })
            .collect::<Vec<_>>();
        pickups.sort_unstable_by_key(|pickup| pickup.id);

        let mut mobs = self
            .mobs
            .iter()
            .map(|mob| MobSnapshot {
                id: mob.id,
                kind: mob_kind_tag(mob),
                max_hp: mob_max_hp(mob),
                x: mob.x,
                y: mob.y,
                z: mob.z,
                hp: mob.hp,
            })
            .collect::<Vec<_>>();
        mobs.sort_unstable_by_key(|mob| mob.id);

        let player_lookup = players
            .iter()
            .enumerate()
            .map(|(index, player)| (player.id.clone(), index))
            .collect::<HashMap<_, _>>();
        let player_positions = players
            .iter()
            .map(|player| (player.x, player.z))
            .collect::<Vec<_>>();
        let arrow_positions = arrows
            .iter()
            .map(|arrow| (arrow.x, arrow.z))
            .collect::<Vec<_>>();
        let pickup_positions = pickups
            .iter()
            .map(|pickup| (pickup.x, pickup.z))
            .collect::<Vec<_>>();
        let mob_positions = mobs.iter().map(|mob| (mob.x, mob.z)).collect::<Vec<_>>();
        let damage_positions = damage_floats
            .iter()
            .map(|event| (event.x, event.z))
            .collect::<Vec<_>>();
        let mut damage_by_source: HashMap<String, Vec<usize>> = HashMap::new();
        for (index, event) in damage_floats.iter().enumerate() {
            damage_by_source
                .entry(event.source_id.clone())
                .or_default()
                .push(index);
        }

        SnapshotFrame {
            tick,
            players,
            arrows,
            pickups,
            mobs,
            damage_floats,
            deaths,
            player_lookup,
            player_index: SpatialIndex::from_positions(PLAYER_VISIBILITY_RADIUS, &player_positions),
            arrow_index: SpatialIndex::from_positions(ARROW_VISIBILITY_RADIUS, &arrow_positions),
            pickup_index: SpatialIndex::from_positions(PICKUP_VISIBILITY_RADIUS, &pickup_positions),
            mob_index: SpatialIndex::from_positions(MOB_VISIBILITY_RADIUS, &mob_positions),
            damage_index: SpatialIndex::from_positions(
                DAMAGE_EVENT_VISIBILITY_RADIUS,
                &damage_positions,
            ),
            damage_by_source,
        }
    }

    fn refill_pickups(&mut self) {
        for kind in [PickupKind::Shield, PickupKind::Bow, PickupKind::Armor] {
            let target = pickup_target_count(kind);
            let active = self.pickups.iter().filter(|pickup| pickup.kind == kind).count() as u32;
            if active >= target {
                continue;
            }
            for slot in 0..target {
                if self
                    .pickups
                    .iter()
                    .any(|pickup| pickup.kind == kind && pickup.slot == slot)
                {
                    continue;
                }
                let (x, z) = pickup_slot_position(kind, slot);
                let y = sample_terrain_height(x, z) + 0.65;
                self.pickups.push(Pickup {
                    id: self.next_pickup_id,
                    kind,
                    slot,
                    x,
                    y,
                    z,
                    gold_amount: 0,
                    item_kind: None,
                    item_count: 0,
                });
                self.next_pickup_id = self.next_pickup_id.wrapping_add(1);
                if self.pickups.iter().filter(|pickup| pickup.kind == kind).count() as u32 >= target
                {
                    break;
                }
            }
        }
    }

    fn drop_mob_loot(&mut self, kind: MobKind, mob_id: u32, x: f64, z: f64) {
        let Some((gold, token)) = loot_for_death(kind, mob_id, self.loot_salt) else {
            return;
        };
        self.loot_salt = self.loot_salt.wrapping_add(109);
        let y = sample_terrain_height(x, z) + 0.55;
        if gold > 0 {
            self.pickups.push(Pickup {
                id: self.next_pickup_id,
                kind: PickupKind::Gold,
                slot: 0,
                x,
                y,
                z,
                gold_amount: gold,
                item_kind: None,
                item_count: 0,
            });
            self.next_pickup_id = self.next_pickup_id.wrapping_add(1);
        }
        if token {
            let xt = x + 0.2;
            let zt = z + 0.35;
            let yt = sample_terrain_height(xt, zt) + 0.55;
            self.pickups.push(Pickup {
                id: self.next_pickup_id,
                kind: PickupKind::GearToken,
                slot: 0,
                x: xt,
                y: yt,
                z: zt,
                gold_amount: 0,
                item_kind: None,
                item_count: 0,
            });
            self.next_pickup_id = self.next_pickup_id.wrapping_add(1);
        }
    }

    fn spawn_death_loot(&mut self, x: f64, z: f64, gold: u32, inv: &InventoryState) {
        let mut i = 0_u32;
        if gold > 0 {
            let (ox, oz) = death_loot_offset(i);
            i += 1;
            let px = x + ox;
            let pz = z + oz;
            let y = sample_terrain_height(px, pz) + 0.55;
            self.pickups.push(Pickup {
                id: self.next_pickup_id,
                kind: PickupKind::Gold,
                slot: 0,
                x: px,
                y,
                z: pz,
                gold_amount: gold,
                item_kind: None,
                item_count: 0,
            });
            self.next_pickup_id = self.next_pickup_id.wrapping_add(1);
        }
        for entry in inv.entries() {
            if entry.count == 0 {
                continue;
            }
            let (ox, oz) = death_loot_offset(i);
            i += 1;
            let px = x + ox;
            let pz = z + oz;
            let y = sample_terrain_height(px, pz) + 0.55;
            self.pickups.push(Pickup {
                id: self.next_pickup_id,
                kind: PickupKind::Item,
                slot: 0,
                x: px,
                y,
                z: pz,
                gold_amount: 0,
                item_kind: Some(entry.kind),
                item_count: entry.count,
            });
            self.next_pickup_id = self.next_pickup_id.wrapping_add(1);
        }
    }

    fn kill_player_with_loot(&mut self, victim_id: Uuid) {
        let snapshot = self
            .players
            .get(&victim_id)
            .map(|p| (p.x, p.z, p.gold, p.inventory.clone()));
        let Some((x, z, gold, inv)) = snapshot else {
            return;
        };
        self.deaths_this_tick.push(victim_id);
        {
            let player = self.players.get_mut(&victim_id).expect("player exists");
            respawn_player(player);
        }
        self.spawn_death_loot(x, z, gold, &inv);
    }

    fn collect_pickups(&mut self) {
        let mut collected: Vec<(u32, Uuid)> = Vec::new();
        for pickup in &self.pickups {
            for (player_id, player) in &self.players {
                let dy = (player.y - EYE_HEIGHT + 0.8) - pickup.y;
                let dx = player.x - pickup.x;
                let dz = player.z - pickup.z;
                if dx * dx + dz * dz + dy * dy <= PICKUP_RADIUS * PICKUP_RADIUS {
                    collected.push((pickup.id, *player_id));
                    break;
                }
            }
        }
        if collected.is_empty() {
            return;
        }

        for (pickup_id, player_id) in &collected {
            let Some(pickup) = self.pickups.iter().find(|p| p.id == *pickup_id) else {
                continue;
            };
            if let Some(player) = self.players.get_mut(player_id) {
                match pickup.kind {
                    PickupKind::Shield => {
                        player.inventory.add(InventoryItemKind::BasicShield, 1);
                        if player.equipment.off_hand.is_none() {
                            player.equipment.off_hand = Some(OffHandKind::BasicShield);
                        }
                    }
                    PickupKind::Bow => {
                        player.inventory.add(InventoryItemKind::ShortBow, 1);
                    }
                    PickupKind::Armor => {
                        player.inventory.add(InventoryItemKind::ScoutHelm, 1);
                        player.inventory.add(InventoryItemKind::ScoutChest, 1);
                        player.inventory.add(InventoryItemKind::ScoutLegs, 1);
                        player.equipment.armor = ArmorSlots {
                            head: Some(ArmorPieceKind::ScoutHelm),
                            chest: Some(ArmorPieceKind::ScoutChest),
                            legs: Some(ArmorPieceKind::ScoutLegs),
                        };
                    }
                    PickupKind::Gold => {
                        player.gold = player.gold.saturating_add(pickup.gold_amount);
                    }
                    PickupKind::GearToken => {
                        player
                            .inventory
                            .add(InventoryItemKind::GearUpgradeToken, 1);
                    }
                    PickupKind::Item => {
                        if let Some(kind) = pickup.item_kind {
                            player.inventory.add(kind, pickup.item_count);
                        }
                    }
                }
            }
        }

        let consumed: HashSet<u32> = collected.iter().map(|(id, _)| *id).collect();
        self.pickups
            .retain(|pickup| !consumed.contains(&pickup.id));
    }

    fn apply_mob_player_hits(&mut self, hits: Vec<MobPlayerHit>) {
        for hit in hits {
            let id = hit.player;
            let died = {
                let Some(player) = self.players.get_mut(&id) else {
                    continue;
                };
                if point_in_spawn_safe_zone(player.x, player.z) {
                    continue;
                }
                let vx = hit.mob_x - player.x;
                let vz = hit.mob_z - player.z;
                let frontal = frontal_dot(player.yaw, vx, vz);
                let damage = damage_after_armor(
                    damage_after_shield_melee(
                        hit.damage,
                        player.blocking,
                        player.equipment.off_hand == Some(OffHandKind::BasicShield)
                            && player.equipment.main_hand.is_sword(),
                        frontal,
                    ),
                    player.equipment.armor,
                );
                player.hp = (player.hp - damage).max(0.0);
                player.hp <= 0.0
            };
            if died {
                self.kill_player_with_loot(id);
            }
        }
    }

    fn resolve_sword_swing(&mut self, attacker_id: Uuid) {
        let swing_damage = {
            let Some(player) = self.players.get(&attacker_id) else {
                return;
            };
            if !player.equipment.main_hand.is_sword()
                || player.swing_cooldown_s > 0.0
                || player.stamina < STAMINA_MELEE
            {
                return;
            }
            melee_damage_for_main_hand(player.equipment.main_hand)
        };

        let attacker_in_safe = {
            let player = self
                .players
                .get(&attacker_id)
                .expect("player checked above");
            point_in_spawn_safe_zone(player.x, player.z)
        };

        {
            let player = self
                .players
                .get_mut(&attacker_id)
                .expect("player checked above");
            player.stamina -= STAMINA_MELEE;
            player.swing_cooldown_s = SWING_COOLDOWN_S;
            player.swing_visual_s = 0.4;
        }

        let (ax, az, ayaw, ay) = {
            let player = self
                .players
                .get(&attacker_id)
                .expect("player checked above");
            (player.x, player.z, player.yaw, player.y)
        };

        let mob_hit_indices = self
            .mobs
            .iter()
            .enumerate()
            .filter_map(|(index, mob)| {
                if melee_hit_valid(ax, az, ayaw, ay, mob.x, mob.z, mob.y) {
                    Some(index)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        for mob_index in mob_hit_indices {
            let (fx, fy, fz, died, mk, mid, mx, mz) = {
                let Some(mob) = self.mobs.get_mut(mob_index) else {
                    continue;
                };
                push_engagement(
                    &mut self.mob_engagements,
                    attacker_id,
                    mob.x,
                    mob.z,
                    mob.kind,
                );
                mob.hp -= swing_damage;
                if mob.kind == MobKind::TrainingDummy && mob.hp <= 0.0 {
                    mob.hp = TRAINING_DUMMY_HP;
                }
                let died = mob.hp <= 0.0 && mob.kind != MobKind::TrainingDummy;
                let mk = mob.kind;
                let mid = mob.id;
                let mx = mob.x;
                let mz = mob.z;
                (mob.x, mob.y + 0.35, mob.z, died, mk, mid, mx, mz)
            };
            self.damage_floats.push(DamageFloatSnapshot {
                source_id: attacker_id.to_string(),
                x: fx,
                y: fy,
                z: fz,
                amount: swing_damage,
            });
            if died {
                if matches!(mk, MobKind::BossTank | MobKind::BossSummoner) {
                    if let Some(att) = self.players.get_mut(&attacker_id) {
                        att.boss_unlock = true;
                    }
                }
                self.drop_mob_loot(mk, mid, mx, mz);
            }
        }

        if attacker_in_safe {
            return;
        }

        let victims = self
            .players
            .iter()
            .filter_map(|(other_id, other)| {
                if *other_id == attacker_id {
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
                let frontal = frontal_dot(other.yaw, vx, vz);
                let damage = damage_after_armor(
                    damage_after_shield_melee(
                        swing_damage,
                        other.blocking,
                        other.equipment.off_hand == Some(OffHandKind::BasicShield)
                            && other.equipment.main_hand.is_sword(),
                        frontal,
                    ),
                    other.equipment.armor,
                );
                Some((*other_id, damage))
            })
            .collect::<Vec<_>>();

        for (victim_id, damage) in victims {
            let pos = self
                .players
                .get(&victim_id)
                .map(|player| (player.x, player.y - 0.2, player.z));
            if let Some((x, y, z)) = pos {
                self.damage_floats.push(DamageFloatSnapshot {
                    source_id: attacker_id.to_string(),
                    x,
                    y,
                    z,
                    amount: damage,
                });
            }
            let dead = self
                .players
                .get(&victim_id)
                .map(|p| {
                    let next = (p.hp - damage).max(0.0);
                    next <= 0.0
                })
                .unwrap_or(false);
            if let Some(player) = self.players.get_mut(&victim_id) {
                player.hp = (player.hp - damage).max(0.0);
            }
            if dead {
                self.kill_player_with_loot(victim_id);
            }
        }
    }

    fn resolve_bow_fire(&mut self, attacker_id: Uuid) {
        let can_fire = {
            let Some(player) = self.players.get(&attacker_id) else {
                return;
            };
            player.equipment.main_hand == MainHandKind::ShortBow
                && player.bow_charge >= BOW_MIN_CHARGE
                && player.stamina >= STAMINA_BOW_FIRE
        };
        if !can_fire {
            return;
        }

        let (x, y, z, yaw, pitch, deals_damage) = {
            let player = self
                .players
                .get(&attacker_id)
                .expect("player checked above");
            let deals_damage = !point_in_spawn_safe_zone(player.x, player.z);
            (
                player.x,
                player.y,
                player.z,
                player.yaw,
                player.pitch,
                deals_damage,
            )
        };

        let arrow_id = self.next_arrow_id;
        self.next_arrow_id = self.next_arrow_id.wrapping_add(1);
        let arrow =
            spawn_arrow_from_player(attacker_id, arrow_id, x, y, z, yaw, pitch, deals_damage);
        self.arrows.push(arrow);

        if let Some(player) = self.players.get_mut(&attacker_id) {
            player.stamina -= STAMINA_BOW_FIRE;
            player.bow_charge = 0.0;
        }
    }

    fn process_arrow_hits(&mut self) {
        let mut index = 0;
        while index < self.arrows.len() {
            let owner = self.arrows[index].owner;
            let ax = self.arrows[index].x;
            let ay = self.arrows[index].y;
            let az = self.arrows[index].z;
            let heavy = self.arrows[index].heavy;
            let deals_damage = self.arrows[index].deals_damage;

            let mut mob_hit_index = None;
            for (mob_index, mob) in self.mobs.iter().enumerate() {
                if mob_arrow_hit(ax, ay, az, mob) {
                    let allow = deals_damage || mob.kind == MobKind::TrainingDummy;
                    if allow {
                        mob_hit_index = Some(mob_index);
                    }
                    break;
                }
            }
            if let Some(mob_index) = mob_hit_index {
                let (fx, fy, fz, died, mk, mid, mx, mz) = {
                    let mob = &mut self.mobs[mob_index];
                    if owner != Uuid::nil() {
                        push_engagement(
                            &mut self.mob_engagements,
                            owner,
                            mob.x,
                            mob.z,
                            mob.kind,
                        );
                    }
                    mob.hp -= ARROW_DAMAGE;
                    if mob.kind == MobKind::TrainingDummy && mob.hp <= 0.0 {
                        mob.hp = TRAINING_DUMMY_HP;
                    }
                    let died = mob.hp <= 0.0 && mob.kind != MobKind::TrainingDummy;
                    (
                        mob.x,
                        mob.y + 0.35,
                        mob.z,
                        died,
                        mob.kind,
                        mob.id,
                        mob.x,
                        mob.z,
                    )
                };
                self.damage_floats.push(DamageFloatSnapshot {
                    source_id: owner.to_string(),
                    x: fx,
                    y: fy,
                    z: fz,
                    amount: ARROW_DAMAGE,
                });
                if died {
                    if owner != Uuid::nil()
                        && matches!(mk, MobKind::BossTank | MobKind::BossSummoner)
                    {
                        if let Some(att) = self.players.get_mut(&owner) {
                            att.boss_unlock = true;
                        }
                    }
                    self.drop_mob_loot(mk, mid, mx, mz);
                }
                self.arrows.swap_remove(index);
                continue;
            }

            let mut victim = None;
            for (player_id, player) in &self.players {
                if *player_id == owner {
                    continue;
                }
                if point_in_spawn_safe_zone(player.x, player.z) {
                    continue;
                }
                if arrow_hits_player(ax, ay, az, player.x, player.y, player.z) {
                    let vx = ax - player.x;
                    let vz = az - player.z;
                    let frontal = frontal_dot(player.yaw, vx, vz);
                    let damage = damage_after_armor(
                        damage_after_shield_ranged(
                            ARROW_DAMAGE,
                            heavy,
                            player.blocking,
                            player.equipment.off_hand == Some(OffHandKind::BasicShield)
                                && player.equipment.main_hand.is_sword(),
                            frontal,
                        ),
                        player.equipment.armor,
                    );
                    victim = Some((*player_id, damage));
                    break;
                }
            }

            if let Some((player_id, damage)) = victim {
                if deals_damage {
                    let pos = self
                        .players
                        .get(&player_id)
                        .map(|player| (player.x, player.y - 0.2, player.z));
                    if let Some((x, y, z)) = pos {
                        self.damage_floats.push(DamageFloatSnapshot {
                            source_id: owner.to_string(),
                            x,
                            y,
                            z,
                            amount: damage,
                        });
                    }
                    let dead = self
                        .players
                        .get(&player_id)
                        .map(|p| (p.hp - damage).max(0.0) <= 0.0)
                        .unwrap_or(false);
                    if let Some(player) = self.players.get_mut(&player_id) {
                        player.hp = (player.hp - damage).max(0.0);
                    }
                    if dead {
                        self.kill_player_with_loot(player_id);
                    }
                }
                self.arrows.swap_remove(index);
                continue;
            }

            index += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::items::{InventoryItemKind, MainHandKind, OffHandKind};
    use crate::mobs::{MobKind, MobMoveState};
    use crate::world::build_colliders;

    fn create_creep(id: u32, x: f64, z: f64) -> Mob {
        Mob {
            id,
            kind: MobKind::Creep,
            x,
            y: sample_terrain_height(x, z) + crate::mobs::MOB_EYE_HEIGHT,
            z,
            hp: crate::mobs::MOB_HP,
            move_state: MobMoveState::Idle,
            state_timer: 0.0,
            aggro: None,
            wander_yaw: 0.0,
            wander_timer: 1.0,
            boss_cd: 0.0,
            boss_attack_idx: 0,
            facing_yaw: 0.0,
            melee_cd: 0.0,
        }
    }

    #[test]
    fn empty_world_starts_without_boot_content() {
        let sim = Simulation::new(SimConfig {
            spawn_training_dummy: false,
            auto_spawn_creeps: false,
            spawn_world_bosses: false,
        });
        assert!(sim.mobs.is_empty());
        assert!(sim.players.is_empty());
    }

    #[test]
    fn creep_chases_and_kills_player_with_trace() {
        let colliders = build_colliders();
        let mut sim = Simulation::new(SimConfig {
            spawn_training_dummy: false,
            auto_spawn_creeps: false,
            spawn_world_bosses: false,
        });
        let (player_id, _) = sim.join_player("hero".to_string()).expect("join succeeds");
        {
            let player = sim.players.get_mut(&player_id).expect("player exists");
            player.x = 12.0;
            player.z = 0.0;
            player.y = sample_terrain_height(player.x, player.z) + EYE_HEIGHT;
        }
        sim.mobs.push(create_creep(77, 22.0, 0.0));

        let dt = 1.0 / 20.0;
        let mut died = false;
        let mut trace = Vec::new();
        for tick in 1..=500_u64 {
            sim.tick(dt, tick, &colliders);
            let player = sim
                .players
                .get(&player_id)
                .expect("player survives respawn");
            let mob = sim
                .mobs
                .iter()
                .find(|mob| mob.kind == MobKind::Creep)
                .expect("creep still tracked");
            let dx = mob.x - player.x;
            let dz = mob.z - player.z;
            let distance = (dx * dx + dz * dz).sqrt();
            trace.push(format!(
                "tick={tick:03} player=({:.2},{:.2},{:.2}) hp={:.1} mob=({:.2},{:.2},{:.2}) dist={distance:.2} melee_cd={:.2}",
                player.x, player.y, player.z, player.hp, mob.x, mob.y, mob.z, mob.melee_cd
            ));
            if sim.deaths_this_tick.contains(&player_id) {
                died = true;
                break;
            }
        }

        assert!(
            died,
            "expected creep to eventually kill the player\n{}",
            trace.join("\n")
        );
    }

    #[test]
    fn snapshot_frame_filters_far_entities_per_viewer() {
        let mut sim = Simulation::new(SimConfig {
            spawn_training_dummy: false,
            auto_spawn_creeps: false,
            spawn_world_bosses: false,
        });
        let (viewer_id, _) = sim
            .join_player("viewer".to_string())
            .expect("join succeeds");
        let (near_id, _) = sim.join_player("near".to_string()).expect("join succeeds");
        let (far_id, _) = sim.join_player("far".to_string()).expect("join succeeds");

        {
            let viewer = sim.players.get_mut(&viewer_id).expect("viewer exists");
            viewer.x = 0.0;
            viewer.z = 0.0;
            viewer.y = sample_terrain_height(0.0, 0.0) + EYE_HEIGHT;
        }
        {
            let near = sim.players.get_mut(&near_id).expect("near player exists");
            near.x = 12.0;
            near.z = 0.0;
            near.y = sample_terrain_height(near.x, near.z) + EYE_HEIGHT;
        }
        {
            let far = sim.players.get_mut(&far_id).expect("far player exists");
            far.x = 140.0;
            far.z = 0.0;
            far.y = sample_terrain_height(far.x, far.z) + EYE_HEIGHT;
        }

        sim.mobs.push(create_creep(11, 8.0, 0.0));
        sim.mobs.push(create_creep(12, 140.0, 0.0));
        sim.arrows.push(Arrow {
            id: 21,
            owner: viewer_id,
            x: 10.0,
            y: sample_terrain_height(10.0, 0.0) + 1.0,
            z: 0.0,
            vx: 0.0,
            vy: 0.0,
            vz: 1.0,
            heavy: false,
            deals_damage: true,
        });
        sim.arrows.push(Arrow {
            id: 22,
            owner: far_id,
            x: 140.0,
            y: sample_terrain_height(140.0, 0.0) + 1.0,
            z: 0.0,
            vx: 0.0,
            vy: 0.0,
            vz: 1.0,
            heavy: false,
            deals_damage: true,
        });
        sim.damage_floats.push(DamageFloatSnapshot {
            source_id: viewer_id.to_string(),
            x: 140.0,
            y: 1.0,
            z: 0.0,
            amount: 5.0,
        });
        sim.damage_floats.push(DamageFloatSnapshot {
            source_id: far_id.to_string(),
            x: 140.0,
            y: 1.0,
            z: 0.0,
            amount: 7.0,
        });

        let frame = sim.build_snapshot_frame(99);
        let view = frame.for_viewer(viewer_id);

        assert_eq!(view.tick, 99);
        assert_eq!(
            view.players.len(),
            2,
            "viewer should only see self + nearby player"
        );
        assert!(view
            .players
            .iter()
            .any(|player| player.id == viewer_id.to_string()));
        assert!(view
            .players
            .iter()
            .any(|player| player.id == near_id.to_string()));
        assert!(!view
            .players
            .iter()
            .any(|player| player.id == far_id.to_string()));
        assert_eq!(view.mobs.len(), 1, "only nearby mob should remain");
        assert_eq!(view.mobs[0].id, 11);
        assert_eq!(view.arrows.len(), 1, "only nearby arrow should remain");
        assert_eq!(view.arrows[0].id, 21);
        assert_eq!(
            view.damage_floats.len(),
            1,
            "viewer should keep their own damage event even when it happened far away"
        );
        assert_eq!(view.damage_floats[0].source_id, viewer_id.to_string());
    }

    #[test]
    fn starter_loadout_resets_on_respawn() {
        let mut sim = Simulation::new(SimConfig {
            spawn_training_dummy: false,
            auto_spawn_creeps: false,
            spawn_world_bosses: false,
        });
        let (player_id, _) = sim.join_player("hero".to_string()).expect("join succeeds");
        let player = sim.players.get_mut(&player_id).expect("player exists");
        player.gold = 88;
        player.inventory.add(InventoryItemKind::BasicShield, 1);
        player.inventory.add(InventoryItemKind::ShortBow, 1);
        player.equipment.off_hand = Some(OffHandKind::BasicShield);
        player.equipment.main_hand = MainHandKind::ShortBow;
        player.hp = 5.0;

        respawn_player(player);

        assert_eq!(player.gold, 0);
        assert_eq!(player.equipment.main_hand, MainHandKind::WoodenSword);
        assert_eq!(player.equipment.off_hand, None);
        assert_eq!(player.inventory.count(InventoryItemKind::WoodenSword), 1);
        assert_eq!(player.inventory.count(InventoryItemKind::BasicShield), 0);
        assert_eq!(player.inventory.count(InventoryItemKind::ShortBow), 0);
    }

    #[test]
    fn default_world_spawns_ring_gear_pickups() {
        let sim = Simulation::new(SimConfig {
            spawn_training_dummy: false,
            auto_spawn_creeps: false,
            spawn_world_bosses: false,
        });
        assert_eq!(
            sim.pickups
                .iter()
                .filter(|pickup| pickup.kind == PickupKind::Shield)
                .count(),
            10
        );
        assert_eq!(
            sim.pickups
                .iter()
                .filter(|pickup| pickup.kind == PickupKind::Bow)
                .count(),
            10
        );
        assert_eq!(
            sim.pickups
                .iter()
                .filter(|pickup| pickup.kind == PickupKind::Armor)
                .count(),
            5
        );
    }

    #[test]
    fn default_config_spawns_world_loot_and_creeps_over_time() {
        let colliders = build_colliders();
        let mut sim = Simulation::new(SimConfig::default());
        assert!(
            sim.pickups.iter().any(|p| p.kind == PickupKind::Shield),
            "expected world shield pickups at boot"
        );
        assert!(
            sim.pickups.iter().any(|p| p.kind == PickupKind::Bow),
            "expected world bow pickups at boot"
        );
        let frame0 = sim.build_snapshot_frame(0);
        assert!(
            frame0.pickups.len() >= 25,
            "full snapshot should list ring gear (25+) plus any boot mobs; got {}",
            frame0.pickups.len()
        );

        let dt = 1.0 / 20.0;
        for tick in 1..=200_u64 {
            sim.tick(dt, tick, &colliders);
        }
        let creeps = sim
            .mobs
            .iter()
            .filter(|m| m.kind == MobKind::Creep)
            .count();
        assert!(
            creeps >= 8,
            "passive creep spawn should populate the map (got {creeps} creeps after 200 ticks)"
        );
        assert!(
            sim.mobs.iter().any(|m| m.kind == MobKind::TrainingDummy),
            "training dummy should remain"
        );
        assert!(
            sim.mobs
                .iter()
                .any(|m| m.kind == MobKind::BossTank || m.kind == MobKind::BossSummoner),
            "expected at least one world boss from default config"
        );
    }

    #[test]
    fn invalid_bow_claim_is_ignored_without_pickup() {
        let colliders = build_colliders();
        let mut sim = Simulation::new(SimConfig {
            spawn_training_dummy: false,
            auto_spawn_creeps: false,
            spawn_world_bosses: false,
        });
        let (player_id, _) = sim.join_player("hero".to_string()).expect("join succeeds");
        let input = InputCommand {
            x: 0.0,
            y: spawn_eye_y(),
            z: 0.0,
            yaw: 0.0,
            pitch: 0.0,
            creative: false,
            flying: false,
            sprinting: false,
            main_hand: Some("shortBow".to_string()),
            off_hand: Some("basicShield".to_string()),
            blocking: true,
            bow_charge: 1.0,
            swing: false,
            fire_arrow: false,
        };

        assert!(sim.apply_input(player_id, &input, 1.0 / 20.0, &colliders));
        let player = sim.players.get(&player_id).expect("player exists");
        assert_eq!(player.equipment.main_hand, MainHandKind::WoodenSword);
        assert_eq!(player.equipment.off_hand, None);
        assert!(!player.blocking);
        assert_eq!(player.bow_charge, 0.0);
    }

    #[test]
    fn shield_blocks_while_sword_is_main_hand() {
        let mut sim = Simulation::new(SimConfig {
            spawn_training_dummy: false,
            auto_spawn_creeps: false,
            spawn_world_bosses: false,
        });
        let (attacker_id, _) = sim
            .join_player("attacker".to_string())
            .expect("join succeeds");
        let (victim_id, _) = sim.join_player("victim".to_string()).expect("join succeeds");

        {
            let attacker = sim.players.get_mut(&attacker_id).expect("attacker exists");
            attacker.x = 0.0;
            attacker.z = 10.0;
            attacker.y = sample_terrain_height(0.0, 10.0) + EYE_HEIGHT;
            attacker.yaw = std::f64::consts::PI;
        }
        {
            let victim = sim.players.get_mut(&victim_id).expect("victim exists");
            victim.x = 0.0;
            victim.z = 11.0;
            victim.y = sample_terrain_height(0.0, 11.0) + EYE_HEIGHT;
            victim.yaw = 0.0;
            victim.inventory.add(InventoryItemKind::BasicShield, 1);
            victim.equipment.off_hand = Some(OffHandKind::BasicShield);
            victim.blocking = true;
        }

        sim.resolve_sword_swing(attacker_id);
        let victim = sim.players.get(&victim_id).expect("victim exists");
        assert!(victim.hp < MAX_HP);
        let swing = crate::items::melee_damage_for_main_hand(MainHandKind::WoodenSword);
        assert!(victim.hp > MAX_HP - swing);
    }
}
