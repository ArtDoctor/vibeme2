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

export interface SnapshotPlayer {
  id: string;
  nickname: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface SnapshotMsg {
  type: "snapshot";
  tick: number;
  players: SnapshotPlayer[];
}
