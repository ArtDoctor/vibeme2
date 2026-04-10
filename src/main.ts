import { Game } from "./game/Game";

const canvas = document.getElementById("game-canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("vibeme2: #game-canvas not found or not a <canvas>");
}

const hudHint = document.getElementById("hud") ?? undefined;
const safeZoneHint = document.getElementById("hud-safe") ?? undefined;

const game = new Game({ canvas, hudHint, safeZoneHint });
game.start();

// Vite HMR cleanup so dev reloads don't stack up listeners + WebGL contexts.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}
