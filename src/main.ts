import { Game } from "./game/Game";
import { MultiplayerClient, readStoredSession } from "./net/multiplayer";

const canvasEl = document.getElementById("game-canvas");
if (!(canvasEl instanceof HTMLCanvasElement)) {
  throw new Error("vibeme2: #game-canvas not found or not a <canvas>");
}
/** Narrowed for async handlers (TS does not keep `instanceof` narrowing in closures). */
const gameCanvas: HTMLCanvasElement = canvasEl;

const hudHint = document.getElementById("hud") ?? undefined;
const safeZoneHint = document.getElementById("hud-safe") ?? undefined;
const joinPanel = document.getElementById("join-panel");
const joinNickname = document.getElementById("join-nickname");
const joinSubmit = document.getElementById("join-submit");
const joinError = document.getElementById("join-error");

let game: Game | undefined;

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

async function startMultiplayer(): Promise<void> {
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

  const stored = readStoredSession();
  try {
    const mp = await MultiplayerClient.connect(
      { nickname, session: stored },
      (snap) => {
        game?.applyRemoteSnapshot(snap);
      },
    );
    game = new Game({
      canvas: gameCanvas,
      hudHint,
      safeZoneHint,
      localPlayerId: mp.id,
    });
    game.attachMultiplayer(mp);
    hideJoinPanel();
    game.start();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showJoinError(msg);
  } finally {
    if (joinSubmit instanceof HTMLButtonElement) {
      joinSubmit.disabled = false;
    }
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

// Vite HMR cleanup so dev reloads don't stack up listeners + WebGL contexts.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
    game = undefined;
  });
}
