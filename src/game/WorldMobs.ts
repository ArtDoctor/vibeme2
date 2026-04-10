import {
  BoxGeometry,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three";
import type { DamageFloatEvent, SnapshotMob } from "../net/types";

const CREEP_MAT = new MeshLambertMaterial({ color: 0x8b4513 });
const DUMMY_MAT = new MeshLambertMaterial({ color: 0x8a8a78 });

const FLOAT_LIFE_S = 0.85;
const MOB_BAR_Y = 0.52;

type MobView = {
  mesh: Mesh;
  barOuter: HTMLDivElement;
  barFill: HTMLDivElement;
  hp: number;
  maxHp: number;
};

type FloatingDamage = {
  el: HTMLDivElement;
  age: number;
  wx: number;
  wy: number;
  wz: number;
};

/**
 * Server-driven mob meshes plus screen-space HP bars and local damage floats.
 */
export class WorldMobs {
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly overlay: HTMLDivElement;
  private readonly byId = new Map<number, MobView>();
  private readonly scratch = new Vector3();
  private readonly forward = new Vector3();
  private readonly floats: FloatingDamage[] = [];
  private readonly localPlayerId: string;

  constructor(scene: Scene, camera: PerspectiveCamera, localPlayerId: string) {
    this.scene = scene;
    this.camera = camera;
    this.localPlayerId = localPlayerId;
    this.overlay = document.createElement("div");
    this.overlay.className = "world-mob-overlay";
    const app = document.getElementById("app");
    if (app) {
      app.appendChild(this.overlay);
    } else {
      document.body.appendChild(this.overlay);
    }
  }

  sync(mobs: readonly SnapshotMob[], damageFloats?: readonly DamageFloatEvent[]): void {
    const seen = new Set<number>();
    for (const m of mobs) {
      seen.add(m.id);
      let view = this.byId.get(m.id);
      if (!view) {
        const mat = m.kind === "trainingDummy" ? DUMMY_MAT : CREEP_MAT;
        const mesh = new Mesh(new BoxGeometry(0.45, 0.55, 0.45), mat);
        mesh.castShadow = false;
        const barOuter = document.createElement("div");
        barOuter.className = "mob-hp-bar-outer";
        const barFill = document.createElement("div");
        barFill.className = "mob-hp-bar-fill";
        barOuter.appendChild(barFill);
        this.overlay.appendChild(barOuter);
        view = { mesh, barOuter, barFill, hp: m.hp, maxHp: m.maxHp };
        this.byId.set(m.id, view);
        this.scene.add(mesh);
      }
      view.hp = m.hp;
      view.maxHp = Math.max(1e-6, m.maxHp);
      view.mesh.position.set(m.x, m.y - 0.2, m.z);
    }
    for (const [id, view] of this.byId) {
      if (!seen.has(id)) {
        this.scene.remove(view.mesh);
        view.mesh.geometry.dispose();
        view.barOuter.remove();
        this.byId.delete(id);
      }
    }

    if (damageFloats) {
      for (const ev of damageFloats) {
        if (ev.sourceId === this.localPlayerId) {
          this.spawnDamageFloat(ev.amount, ev.x, ev.y, ev.z);
        }
      }
    }
  }

  update(delta: number): void {
    const rect = this.overlay.getBoundingClientRect();
    const d = Math.min(delta, 0.05);

    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.age += d;
      const rise = f.age * 38;
      const sp = this.worldToOverlay(f.wx, f.wy, f.wz, rect);
      if (!sp) {
        f.el.style.opacity = "0";
      } else {
        f.el.style.left = `${sp.left}px`;
        f.el.style.top = `${sp.top - rise}px`;
        f.el.style.opacity = String(Math.max(0, 1 - f.age / FLOAT_LIFE_S));
      }
      if (f.age >= FLOAT_LIFE_S) {
        f.el.remove();
        this.floats.splice(i, 1);
      }
    }

    for (const view of this.byId.values()) {
      const m = view.mesh;
      const sp = this.worldToOverlay(
        m.position.x,
        m.position.y + MOB_BAR_Y,
        m.position.z,
        rect,
      );
      if (!sp) {
        view.barOuter.style.display = "none";
        continue;
      }
      view.barOuter.style.display = "block";
      view.barOuter.style.left = `${sp.left}px`;
      view.barOuter.style.top = `${sp.top}px`;
      const pct = Math.max(0, Math.min(100, (view.hp / view.maxHp) * 100));
      view.barFill.style.width = `${pct}%`;
    }
  }

  dispose(): void {
    for (const f of this.floats) {
      f.el.remove();
    }
    this.floats.length = 0;
    for (const view of this.byId.values()) {
      this.scene.remove(view.mesh);
      view.mesh.geometry.dispose();
      view.barOuter.remove();
    }
    this.byId.clear();
    this.overlay.remove();
  }

  private spawnDamageFloat(amount: number, wx: number, wy: number, wz: number): void {
    const el = document.createElement("div");
    el.className = "damage-float";
    el.textContent = String(Math.round(amount));
    this.overlay.appendChild(el);
    this.floats.push({ el, age: 0, wx, wy, wz });
  }

  private isInFront(wx: number, wy: number, wz: number): boolean {
    const c = this.camera;
    this.forward.set(0, 0, -1).applyQuaternion(c.quaternion);
    const dx = wx - c.position.x;
    const dy = wy - c.position.y;
    const dz = wz - c.position.z;
    return this.forward.x * dx + this.forward.y * dy + this.forward.z * dz > 0.04;
  }

  private worldToOverlay(
    wx: number,
    wy: number,
    wz: number,
    rect: DOMRect,
  ): { left: number; top: number } | null {
    if (!this.isInFront(wx, wy, wz)) {
      return null;
    }
    this.scratch.set(wx, wy, wz);
    this.scratch.project(this.camera);
    const left = (this.scratch.x * 0.5 + 0.5) * rect.width;
    const top = (this.scratch.y * -0.5 + 0.5) * rect.height;
    return { left, top };
  }
}
