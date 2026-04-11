import { MOB_HP, TRAINING_DUMMY_HP } from "../combat/constants";
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

export function normalizeWeaponKind(raw: unknown): WeaponKind {
  if (raw === "sword" || raw === "shield" || raw === "bow") {
    return raw;
  }
  return DEFAULT_WEAPON;
}

export function normalizeMainHandKind(raw: unknown): MainHandKind {
  if (raw === "shortBow") {
    return "shortBow";
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
    case "basicShield":
    case "shortBow":
    case "scoutHelm":
    case "scoutChest":
    case "scoutLegs":
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
  if (raw === "bow" || raw === "armor") {
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
  };
}

function mobKind(v: unknown): MobKind {
  return v === "trainingDummy" ? "trainingDummy" : "creep";
}

export function normalizeSnapshotMob(raw: unknown): SnapshotMob {
  const o =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : {};

  const kind = mobKind(o.kind);
  const defaultMax = kind === "trainingDummy" ? TRAINING_DUMMY_HP : MOB_HP;
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
  return {
    id: Math.max(0, Math.floor(num(o.id, 0))),
    kind: normalizePickupKind(o.kind),
    x: num(o.x, 0),
    y: num(o.y, 0),
    z: num(o.z, 0),
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
