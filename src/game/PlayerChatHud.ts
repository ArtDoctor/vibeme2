import type { SnapshotChatMessage } from "../net/types";

const CHAT_TOAST_VISIBLE_MS = 15_000;
const CHAT_TTL_MS = 60_000;
const MAX_FEED_LINES = 24;

export interface PlayerChatHudOptions {
  root: HTMLElement;
  /** When true, chat hotkeys are ignored (e.g. death or menu). */
  isBlocked: () => boolean;
  onComposeOpen: () => void;
  onComposeClose: () => void;
  onSend: (text: string) => void;
}

interface LineState {
  id: string;
  senderNickname: string;
  text: string;
  sentAtUnixMs: number;
  firstSeenPerfMs: number;
}

/**
 * Bottom-left proximity chat feed + compose (T). Toasts fade after 15s unless the compose
 * overlay is open (full recent history for up to 60s server TTL).
 */
export class PlayerChatHud {
  private readonly root: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly inputWrap: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly isBlocked: () => boolean;
  private readonly onComposeOpen: () => void;
  private readonly onComposeClose: () => void;
  private readonly onSend: (text: string) => void;
  private readonly knownIds = new Set<string>();
  private readonly lines: LineState[] = [];
  private composeOpen = false;

  constructor(options: PlayerChatHudOptions) {
    this.root = options.root;
    this.isBlocked = options.isBlocked;
    this.onComposeOpen = options.onComposeOpen;
    this.onComposeClose = options.onComposeClose;
    this.onSend = options.onSend;

    const log = options.root.querySelector("[data-chat-log]");
    const wrap = options.root.querySelector("[data-chat-input-wrap]");
    const inp = options.root.querySelector("[data-chat-input]");
    if (!(log instanceof HTMLElement)) {
      throw new Error("PlayerChatHud: [data-chat-log] missing");
    }
    if (!(wrap instanceof HTMLElement)) {
      throw new Error("PlayerChatHud: [data-chat-input-wrap] missing");
    }
    if (!(inp instanceof HTMLInputElement)) {
      throw new Error("PlayerChatHud: [data-chat-input] missing");
    }
    this.logEl = log;
    this.inputWrap = wrap;
    this.inputEl = inp;

    document.addEventListener("keydown", this.onDocKeydown, true);
    this.inputEl.addEventListener("keydown", this.onInputKeydown);
  }

  mergeFromSnapshot(chat: readonly SnapshotChatMessage[] | undefined): void {
    if (!chat || chat.length === 0) return;
    const perfNow = performance.now();
    const wallNow = Date.now();
    for (const m of chat) {
      if (this.knownIds.has(m.id)) continue;
      this.knownIds.add(m.id);
      this.lines.push({
        id: m.id,
        senderNickname: m.senderNickname,
        text: m.text,
        sentAtUnixMs: m.sentAtUnixMs,
        firstSeenPerfMs: perfNow,
      });
    }
    while (this.lines.length > MAX_FEED_LINES) {
      const dropped = this.lines.shift();
      if (dropped) this.knownIds.delete(dropped.id);
    }
    this.pruneExpired(wallNow);
    this.render();
  }

  update(): void {
    this.pruneExpired(Date.now());
    this.render();
  }

  dispose(): void {
    document.removeEventListener("keydown", this.onDocKeydown, true);
    this.inputEl.removeEventListener("keydown", this.onInputKeydown);
  }

  private pruneExpired(wallNow: number): void {
    const cutoff = wallNow - CHAT_TTL_MS;
    const next: LineState[] = [];
    for (const line of this.lines) {
      if (line.sentAtUnixMs >= cutoff) {
        next.push(line);
      } else {
        this.knownIds.delete(line.id);
      }
    }
    this.lines.length = 0;
    this.lines.push(...next);
  }

  private render(): void {
    const perfNow = performance.now();
    this.logEl.replaceChildren();
    for (const line of this.lines) {
      const row = document.createElement("div");
      row.className = "hud-chat-line";
      const nick = document.createElement("span");
      nick.className = "hud-chat-nick";
      nick.textContent = `${line.senderNickname}: `;
      const body = document.createElement("span");
      body.className = "hud-chat-text";
      body.textContent = line.text;
      row.appendChild(nick);
      row.appendChild(body);

      if (!this.composeOpen) {
        const age = perfNow - line.firstSeenPerfMs;
        if (age > CHAT_TOAST_VISIBLE_MS) {
          row.classList.add("hud-chat-line--hidden");
        }
      }
      this.logEl.appendChild(row);
    }
  }

  private readonly onDocKeydown = (e: KeyboardEvent): void => {
    if (e.code !== "KeyT" || e.repeat) return;
    if (this.isBlocked()) return;
    if (e.target instanceof HTMLInputElement && e.target !== this.inputEl) {
      return;
    }
    if (e.target instanceof HTMLTextAreaElement) return;
    const canvas = document.getElementById("game-canvas");
    if (!this.composeOpen && document.pointerLockElement !== canvas) {
      return;
    }
    e.preventDefault();
    this.toggleCompose();
  };

  private readonly onInputKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      void this.trySend();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.closeCompose();
    }
  };

  private toggleCompose(): void {
    if (this.composeOpen) {
      this.closeCompose();
    } else {
      this.openCompose();
    }
  }

  private openCompose(): void {
    this.composeOpen = true;
    this.inputWrap.classList.remove("hidden");
    this.root.classList.add("hud-chat--compose");
    this.onComposeOpen();
    this.inputEl.focus();
    this.render();
  }

  private closeCompose(): void {
    if (!this.composeOpen) return;
    this.composeOpen = false;
    this.inputWrap.classList.add("hidden");
    this.root.classList.remove("hud-chat--compose");
    this.inputEl.value = "";
    this.onComposeClose();
    this.render();
  }

  private trySend(): void {
    const raw = this.inputEl.value.trim();
    if (raw.length === 0) {
      this.closeCompose();
      return;
    }
    this.inputEl.value = "";
    this.onSend(raw);
    this.closeCompose();
  }
}
