use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, Ord, PartialOrd)]
#[serde(rename_all = "camelCase")]
pub enum InventoryItemKind {
    WoodenSword,
    BasicShield,
    ShortBow,
    ScoutHelm,
    ScoutChest,
    ScoutLegs,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MainHandKind {
    WoodenSword,
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
}

impl MainHandKind {
    pub fn from_input(raw: &str) -> Option<Self> {
        match raw.to_ascii_lowercase().as_str() {
            "woodensword" | "wooden_sword" | "sword" => Some(Self::WoodenSword),
            "shortbow" | "short_bow" | "bow" => Some(Self::ShortBow),
            _ => None,
        }
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
        MainHandKind::ShortBow => InventoryItemKind::ShortBow,
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
