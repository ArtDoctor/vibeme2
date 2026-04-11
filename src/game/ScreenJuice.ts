import type { DamageFloatEvent } from "../net/types";

const FLOAT_LIFE_S = 0.9;

type Floating = { el: HTMLDivElement; age: number; left: number; top: number };

/**
 * Full-screen hurt vignette + incoming damage numbers (PvP / shared float events).
 */
export class ScreenJuice {
  private readonly overlay: HTMLElement;
  private readonly floatRoot: HTMLElement;
  private readonly floats: Floating[] = [];
  private hurtPulse = 0;
  private prevHp: number | null = null;

  constructor(options: { hurtOverlay: HTMLElement; floatRoot: HTMLElement }) {
    this.overlay = options.hurtOverlay;
    this.floatRoot = options.floatRoot;
  }

  syncFromSnapshot(
    localPlayerId: string,
    localX: number,
    localZ: number,
    localHp: number,
    damageFloats: readonly DamageFloatEvent[] | undefined,
  ): void {
    if (this.prevHp !== null && localHp < this.prevHp) {
      const delta = this.prevHp - localHp;
      this.hurtPulse = Math.min(1, this.hurtPulse + 0.35 + delta * 0.006);
    }
    this.prevHp = localHp;

    if (!damageFloats) {
      return;
    }
    for (const ev of damageFloats) {
      if (ev.sourceId === localPlayerId) {
        continue;
      }
      const dx = ev.x - localX;
      const dz = ev.z - localZ;
      if (dx * dx + dz * dz > 0.55 * 0.55) {
        continue;
      }
      this.spawnFloat(ev.amount, 0.42);
    }
  }

  update(delta: number): void {
    const d = Math.min(delta, 0.05);
    this.hurtPulse = Math.max(0, this.hurtPulse - d * 1.15);

    const lowHpFactor = this.prevHp !== null ? Math.max(0, 1 - this.prevHp / 100) : 0;
    const edge = Math.min(0.78, lowHpFactor * 0.5 + this.hurtPulse * 0.62);
    this.overlay.style.opacity = String(edge);

    const rect = this.floatRoot.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.age += d;
      const rise = f.age * 42;
      const t = f.age / FLOAT_LIFE_S;
      f.el.style.left = `${f.left * w}px`;
      f.el.style.top = `${f.top * h - rise}px`;
      f.el.style.opacity = String(Math.max(0, 1 - t));
      if (f.age >= FLOAT_LIFE_S) {
        f.el.remove();
        this.floats.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const f of this.floats) {
      f.el.remove();
    }
    this.floats.length = 0;
    this.overlay.style.opacity = "0";
  }

  private spawnFloat(amount: number, normX: number): void {
    const el = document.createElement("div");
    el.className = "damage-float damage-float--incoming";
    el.textContent = String(Math.round(amount));
    this.floatRoot.appendChild(el);
    const top = 0.38 + (Math.random() - 0.5) * 0.06;
    this.floats.push({
      el,
      age: 0,
      left: normX,
      top,
    });
  }
}
