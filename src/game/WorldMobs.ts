import {
  BoxGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three";
import {
  BOSS_SUMMONER_HP,
  BOSS_TANK_HP,
  MOB_HP,
  TRAINING_DUMMY_HP,
} from "../combat/constants";
import type { DamageFloatEvent, MobKind, SnapshotMob } from "../net/types";
import type { HitChunkParticles } from "./HitChunkParticles";

const CREEP_MAT = new MeshLambertMaterial({ color: 0x8b4513 });
const DUMMY_MAT = new MeshLambertMaterial({ color: 0x8a8a78 });
const BOSS_TANK_MAT = new MeshLambertMaterial({ color: 0x4a5a6e });
const BOSS_SUM_MAT = new MeshLambertMaterial({ color: 0x6b3d6b });

const FLOAT_LIFE_S = 0.85;
const MOB_BAR_Y = 0.52;

type MobView = {
  root: Group;
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

function defaultMaxHp(kind: MobKind): number {
  switch (kind) {
    case "trainingDummy":
      return TRAINING_DUMMY_HP;
    case "bossTank":
      return BOSS_TANK_HP;
    case "bossSummoner":
      return BOSS_SUMMONER_HP;
    default:
      return MOB_HP;
  }
}

function buildMobRig(kind: MobKind): Group {
  const root = new Group();
  if (kind === "trainingDummy") {
    const body = new Mesh(new BoxGeometry(0.5, 0.75, 0.35), DUMMY_MAT);
    body.position.y = 0.1;
    root.add(body);
    return root;
  }
  if (kind === "bossTank") {
    const body = new Mesh(new BoxGeometry(1.15, 1.0, 0.95), BOSS_TANK_MAT);
    body.position.y = 0.35;
    root.add(body);
    const head = new Mesh(new BoxGeometry(0.55, 0.45, 0.5), BOSS_TANK_MAT);
    head.position.y = 1.05;
    root.add(head);
    return root;
  }
  if (kind === "bossSummoner") {
    const body = new Mesh(new BoxGeometry(0.55, 0.65, 0.42), BOSS_SUM_MAT);
    body.position.y = 0.08;
    root.add(body);
    const head = new Mesh(new BoxGeometry(0.38, 0.36, 0.38), BOSS_SUM_MAT);
    head.position.y = 0.62;
    root.add(head);
    const staff = new Mesh(new BoxGeometry(0.08, 0.95, 0.08), BOSS_SUM_MAT);
    staff.position.set(0.38, 0.45, 0);
    root.add(staff);
    return root;
  }
  // Small creep: torso + head + limbs (matches Milestone 3 "3–4 boxes").
  const torso = new Mesh(new BoxGeometry(0.34, 0.42, 0.22), CREEP_MAT);
  torso.position.y = 0.05;
  root.add(torso);
  const head = new Mesh(new BoxGeometry(0.26, 0.24, 0.24), CREEP_MAT);
  head.position.y = 0.42;
  root.add(head);
  const legL = new Mesh(new BoxGeometry(0.12, 0.22, 0.12), CREEP_MAT);
  legL.position.set(-0.1, -0.22, 0);
  root.add(legL);
  const legR = new Mesh(new BoxGeometry(0.12, 0.22, 0.12), CREEP_MAT);
  legR.position.set(0.1, -0.22, 0);
  root.add(legR);
  return root;
}

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
  private readonly hitParticles: HitChunkParticles | null;

  constructor(
    scene: Scene,
    camera: PerspectiveCamera,
    localPlayerId: string,
    hitParticles?: HitChunkParticles | null,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.localPlayerId = localPlayerId;
    this.hitParticles = hitParticles ?? null;
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
      if (!view || view.root.userData.kindTag !== m.kind) {
        if (view) {
          this.scene.remove(view.root);
          disposeGroup(view.root);
          view.barOuter.remove();
        }
        const root = buildMobRig(m.kind);
        root.userData.kindTag = m.kind;
        const barOuter = document.createElement("div");
        barOuter.className = "mob-hp-bar-outer";
        const barFill = document.createElement("div");
        barFill.className = "mob-hp-bar-fill";
        barOuter.appendChild(barFill);
        this.overlay.appendChild(barOuter);
        view = {
          root,
          barOuter,
          barFill,
          hp: m.hp,
          maxHp: m.maxHp > 0 ? m.maxHp : defaultMaxHp(m.kind),
        };
        this.byId.set(m.id, view);
        this.scene.add(root);
      }
      view.hp = m.hp;
      view.maxHp = m.maxHp > 0 ? m.maxHp : defaultMaxHp(m.kind);
      view.root.position.set(m.x, m.y - 0.2, m.z);
      view.root.rotation.y = 0;
    }
    for (const [id, view] of this.byId) {
      if (!seen.has(id)) {
        this.scene.remove(view.root);
        disposeGroup(view.root);
        view.barOuter.remove();
        this.byId.delete(id);
      }
    }

    if (damageFloats) {
      for (const ev of damageFloats) {
        if (ev.sourceId === this.localPlayerId) {
          this.spawnDamageFloat(ev.amount, ev.x, ev.y, ev.z);
          this.hitParticles?.burst(ev.x, ev.y, ev.z, "strike");
        }
      }
    }
  }

  update(delta: number): void {
    /** `Vector3.project` uses `matrixWorldInverse`; keep in sync after camera moves (third person, etc.). */
    this.camera.updateMatrixWorld(true);
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
      const m = view.root;
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
      this.scene.remove(view.root);
      disposeGroup(view.root);
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
    c.getWorldDirection(this.forward);
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

function disposeGroup(root: Group): void {
  for (const child of root.children) {
    if (child instanceof Mesh) {
      child.geometry.dispose();
    }
  }
}
