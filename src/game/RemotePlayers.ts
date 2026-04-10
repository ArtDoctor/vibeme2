import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from "three";
import { EYE_HEIGHT } from "./constants";
import type { SnapshotPlayer, WeaponKind } from "../net/types";

const TORSO_MAT = new MeshLambertMaterial({ color: 0x4a8c6a });
const HEAD_MAT = new MeshLambertMaterial({ color: 0xe8c4a0 });
const LIMB_MAT = new MeshLambertMaterial({ color: 0x3d7358 });
const STEEL_MAT = new MeshLambertMaterial({ color: 0xb8c4d0 });
const GRIP_MAT = new MeshLambertMaterial({ color: 0x5c4030 });
const WOOD_MAT = new MeshLambertMaterial({ color: 0x8b5a2b });
const STRING_MAT = new MeshLambertMaterial({ color: 0xd8c8a8 });

function makeNicknameSprite(nickname: string): Sprite {
  const canvas = document.createElement("canvas");
  const w = 512;
  const h = 128;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 52px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 8;
    ctx.strokeText(nickname, w / 2, h / 2);
    ctx.fillStyle = "#f4e9c8";
    ctx.fillText(nickname, w / 2, h / 2);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  const mat = new SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new Sprite(mat);
  sprite.scale.set(3.2, 0.8, 1);
  sprite.position.y = 2.35;
  return sprite;
}

function buildSword(): Group {
  const g = new Group();
  const blade = new Mesh(new BoxGeometry(0.07, 0.52, 0.035), STEEL_MAT);
  blade.position.y = 0.28;
  const guard = new Mesh(new BoxGeometry(0.32, 0.05, 0.05), STEEL_MAT);
  guard.position.y = 0.02;
  g.add(blade);
  g.add(guard);
  g.position.set(0.38, 0.75, -0.12);
  g.rotation.y = -0.35;
  return g;
}

function buildShield(): Group {
  const g = new Group();
  const plate = new Mesh(new BoxGeometry(0.52, 0.72, 0.07), STEEL_MAT);
  plate.position.y = 0.36;
  const grip = new Mesh(new BoxGeometry(0.09, 0.18, 0.07), GRIP_MAT);
  grip.position.set(-0.12, 0.22, 0.06);
  g.add(plate);
  g.add(grip);
  g.position.set(0.42, 0.7, -0.05);
  g.rotation.y = -0.45;
  return g;
}

function buildBow(): Group {
  const g = new Group();
  const tri = new Mesh(
    new ConeGeometry(0.2, 0.5, 3, 1, false),
    WOOD_MAT,
  );
  tri.rotation.z = Math.PI / 2;
  tri.rotation.y = Math.PI / 4;
  tri.position.set(0, 0, 0);
  const stringMesh = new Mesh(new BoxGeometry(0.02, 0.48, 0.02), STRING_MAT);
  stringMesh.position.set(0.12, 0, 0);
  g.add(tri);
  g.add(stringMesh);
  g.position.set(0.35, 0.78, -0.1);
  g.rotation.y = -0.2;
  return g;
}

function setWeaponVisible(
  sword: Group,
  shield: Group,
  bow: Group,
  w: WeaponKind,
): void {
  sword.visible = w === "sword";
  shield.visible = w === "shield";
  bow.visible = w === "bow";
}

/**
 * Box-built avatar + primitive weapons for remote players (first-person hides local).
 */
export class RemotePlayers {
  private readonly scene: Scene;
  private readonly localId: string;
  private readonly byId = new Map<string, Group>();

  constructor(scene: Scene, localPlayerId: string) {
    this.scene = scene;
    this.localId = localPlayerId;
  }

  applySnapshot(players: readonly SnapshotPlayer[]): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === this.localId) continue;
      seen.add(p.id);
      let g = this.byId.get(p.id);
      if (!g) {
        g = this.createRig(p.nickname);
        this.byId.set(p.id, g);
        this.scene.add(g);
      }
      this.updateRig(g, p);
    }
    for (const [id, g] of this.byId) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.byId.delete(id);
      }
    }
  }

  dispose(): void {
    for (const g of this.byId.values()) {
      this.scene.remove(g);
    }
    this.byId.clear();
  }

  private createRig(nickname: string): Group {
    const root = new Group();
    const torso = new Mesh(new BoxGeometry(0.52, 0.72, 0.32), TORSO_MAT);
    torso.position.y = 0.52;
    const head = new Mesh(new BoxGeometry(0.34, 0.34, 0.34), HEAD_MAT);
    head.position.y = 1.12;
    const leftArm = new Mesh(new BoxGeometry(0.14, 0.55, 0.14), LIMB_MAT);
    leftArm.position.set(-0.38, 0.58, 0);
    const rightArm = new Mesh(new BoxGeometry(0.14, 0.55, 0.14), LIMB_MAT);
    rightArm.position.set(0.38, 0.58, 0);

    const sword = buildSword();
    sword.name = "sword";
    const shield = buildShield();
    shield.name = "shield";
    const bow = buildBow();
    bow.name = "bow";

    root.add(torso);
    root.add(head);
    root.add(leftArm);
    root.add(rightArm);
    root.add(sword);
    root.add(shield);
    root.add(bow);
    root.add(makeNicknameSprite(nickname));
    root.userData.sword = sword;
    root.userData.shield = shield;
    root.userData.bow = bow;
    return root;
  }

  private updateRig(g: Group, p: SnapshotPlayer): void {
    const feetY = p.y - EYE_HEIGHT;
    g.position.set(p.x, feetY, p.z);
    g.rotation.y = p.yaw;

    const sword = g.userData.sword as Group;
    const shield = g.userData.shield as Group;
    const bow = g.userData.bow as Group;

    setWeaponVisible(sword, shield, bow, p.weapon);

    const swing = Math.min(1, Math.max(0, p.swingT));
    sword.rotation.z = -swing * 1.85;

    shield.rotation.x = p.blocking && p.weapon === "shield" ? -0.55 : 0;

    const charge = Math.min(1, Math.max(0, p.bowCharge));
    const tri = bow.children[0] as Mesh;
    const str = bow.children[1] as Mesh;
    if (tri && str) {
      const s = 0.65 + charge * 0.45;
      tri.scale.set(s, s, s);
      str.scale.y = 0.75 + charge * 0.35;
    }
  }
}
