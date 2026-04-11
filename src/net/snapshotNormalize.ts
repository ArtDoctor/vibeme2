import {
  BOSS_SUMMONER_HP,
  BOSS_TANK_HP,
  MOB_HP,
  TRAINING_DUMMY_HP,
} from "../combat/constants";
import type {
  ArmorPieceKind,
  ArmorSlots,
  DamageFloatEvent,
  InventoryEntry,
  InventoryItemKind,
  MainHandKind,
  MobKind,
  OffHandKind,
  PickupKind,
  SnapshotPickup,
  SnapshotArrow,
  SnapshotMob,
  SnapshotMsg,
  PlayerTeam,
  SnapshotPlayer,
  WeaponKind,
} from "./types";

export const DEFAULT_WEAPON: WeaponKind = "sword";
export const DEFAULT_MAIN_HAND: MainHandKind = "woodenSword";

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return fallback;
}

function str(v: unknown, fallback: string): string {
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function normalizePlayerTeam(raw: unknown): PlayerTeam {
  if (raw === "red" || raw === "blue" || raw === "neutral") {
    return raw;
  }
  return "neutral";
}

export function normalizeWeaponKind(raw: unknown): WeaponKind {
  if (raw === "sword" || raw === "shield" || raw === "bow") {
    return raw;
  }
  return DEFAULT_WEAPON;
}

export function normalizeMainHandKind(raw: unknown): MainHandKind {
  if (
    raw === "woodenSword" ||
    raw === "shortBow" ||
    raw === "ironSword" ||
    raw === "steelSword" ||
    raw === "vanguardSword"
  ) {
    return raw;
  }
  return DEFAULT_MAIN_HAND;
}

export function normalizeOffHandKind(raw: unknown): OffHandKind | null {
  return raw === "basicShield" ? "basicShield" : null;
}

function normalizeArmorPieceKind(raw: unknown): ArmorPieceKind | null {
  if (raw === "scoutHelm" || raw === "scoutChest" || raw === "scoutLegs") {
    return raw;
  }
  return null;
}

function normalizeInventoryItemKind(raw: unknown): InventoryItemKind {
  switch (raw) {
    case "woodenSword":
    case "ironSword":
    case "steelSword":
    case "vanguardSword":
    case "basicShield":
    case "shortBow":
    case "scoutHelm":
    case "scoutChest":
    case "scoutLegs":
    case "gearUpgradeToken":
      return raw;
    default:
      return "woodenSword";
  }
}

function normalizeArmorSlots(raw: unknown): ArmorSlots {
  const o =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  return {
    head: normalizeArmorPieceKind(o.head),
    chest: normalizeArmorPieceKind(o.chest),
    legs: normalizeArmorPieceKind(o.legs),
  };
}

function normalizeInventoryEntry(raw: unknown): InventoryEntry {
  const o =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  return {
    kind: normalizeInventoryItemKind(o.kind),
    count: Math.max(0, Math.floor(num(o.count, 0))),
  };
}

function normalizePickupKind(raw: unknown): PickupKind {
  if (
    raw === "bow" ||
    raw === "armor" ||
    raw === "gold" ||
    raw === "gearToken" ||
    raw === "item"
  ) {
    return raw;
  }
  return "shield";
}

/**
 * Coerce WebSocket JSON into a complete `SnapshotPlayer` so older servers,
 * partial payloads, or bad values cannot leave `undefined` (which breaks HUD
 * and Three.js animation math).
 */
export function normalizeSnapshotPlayer(raw: unknown): SnapshotPlayer {
  const o =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  const mainHand = normalizeMainHandKind(o.mainHand);

  return {
    id: str(o.id, ""),
    nickname: str(o.nickname, "player"),
    team: normalizePlayerTeam(o.team),
    x: num(o.x, 0),
    y: num(o.y, 0),
    z: num(o.z, 0),
    yaw: num(o.yaw, 0),
    pitch: num(o.pitch, 0),
    hp: num(o.hp, 100),
    stamina: num(o.stamina, 100),
    gold: Math.max(0, Math.floor(num(o.gold, 0))),
    mainHand,
    offHand: normalizeOffHandKind(o.offHand),
    armor: normalizeArmorSlots(o.armor),
    inventory: Array.isArray(o.inventory)
      ? o.inventory.map(normalizeInventoryEntry).filter((entry) => entry.count > 0)
      : [{ kind: "woodenSword", count: 1 }],
    weapon: normalizeWeaponKind(o.weapon ?? (mainHand === "shortBow" ? "bow" : "sword")),
    blocking: bool(o.blocking, false),
    bowCharge: Math.min(1, Math.max(0, num(o.bowCharge, 0))),
    swingT: Math.min(1, Math.max(0, num(o.swingT, 0))),
    bossUnlock: bool(o.bossUnlock, false),
  };
}

function mobKind(v: unknown): MobKind {
  if (
    v === "trainingDummy" ||
    v === "bossTank" ||
    v === "bossSummoner"
  ) {
    return v;
  }
  return "creep";
}

function defaultMaxHpForMobKind(kind: MobKind): number {
  switch (kind) {
    case "trainingDummy":
      return TRAINING_DUMMY_HP;
    case "bossTank":
      return BOSS_TANK_HP;
    case "bossSummoner":
      return BOSS_SUMMONER_HP;
    default:
      return MOB_HP;
  }
}

export function normalizeSnapshotMob(raw: unknown): SnapshotMob {
  const o =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};

  const kind = mobKind(o.kind);
  const defaultMax = defaultMaxHpForMobKind(kind);
  return {
    id: Math.max(0, Math.floor(num(o.id, 0))),
    x: num(o.x, 0),
    y: num(o.y, 0),
    z: num(o.z, 0),
    hp: num(o.hp, 0),
    maxHp: num(o.maxHp, defaultMax),
    kind,
  };
}

export function normalizeDamageFloatEvent(raw: unknown): DamageFloatEvent {
  const o =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};

  return {
    sourceId: str(o.sourceId, ""),
    x: num(o.x, 0),
    y: num(o.y, 0),
    z: num(o.z, 0),
    amount: num(o.amount, 0),
  };
}

export function normalizeSnapshotArrow(raw: unknown): SnapshotArrow {
  const o =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};

  return {
    id: Math.max(0, Math.floor(num(o.id, 0))),
    x: num(o.x, 0),
    y: num(o.y, 0),
    z: num(o.z, 0),
    yaw: num(o.yaw, 0),
  };
}

export function normalizeSnapshotPickup(raw: unknown): SnapshotPickup {
  const o =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};
  const kind = normalizePickupKind(o.kind);
  const goldRaw = num(o.goldAmount, 0);
  const itemCountRaw = Math.max(0, Math.floor(num(o.itemCount, 0)));
  const itemKind =
    kind === "item" && itemCountRaw > 0
      ? normalizeInventoryItemKind(o.itemKind)
      : undefined;
  return {
    id: Math.max(0, Math.floor(num(o.id, 0))),
    kind,
    x: num(o.x, 0),
    y: num(o.y, 0),
    z: num(o.z, 0),
    ...(kind === "gold" && goldRaw > 0 ? { goldAmount: Math.floor(goldRaw) } : {}),
    ...(kind === "item" && itemKind !== undefined && itemCountRaw > 0
      ? { itemKind, itemCount: itemCountRaw }
      : {}),
  };
}

export function normalizeSnapshotMsg(raw: unknown): SnapshotMsg {
  const o =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};

  const playersIn = o.players;
  const players: SnapshotPlayer[] = Array.isArray(playersIn)
    ? playersIn.map(normalizeSnapshotPlayer)
    : [];

  const tick = num(o.tick, 0);

  const arrowsIn = o.arrows;
  const arrows: SnapshotArrow[] | undefined = Array.isArray(arrowsIn)
    ? arrowsIn.map(normalizeSnapshotArrow)
    : undefined;

  const pickupsIn = o.pickups;
  const pickups: SnapshotPickup[] | undefined = Array.isArray(pickupsIn)
    ? pickupsIn.map(normalizeSnapshotPickup)
    : undefined;

  const mobsIn = o.mobs;
  const mobs: SnapshotMob[] = Array.isArray(mobsIn)
    ? mobsIn.map(normalizeSnapshotMob)
    : [];

  const damageFloatsIn = o.damageFloats;
  const damageFloats: DamageFloatEvent[] | undefined = Array.isArray(damageFloatsIn)
    ? damageFloatsIn.map(normalizeDamageFloatEvent)
    : undefined;

  const deathsIn = o.deaths;
  const deaths: string[] | undefined = Array.isArray(deathsIn)
    ? deathsIn.map((id) => str(id, "")).filter((s) => s.length > 0)
    : undefined;

  return {
    type: "snapshot",
    tick,
    players,
    ...(arrows !== undefined && arrows.length > 0 ? { arrows } : {}),
    ...(pickups !== undefined && pickups.length > 0 ? { pickups } : {}),
    mobs,
    ...(damageFloats !== undefined && damageFloats.length > 0
      ? { damageFloats }
      : {}),
    ...(deaths !== undefined && deaths.length > 0 ? { deaths } : {}),
  };
}
