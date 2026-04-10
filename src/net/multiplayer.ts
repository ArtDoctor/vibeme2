import type { SnapshotMsg, WelcomeMsg } from "./types";

const DEFAULT_SESSION_KEY = "vibeme2.session";

function wsUrlFromPage(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export interface MultiplayerOptions {
  nickname: string;
  /** Stored session UUID for reconnect; `null` for a fresh join. */
  session: string | null;
}

export class MultiplayerClient {
  readonly tickHz: number;
  private readonly ws: WebSocket;
  private readonly localPlayerId: string;
  private readonly sessionKey: string;
  private readonly onSnapshot: (msg: SnapshotMsg) => void;
  private sendInterval: ReturnType<typeof setInterval> | null = null;
  private getPose: (() => {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
  }) | null = null;
  private seq = 0;

  private constructor(
    ws: WebSocket,
    welcome: WelcomeMsg,
    onSnapshot: (msg: SnapshotMsg) => void,
  ) {
    this.ws = ws;
    this.localPlayerId = welcome.playerId;
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
          this.onSnapshot(data as SnapshotMsg);
        }
      } catch {
        /* ignore malformed */
      }
    });
  }

  static connect(
    options: MultiplayerOptions,
    onSnapshot: (msg: SnapshotMsg) => void,
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
            ? { type: "join" as const, nickname: options.nickname }
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

  /** Call once controls are ready; sends pose at server tick rate. */
  startSending(getPose: () => {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
  }): void {
    this.getPose = getPose;
    const ms = Math.max(16, Math.floor(1000 / this.tickHz));
    this.sendInterval = setInterval(() => {
      if (this.ws.readyState !== WebSocket.OPEN || !this.getPose) return;
      this.seq += 1;
      const p = this.getPose();
      const payload = {
        type: "input" as const,
        seq: this.seq,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
      };
      this.ws.send(JSON.stringify(payload));
    }, ms);
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
    return window.localStorage.getItem(DEFAULT_SESSION_KEY);
  } catch {
    return null;
  }
}
