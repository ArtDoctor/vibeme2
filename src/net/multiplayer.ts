import type { PlayerTeam, SnapshotMsg, WelcomeMsg } from "./types";
import { normalizeSnapshotMsg } from "./snapshotNormalize";

const DEFAULT_SESSION_KEY = "vibeme2.session";
const LEGACY_SESSION_KEY = "solis-gladius.session";

function wsUrlFromPage(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export interface MultiplayerOptions {
  nickname: string;
  /** Stored session UUID for reconnect; `null` for a fresh join. */
  session: string | null;
  /** Required when `session` is `null` — must match server `team_from_join_str`. */
  team?: PlayerTeam;
}

export class MultiplayerClient {
  readonly tickHz: number;
  /** Server-assigned faction (welcome message). */
  readonly team: PlayerTeam;
  private readonly ws: WebSocket;
  private readonly localPlayerId: string;
  private readonly sessionKey: string;
  private readonly onSnapshot: (msg: SnapshotMsg, localPlayerId: string) => void;
  private sendInterval: ReturnType<typeof setInterval> | null = null;
  private getInputPayload: (() => {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    creative: boolean;
    flying: boolean;
    sprinting: boolean;
    mainHand: string;
    offHand: string | null;
    blocking: boolean;
    bowCharge: number;
    swing: boolean;
    fireArrow: boolean;
  }) | null = null;
  private seq = 0;

  private constructor(
    ws: WebSocket,
    welcome: WelcomeMsg,
    onSnapshot: (msg: SnapshotMsg, localPlayerId: string) => void,
  ) {
    this.ws = ws;
    this.localPlayerId = welcome.playerId;
    this.team = welcome.team;
    this.tickHz = welcome.tickHz;
    this.sessionKey = welcome.sessionStorageKey ?? DEFAULT_SESSION_KEY;
    this.onSnapshot = onSnapshot;
    try {
      window.localStorage.setItem(this.sessionKey, welcome.session);
    } catch {
      /* private mode / blocked */
    }

    this.ws.addEventListener("message", (ev: MessageEvent<string>) => {
      try {
        const data = JSON.parse(ev.data as string) as { type?: string };
        if (data.type === "snapshot") {
          this.onSnapshot(normalizeSnapshotMsg(data), this.localPlayerId);
        }
      } catch {
        /* ignore malformed */
      }
    });
  }

  static connect(
    options: MultiplayerOptions,
    onSnapshot: (msg: SnapshotMsg, localPlayerId: string) => void,
  ): Promise<MultiplayerClient> {
    const hadSession = options.session !== null;
    return MultiplayerClient.connectOnce(options, onSnapshot).catch((err) => {
      if (isStaleSessionJoinError(err, hadSession)) {
        clearStoredSession();
        return MultiplayerClient.connectOnce(
          { ...options, session: null },
          onSnapshot,
        );
      }
      throw err;
    });
  }

  private static connectOnce(
    options: MultiplayerOptions,
    onSnapshot: (msg: SnapshotMsg, localPlayerId: string) => void,
  ): Promise<MultiplayerClient> {
    const ws = new WebSocket(wsUrlFromPage());
    return new Promise((resolve, reject) => {
      const fail = (err: Error): void => {
        reject(err);
      };

      ws.addEventListener("error", () => {
        fail(new Error("WebSocket connection failed."));
      });

      ws.addEventListener("open", () => {
        const payload =
          options.session === null
            ? {
                type: "join" as const,
                nickname: options.nickname,
                team: options.team,
              }
            : {
                type: "join" as const,
                nickname: options.nickname,
                session: options.session,
              };
        ws.send(JSON.stringify(payload));
      });

      ws.addEventListener("message", function onFirst(ev: MessageEvent<string>) {
        try {
          const data = JSON.parse(ev.data as string) as {
            type?: string;
          };
          if (data.type === "welcome") {
            ws.removeEventListener("message", onFirst);
            const welcome = data as WelcomeMsg;
            resolve(new MultiplayerClient(ws, welcome, onSnapshot));
            return;
          }
          if (data.type === "joinError") {
            ws.removeEventListener("message", onFirst);
            const msg =
              typeof (data as { message?: string }).message === "string"
                ? (data as { message: string }).message
                : "Join failed.";
            fail(new Error(msg));
          }
        } catch (e) {
          fail(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
  }

  get id(): string {
    return this.localPlayerId;
  }

  /** Call once controls are ready; sends pose + combat at server tick rate. */
  startSending(getInputPayload: () => {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    creative: boolean;
    flying: boolean;
    sprinting: boolean;
    mainHand: string;
    offHand: string | null;
    blocking: boolean;
    bowCharge: number;
    swing: boolean;
    fireArrow: boolean;
  }): void {
    this.getInputPayload = getInputPayload;
    const ms = Math.max(16, Math.floor(1000 / this.tickHz));
    this.sendInterval = setInterval(() => {
      if (this.ws.readyState !== WebSocket.OPEN || !this.getInputPayload) return;
      this.seq += 1;
      const p = this.getInputPayload();
      const payload = {
        type: "input" as const,
        seq: this.seq,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
        creative: p.creative,
        flying: p.flying,
        sprinting: p.sprinting,
        mainHand: p.mainHand,
        offHand: p.offHand ?? "",
        blocking: p.blocking,
        bowCharge: p.bowCharge,
        swing: p.swing,
        fireArrow: p.fireArrow,
      };
      this.ws.send(JSON.stringify(payload));
    }, ms);
  }

  /** Buy one unit (server validates gold + range). */
  sendShopBuy(shopIndex: number, buySku: string): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "shop",
        shopIndex,
        buySku,
      }),
    );
  }

  /** Sell stackable items for gold (server validates range + price). */
  sendShopSell(shopIndex: number, kind: string, count: number): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "shop",
        shopIndex,
        sell: { kind, count },
      }),
    );
  }

  /** Proximity chat; server validates rate, length, and filters profanity. */
  sendChat(text: string): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "chat", text }));
  }

  dispose(): void {
    if (this.sendInterval !== null) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
    this.ws.close();
  }
}

export function readStoredSession(): string | null {
  try {
    return (
      window.localStorage.getItem(DEFAULT_SESSION_KEY) ??
      window.localStorage.getItem(LEGACY_SESSION_KEY)
    );
  } catch {
    return null;
  }
}

export function clearStoredSession(): void {
  try {
    window.localStorage.removeItem(DEFAULT_SESSION_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    /* private mode / blocked */
  }
}

/** Server removes the session when the tab disconnects; stale tokens need a fresh join. */
function isStaleSessionJoinError(err: unknown, hadSession: boolean): boolean {
  if (!hadSession || !(err instanceof Error)) return false;
  return err.message.includes("expired session");
}
