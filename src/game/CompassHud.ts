import type { SnapshotMob } from "../net/types";

/** Fallback if layout not ready (must match `.hud-compass` `--compass-cell-w` in CSS). */
const CELL_PX_FALLBACK = 583;
/** Repeated W–N–E–S blocks; must cover lead alignment + shift range (see `update`). */
const COMPASS_STRIP_CYCLES = 28;
const ENEMY_DETECT_RADIUS = 48;
const MAX_ENEMY_MARKERS = 10;

function modTau(yaw: number): number {
  const tau = 2 * Math.PI;
  return ((yaw % tau) + tau) % tau;
}

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
    for (let r = 0; r < COMPASS_STRIP_CYCLES; r += 1) {
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
    const inner = this.track.querySelector(".hud-compass-track-inner");
    if (inner instanceof HTMLElement) {
      const first = inner.firstElementChild;
      let cellW = CELL_PX_FALLBACK;
      if (first instanceof HTMLElement) {
        const w = first.offsetWidth;
        if (w > 0) cellW = w;
      } else {
        const raw = getComputedStyle(this.root).getPropertyValue("--compass-cell-w").trim();
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed) && parsed > 0) cellW = parsed;
      }
      const cyclePx = cellW * 4;
      const nCenterPx = cellW * 1.5;
      const halfW = this.track.clientWidth * 0.5;
      /** When `halfW > nCenterPx`, anchoring to the first N leaves empty space on the left; use a deeper cycle. */
      const alignCycle = Math.min(
        Math.max(0, Math.ceil((halfW - nCenterPx) / cyclePx)),
        COMPASS_STRIP_CYCLES - 3,
      );
      const northCenterPx = alignCycle * cyclePx + nCenterPx;
      const wrappedYaw = modTau(yaw);
      const shift = (wrappedYaw / (2 * Math.PI)) * cyclePx;
      const tx = halfW - northCenterPx - shift;
      inner.style.transform = `translateX(${tx}px)`;
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
