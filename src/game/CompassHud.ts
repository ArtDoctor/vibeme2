import type { SnapshotMob } from "../net/types";

/** Pixels the cardinal strip shifts per full world turn (tuned to cell width). */
const COMPASS_PX_PER_2PI = 208;
const CELL_PX = 52;
/** First "N" in the strip is at index 1 (after W); center that cell under the pointer when facing north. */
const FIRST_N_CENTER_PX = CELL_PX * 1.5;
const ENEMY_DETECT_RADIUS = 48;
const MAX_ENEMY_MARKERS = 10;

function wrapAngleRad(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Signed angle from camera forward to a point in XZ. */
function bearingToPoint(
  yaw: number,
  px: number,
  pz: number,
  tx: number,
  tz: number,
): number | null {
  const dx = tx - px;
  const dz = tz - pz;
  const d = Math.hypot(dx, dz);
  if (d < 0.25) return null;
  const mx = dx / d;
  const mz = dz / d;
  const fx = Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return Math.atan2(fx * mz - fz * mx, fx * mx + fz * mz);
}

/**
 * Top-of-screen compass (N/E/S/W) plus small markers for the closest mobs within radius.
 */
export class CompassHud {
  private readonly root: HTMLElement;
  private readonly track: HTMLElement;
  private readonly enemies: HTMLElement;
  private readonly markerPool: HTMLElement[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
    const tr = root.querySelector("[data-compass-track]");
    if (!(tr instanceof HTMLElement)) {
      throw new Error("CompassHud: [data-compass-track] missing");
    }
    this.track = tr;
    const en = root.querySelector("[data-compass-enemies]");
    if (!(en instanceof HTMLElement)) {
      throw new Error("CompassHud: [data-compass-enemies] missing");
    }
    this.enemies = en;

    const cardinals = ["W", "N", "E", "S"] as const;
    const cells: string[] = [];
    for (let r = 0; r < 5; r += 1) {
      for (const c of cardinals) {
        cells.push(`<span class="hud-compass-cell">${c}</span>`);
      }
    }
    this.track.innerHTML = `<div class="hud-compass-track-inner">${cells.join("")}</div>`;

    for (let i = 0; i < MAX_ENEMY_MARKERS; i += 1) {
      const m = document.createElement("div");
      m.className = "hud-compass-enemy";
      m.hidden = true;
      this.enemies.appendChild(m);
      this.markerPool.push(m);
    }
  }

  update(
    yaw: number,
    px: number,
    pz: number,
    mobs: readonly SnapshotMob[],
  ): void {
    const shift = (yaw / (2 * Math.PI)) * COMPASS_PX_PER_2PI;
    const inner = this.track.querySelector(".hud-compass-track-inner");
    if (inner instanceof HTMLElement) {
      const halfW = this.track.clientWidth * 0.5;
      inner.style.transform = `translateX(${halfW - FIRST_N_CENTER_PX - shift}px)`;
    }

    const scored = mobs
      .map((m) => {
        const dx = m.x - px;
        const dz = m.z - pz;
        const d = Math.hypot(dx, dz);
        return { m, d };
      })
      .filter((x) => x.d <= ENEMY_DETECT_RADIUS && x.m.hp > 0)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_ENEMY_MARKERS);

    for (let i = 0; i < this.markerPool.length; i += 1) {
      const el = this.markerPool[i];
      const row = scored[i];
      if (!row) {
        el.hidden = true;
        continue;
      }
      const bear = bearingToPoint(yaw, px, pz, row.m.x, row.m.z);
      if (bear === null) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      const u = wrapAngleRad(bear) / Math.PI;
      const spread = 44;
      const pct = Math.max(-spread, Math.min(spread, u * spread));
      el.style.left = `calc(50% + ${pct}%)`;
      const near = row.d < ENEMY_DETECT_RADIUS * 0.35;
      el.classList.toggle("hud-compass-enemy--near", near);
    }
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }

  dispose(): void {
    for (const el of this.markerPool) {
      el.remove();
    }
    this.markerPool.length = 0;
    this.track.innerHTML = "";
    this.root.classList.add("hidden");
  }
}
