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

export interface SnapshotMsg {
  type: "snapshot";
  tick: number;
  players: SnapshotPlayer[];
  /** Omitted by older servers; default to empty. */
  arrows?: SnapshotArrow[];
}
