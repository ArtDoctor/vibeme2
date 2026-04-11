use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, Ord, PartialOrd)]
#[serde(rename_all = "camelCase")]
pub enum InventoryItemKind {
    WoodenSword,
    /// Basic shop tier (Milestone 4).
    IronSword,
    /// Expensive shop tier.
    SteelSword,
    /// Boss-gated shop tier (requires a boss kill flag on the player).
    VanguardSword,
    BasicShield,
    ShortBow,
    ScoutHelm,
    ScoutChest,
    ScoutLegs,
    /// Rare boss drop; spend at shops in Milestone 4.
    GearUpgradeToken,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MainHandKind {
    WoodenSword,
    IronSword,
    SteelSword,
    VanguardSword,
    ShortBow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OffHandKind {
    BasicShield,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArmorPieceKind {
    ScoutHelm,
    ScoutChest,
    ScoutLegs,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PickupKind {
    Shield,
    Bow,
    Armor,
    Gold,
    GearToken,
    /// Dropped inventory stack (death loot, future trades).
    Item,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArmorSlots {
    pub head: Option<ArmorPieceKind>,
    pub chest: Option<ArmorPieceKind>,
    pub legs: Option<ArmorPieceKind>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentState {
    pub main_hand: MainHandKind,
    pub off_hand: Option<OffHandKind>,
    pub armor: ArmorSlots,
}

impl Default for EquipmentState {
    fn default() -> Self {
        Self {
            main_hand: MainHandKind::WoodenSword,
            off_hand: None,
            armor: ArmorSlots::default(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryEntry {
    pub kind: InventoryItemKind,
    pub count: u16,
}

#[derive(Clone, Debug, Default)]
pub struct InventoryState {
    counts: HashMap<InventoryItemKind, u16>,
}

impl InventoryState {
    pub fn starter() -> Self {
        let mut inventory = Self::default();
        inventory.add(InventoryItemKind::WoodenSword, 1);
        inventory
    }

    pub fn reset_to_starter(&mut self) {
        self.counts.clear();
        self.add(InventoryItemKind::WoodenSword, 1);
    }

    pub fn add(&mut self, kind: InventoryItemKind, amount: u16) {
        if amount == 0 {
            return;
        }
        let next = self.count(kind).saturating_add(amount);
        self.counts.insert(kind, next);
    }

    pub fn count(&self, kind: InventoryItemKind) -> u16 {
        self.counts.get(&kind).copied().unwrap_or(0)
    }

    pub fn has(&self, kind: InventoryItemKind) -> bool {
        self.count(kind) > 0
    }

    pub fn entries(&self) -> Vec<InventoryEntry> {
        let mut entries = self
            .counts
            .iter()
            .filter_map(|(kind, count)| {
                if *count == 0 {
                    None
                } else {
                    Some(InventoryEntry {
                        kind: *kind,
                        count: *count,
                    })
                }
            })
            .collect::<Vec<_>>();
        entries.sort_unstable_by_key(|entry| entry.kind);
        entries
    }

    /// Removes up to `amount` of `kind`, returning how many were removed.
    pub fn remove(&mut self, kind: InventoryItemKind, amount: u16) -> u16 {
        if amount == 0 {
            return 0;
        }
        let have = self.count(kind);
        let take = have.min(amount);
        if take == 0 {
            return 0;
        }
        let left = have - take;
        if left == 0 {
            self.counts.remove(&kind);
        } else {
            self.counts.insert(kind, left);
        }
        take
    }
}

impl MainHandKind {
    pub fn from_input(raw: &str) -> Option<Self> {
        match raw.to_ascii_lowercase().as_str() {
            "woodensword" | "wooden_sword" | "sword" => Some(Self::WoodenSword),
            "ironsword" | "iron_sword" => Some(Self::IronSword),
            "steelsword" | "steel_sword" => Some(Self::SteelSword),
            "vanguardsword" | "vanguard_sword" => Some(Self::VanguardSword),
            "shortbow" | "short_bow" | "bow" => Some(Self::ShortBow),
            _ => None,
        }
    }

    #[inline]
    pub const fn is_sword(self) -> bool {
        matches!(
            self,
            Self::WoodenSword | Self::IronSword | Self::SteelSword | Self::VanguardSword
        )
    }

    #[inline]
    #[allow(dead_code)]
    pub const fn is_bow(self) -> bool {
        matches!(self, Self::ShortBow)
    }
}

/// Authoritative melee strike damage for sword main hands. Bows use arrow damage instead.
pub fn melee_damage_for_main_hand(kind: MainHandKind) -> f64 {
    match kind {
        MainHandKind::WoodenSword => 22.0,
        MainHandKind::IronSword => 26.0,
        MainHandKind::SteelSword => 30.0,
        MainHandKind::VanguardSword => 36.0,
        MainHandKind::ShortBow => 0.0,
    }
}

impl OffHandKind {
    pub fn from_input(raw: &str) -> Option<Self> {
        match raw.to_ascii_lowercase().as_str() {
            "basicshield" | "basic_shield" | "shield" => Some(Self::BasicShield),
            _ => None,
        }
    }
}

pub fn inventory_item_for_main_hand(kind: MainHandKind) -> InventoryItemKind {
    match kind {
        MainHandKind::WoodenSword => InventoryItemKind::WoodenSword,
        MainHandKind::IronSword => InventoryItemKind::IronSword,
        MainHandKind::SteelSword => InventoryItemKind::SteelSword,
        MainHandKind::VanguardSword => InventoryItemKind::VanguardSword,
        MainHandKind::ShortBow => InventoryItemKind::ShortBow,
    }
}

/// Default main hand when the current choice is invalid: best owned sword, else bow.
pub fn default_main_hand_from_inventory(inv: &InventoryState) -> MainHandKind {
    const ORDER: [MainHandKind; 5] = [
        MainHandKind::VanguardSword,
        MainHandKind::SteelSword,
        MainHandKind::IronSword,
        MainHandKind::WoodenSword,
        MainHandKind::ShortBow,
    ];
    for k in ORDER {
        if inv.has(inventory_item_for_main_hand(k)) {
            return k;
        }
    }
    MainHandKind::WoodenSword
}

/// Gold received when selling one unit to a shop (0 = not sellable).
pub fn sell_price_gold(kind: InventoryItemKind) -> u32 {
    match kind {
        InventoryItemKind::WoodenSword => 0,
        InventoryItemKind::IronSword => 16,
        InventoryItemKind::SteelSword => 38,
        InventoryItemKind::VanguardSword => 72,
        InventoryItemKind::BasicShield => 12,
        InventoryItemKind::ShortBow => 20,
        InventoryItemKind::ScoutHelm => 7,
        InventoryItemKind::ScoutChest => 10,
        InventoryItemKind::ScoutLegs => 8,
        InventoryItemKind::GearUpgradeToken => 35,
    }
}

/// Parses client `camelCase` inventory kind strings (`woodenSword`, …).
pub fn inventory_item_kind_from_client(raw: &str) -> Option<InventoryItemKind> {
    match raw.trim() {
        "woodenSword" => Some(InventoryItemKind::WoodenSword),
        "ironSword" => Some(InventoryItemKind::IronSword),
        "steelSword" => Some(InventoryItemKind::SteelSword),
        "vanguardSword" => Some(InventoryItemKind::VanguardSword),
        "basicShield" => Some(InventoryItemKind::BasicShield),
        "shortBow" => Some(InventoryItemKind::ShortBow),
        "scoutHelm" => Some(InventoryItemKind::ScoutHelm),
        "scoutChest" => Some(InventoryItemKind::ScoutChest),
        "scoutLegs" => Some(InventoryItemKind::ScoutLegs),
        "gearUpgradeToken" => Some(InventoryItemKind::GearUpgradeToken),
        _ => None,
    }
}

pub fn inventory_item_for_off_hand(kind: OffHandKind) -> InventoryItemKind {
    match kind {
        OffHandKind::BasicShield => InventoryItemKind::BasicShield,
    }
}

pub fn armor_piece_inventory_kind(kind: ArmorPieceKind) -> InventoryItemKind {
    match kind {
        ArmorPieceKind::ScoutHelm => InventoryItemKind::ScoutHelm,
        ArmorPieceKind::ScoutChest => InventoryItemKind::ScoutChest,
        ArmorPieceKind::ScoutLegs => InventoryItemKind::ScoutLegs,
    }
}

pub fn equipment_armor_multiplier(armor: ArmorSlots) -> f64 {
    let mut damage: f64 = 1.0;
    if armor.head.is_some() {
        damage *= 0.92;
    }
    if armor.chest.is_some() {
        damage *= 0.78;
    }
    if armor.legs.is_some() {
        damage *= 0.9;
    }
    damage.clamp(0.45, 1.0)
}
