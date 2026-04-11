import { Game } from "./game/Game";
import {
  clearStoredSession,
  MultiplayerClient,
  readStoredSession,
} from "./net/multiplayer";

const canvasEl = document.getElementById("game-canvas");
if (!(canvasEl instanceof HTMLCanvasElement)) {
  throw new Error("vibeme2: #game-canvas not found or not a <canvas>");
}
/** Narrowed for async handlers (TS does not keep `instanceof` narrowing in closures). */
const gameCanvas: HTMLCanvasElement = canvasEl;

const hudHint = document.getElementById("hud") ?? undefined;
const safeZoneHint = document.getElementById("hud-safe") ?? undefined;
const creativeHint = document.getElementById("hud-creative") ?? undefined;
const hudCombat = document.getElementById("hud-combat") ?? undefined;
const hudCompass = document.getElementById("hud-compass") ?? undefined;
const shopPanel = document.getElementById("shop-panel") ?? undefined;
const joinPanel = document.getElementById("join-panel");
const joinNickname = document.getElementById("join-nickname");
const joinSubmit = document.getElementById("join-submit");
const joinError = document.getElementById("join-error");
const deathPanel = document.getElementById("death-panel");
const deathRevive = document.getElementById("death-revive");
const deathMenu = document.getElementById("death-menu");

let game: Game | undefined;
const BLOCKED_BROWSER_SHORTCUT_CODES = new Set(["KeyS", "KeyW"]);

function isBlockedBrowserShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return false;
  }
  const tag = target.tagName;
  return tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT";
}

function showJoinError(message: string): void {
  if (joinError) {
    joinError.textContent = message;
    joinError.classList.remove("hidden");
  }
}

function clearJoinError(): void {
  if (joinError) {
    joinError.textContent = "";
    joinError.classList.add("hidden");
  }
}

function hideJoinPanel(): void {
  joinPanel?.classList.add("hidden");
}

function showJoinPanel(): void {
  joinPanel?.classList.remove("hidden");
}

function showDeathPanel(): void {
  if (deathPanel) {
    deathPanel.classList.remove("hidden");
  }
  document.exitPointerLock();
}

function hideDeathPanel(): void {
  deathPanel?.classList.add("hidden");
}

function setDeathActionsDisabled(disabled: boolean): void {
  if (deathRevive instanceof HTMLButtonElement) {
    deathRevive.disabled = disabled;
  }
  if (deathMenu instanceof HTMLButtonElement) {
    deathMenu.disabled = disabled;
  }
}

function disposeGame(): void {
  game?.dispose();
  game = undefined;
}

async function startMultiplayer(options?: { freshSession?: boolean }): Promise<void> {
  if (!(joinNickname instanceof HTMLInputElement)) return;
  const nickname = joinNickname.value.trim();
  if (!nickname) {
    showJoinError("Enter a nickname.");
    return;
  }
  clearJoinError();
  if (joinSubmit instanceof HTMLButtonElement) {
    joinSubmit.disabled = true;
  }
  setDeathActionsDisabled(true);

  const stored = options?.freshSession ? null : readStoredSession();
  try {
    disposeGame();
    const mp = await MultiplayerClient.connect(
      { nickname, session: stored },
      (snap, localPlayerId) => {
        if (snap.deaths?.includes(localPlayerId)) {
          showDeathPanel();
        }
        game?.applyRemoteSnapshot(snap);
      },
    );
    game = new Game({
      canvas: gameCanvas,
      hudHint,
      safeZoneHint,
      creativeHint,
      hudCombat,
      localPlayerId: mp.id,
      compassEl: hudCompass,
      shopPanel,
    });
    game.attachMultiplayer(mp);
    hideJoinPanel();
    hideDeathPanel();
    game.start();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showJoinPanel();
    showJoinError(msg);
  } finally {
    if (joinSubmit instanceof HTMLButtonElement) {
      joinSubmit.disabled = false;
    }
    setDeathActionsDisabled(false);
  }
}

if (joinSubmit instanceof HTMLButtonElement) {
  joinSubmit.addEventListener("click", () => {
    void startMultiplayer();
  });
}

if (joinNickname instanceof HTMLInputElement) {
  joinNickname.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      void startMultiplayer();
    }
  });
}

if (deathRevive instanceof HTMLButtonElement) {
  deathRevive.addEventListener("click", () => {
    clearStoredSession();
    void startMultiplayer({ freshSession: true });
  });
}

if (deathMenu instanceof HTMLButtonElement) {
  deathMenu.addEventListener("click", () => {
    hideDeathPanel();
    clearStoredSession();
    disposeGame();
    showJoinPanel();
  });
}

document.addEventListener(
  "keydown",
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (!BLOCKED_BROWSER_SHORTCUT_CODES.has(e.code)) return;
    if (document.pointerLockElement !== gameCanvas) return;
    if (!isBlockedBrowserShortcutTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);

// Vite HMR cleanup so dev reloads don't stack up listeners + WebGL contexts.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeGame();
  });
}
