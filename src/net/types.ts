export type ServerMsg =
  | WelcomeMsg
  | JoinErrorMsg
  | SnapshotMsg;

export interface WelcomeMsg {
  type: "welcome";
  session: string;
  playerId: string;
  tickHz: number;
  sessionStorageKey?: string;
}

export interface JoinErrorMsg {
  type: "joinError";
  message: string;
}

export type WeaponKind = "sword" | "shield" | "bow";
export type MainHandKind = "woodenSword" | "shortBow";
export type OffHandKind = "basicShield";
export type ArmorPieceKind = "scoutHelm" | "scoutChest" | "scoutLegs";
export type InventoryItemKind =
  | "woodenSword"
  | "basicShield"
  | "shortBow"
  | "scoutHelm"
  | "scoutChest"
  | "scoutLegs";
export type PickupKind = "shield" | "bow" | "armor";

export interface InventoryEntry {
  kind: InventoryItemKind;
  count: number;
}

export interface ArmorSlots {
  head: ArmorPieceKind | null;
  chest: ArmorPieceKind | null;
  legs: ArmorPieceKind | null;
}

export interface SnapshotPlayer {
  id: string;
  nickname: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  stamina: number;
  gold: number;
  mainHand: MainHandKind;
  offHand: OffHandKind | null;
  armor: ArmorSlots;
  inventory: InventoryEntry[];
  weapon: WeaponKind;
  blocking: boolean;
  bowCharge: number;
  /** 0–1 swing animation phase for remote rigs. */
  swingT: number;
}

export interface SnapshotArrow {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface SnapshotPickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
}

export type MobKind = "creep" | "trainingDummy";

export interface SnapshotMob {
  id: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  kind: MobKind;
}

export interface DamageFloatEvent {
  sourceId: string;
  x: number;
  y: number;
  z: number;
  amount: number;
}

export interface SnapshotMsg {
  type: "snapshot";
  tick: number;
  players: SnapshotPlayer[];
  /** Omitted by older servers; default to empty. */
  arrows?: SnapshotArrow[];
  /** Omitted by older servers; default to empty. */
  pickups?: SnapshotPickup[];
  /** Omitted by older servers; default to empty. */
  mobs: SnapshotMob[];
  /** Omitted when no damage events this tick. */
  damageFloats?: DamageFloatEvent[];
  /** Player ids who died this tick (server respawns immediately; used for UI). */
  deaths?: readonly string[];
}
