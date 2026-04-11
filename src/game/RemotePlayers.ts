import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Camera,
  Vector3,
} from "three";
import { avatarRotationYFromCombatYaw } from "../combat/constants";
import { EYE_HEIGHT } from "./constants";
import type {
  ArmorPieceKind,
  PlayerTeam,
  SnapshotPlayer,
} from "../net/types";
import { lerpAngle, shortestAngleDelta } from "../utils/math";
import {
  animateWeaponGroups,
  buildWeaponGroupsThirdPerson,
  setWeaponVisible,
} from "./weaponModels";

/** Renders this far behind newest sample so two arrivals usually bracket render time. */
const INTERP_DELAY_MS = 110;
const MAX_EXTRAPOLATE_MS = 130;
const MAX_SAMPLES_PER_PLAYER = 32;
const MAX_SAMPLE_SPAN_MS = 1400;
const TIME_EPS_MS = 1e-3;

type StateSample = { t: number; p: SnapshotPlayer };

function lerpSnapshotPlayer(
  a: SnapshotPlayer,
  b: SnapshotPlayer,
  t: number,
): SnapshotPlayer {
  const u = Math.min(1, Math.max(0, t));
  const mainHand = u >= 0.5 ? b.mainHand : a.mainHand;
  const offHand = u >= 0.5 ? b.offHand : a.offHand;
  const blocking = u >= 0.5 ? b.blocking : a.blocking;
  return {
    id: b.id,
    nickname: b.nickname,
    team: u >= 0.5 ? b.team : a.team,
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    z: a.z + (b.z - a.z) * u,
    yaw: lerpAngle(a.yaw, b.yaw, u),
    pitch: lerpAngle(a.pitch, b.pitch, u),
    hp: a.hp + (b.hp - a.hp) * u,
    stamina: a.stamina + (b.stamina - a.stamina) * u,
    gold: a.gold + (b.gold - a.gold) * u,
    mainHand,
    offHand,
    armor: u >= 0.5 ? b.armor : a.armor,
    inventory: u >= 0.5 ? b.inventory : a.inventory,
    weapon: u >= 0.5 ? b.weapon : a.weapon,
    blocking,
    bowCharge: a.bowCharge + (b.bowCharge - a.bowCharge) * u,
    swingT: a.swingT + (b.swingT - a.swingT) * u,
    bossUnlock: u >= 0.5 ? b.bossUnlock : a.bossUnlock,
  };
}

function extrapolateSnapshot(
  prev: StateSample,
  last: StateSample,
  renderTime: number,
): SnapshotPlayer {
  const a = prev.p;
  const b = last.p;
  const dt = last.t - prev.t;
  if (dt < TIME_EPS_MS) {
    return b;
  }
  const extra = renderTime - last.t;
  const e = Math.min(Math.max(0, extra), MAX_EXTRAPOLATE_MS);
  const k = e / dt;
  return {
    ...b,
    x: b.x + ((b.x - a.x) / dt) * e,
    y: b.y + ((b.y - a.y) / dt) * e,
    z: b.z + ((b.z - a.z) / dt) * e,
    yaw: b.yaw + shortestAngleDelta(a.yaw, b.yaw) * k,
    pitch: b.pitch + shortestAngleDelta(a.pitch, b.pitch) * k,
    hp: b.hp + (b.hp - a.hp) * k,
    stamina: b.stamina + (b.stamina - a.stamina) * k,
    gold: Math.round(b.gold + (b.gold - a.gold) * k),
    bowCharge: b.bowCharge + (b.bowCharge - a.bowCharge) * k,
    swingT: b.swingT + (b.swingT - a.swingT) * k,
  };
}

function resolveInterpolatedPlayer(
  samples: readonly StateSample[],
  renderTime: number,
): SnapshotPlayer | null {
  if (samples.length === 0) {
    return null;
  }
  const head = samples[0];
  if (renderTime <= head.t) {
    return head.p;
  }
  let i = 0;
  while (i < samples.length - 1 && samples[i + 1].t <= renderTime) {
    i += 1;
  }
  const cur = samples[i];
  if (i === samples.length - 1) {
    if (samples.length >= 2) {
      return extrapolateSnapshot(samples[i - 1], cur, renderTime);
    }
    return cur.p;
  }
  const nxt = samples[i + 1];
  const span = nxt.t - cur.t;
  const alpha = span < TIME_EPS_MS ? 1 : (renderTime - cur.t) / span;
  return lerpSnapshotPlayer(cur.p, nxt.p, alpha);
}

const viewFacingScratch = new Vector3();

function torsoColorForTeam(team: PlayerTeam): number {
  switch (team) {
    case "red":
      return 0xb83c3c;
    case "blue":
      return 0x3c6ab8;
    case "neutral":
      return 0x8a8a82;
    default:
      return 0x4a8c6a;
  }
}
const HEAD_MAT = new MeshLambertMaterial({ color: 0xe8c4a0 });
const LIMB_MAT = new MeshLambertMaterial({ color: 0x3d7358 });
const ARMOR_MAT = new MeshLambertMaterial({ color: 0x9f8451 });

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
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new Sprite(mat);
  sprite.scale.set(3.2, 0.8, 1);
  sprite.position.y = 2.35;
  return sprite;
}

/** Shared box avatar + weapons (remote players and local third-person). */
export function createPlayerAvatarRig(nickname: string): Group {
  const root = new Group();
  const torso = new Mesh(
    new BoxGeometry(0.52, 0.72, 0.32),
    new MeshLambertMaterial({ color: torsoColorForTeam("neutral") }),
  );
  torso.position.y = 0.52;
  const head = new Mesh(new BoxGeometry(0.34, 0.34, 0.34), HEAD_MAT);
  head.position.y = 1.12;
  const leftArm = new Mesh(new BoxGeometry(0.14, 0.55, 0.14), LIMB_MAT);
  leftArm.position.set(-0.38, 0.58, 0);
  const rightArm = new Mesh(new BoxGeometry(0.14, 0.55, 0.14), LIMB_MAT);
  rightArm.position.set(0.38, 0.58, 0);
  const helm = new Mesh(new BoxGeometry(0.42, 0.18, 0.42), ARMOR_MAT);
  helm.position.y = 1.22;
  helm.visible = false;
  const chest = new Mesh(new BoxGeometry(0.6, 0.82, 0.38), ARMOR_MAT);
  chest.position.y = 0.52;
  chest.visible = false;
  const tassets = new Mesh(new BoxGeometry(0.5, 0.22, 0.3), ARMOR_MAT);
  tassets.position.y = 0.1;
  tassets.visible = false;

  const { sword, shield, bow } = buildWeaponGroupsThirdPerson();
  sword.name = "sword";
  shield.name = "shield";
  bow.name = "bow";

  root.add(torso);
  root.add(head);
  root.add(leftArm);
  root.add(rightArm);
  root.add(helm);
  root.add(chest);
  root.add(tassets);
  root.add(sword);
  root.add(shield);
  root.add(bow);
  root.add(makeNicknameSprite(nickname));
  root.scale.setScalar(2 / 1.5);
  root.userData.sword = sword;
  root.userData.shield = shield;
  root.userData.bow = bow;
  root.userData.helm = helm;
  root.userData.chestArmor = chest;
  root.userData.tassets = tassets;
  root.userData.torso = torso;
  return root;
}

export interface AvatarRigUpdateOpts {
  viewCamera?: Camera;
  /** Prone corpse on the ground — uses `groundFeetY` instead of snapshot height. */
  lieDead?: boolean;
  groundFeetY?: number;
}

export function updatePlayerAvatarRig(
  g: Group,
  p: SnapshotPlayer,
  opts?: AvatarRigUpdateOpts,
): void {
  if (opts?.lieDead === true && opts.groundFeetY !== undefined) {
    const gy = opts.groundFeetY;
    g.position.set(p.x, gy + 0.07, p.z);
    g.rotation.order = "YXZ";
    let yaw = avatarRotationYFromCombatYaw(p.yaw);
    if (opts.viewCamera) {
      const cam = opts.viewCamera;
      cam.updateMatrixWorld(true);
      cam.getWorldDirection(viewFacingScratch);
      viewFacingScratch.y = 0;
      const lenSq = viewFacingScratch.lengthSq();
      if (lenSq > 1e-10) {
        viewFacingScratch.multiplyScalar(1 / Math.sqrt(lenSq));
        yaw = Math.atan2(viewFacingScratch.x, viewFacingScratch.z);
      }
    }
    g.rotation.y = yaw;
    g.rotation.x = Math.PI / 2 - 0.09;
    g.rotation.z = 0;
    for (const ch of g.children) {
      if (ch instanceof Sprite) {
        ch.visible = false;
      }
    }
  } else {
    g.rotation.order = "XYZ";
    g.rotation.x = 0;
    g.rotation.z = 0;
    const feetY = p.y - EYE_HEIGHT;
    g.position.set(p.x, feetY, p.z);
    for (const ch of g.children) {
      if (ch instanceof Sprite) {
        ch.visible = true;
      }
    }
    if (opts?.viewCamera) {
      const cam = opts.viewCamera;
      cam.updateMatrixWorld(true);
      cam.getWorldDirection(viewFacingScratch);
      viewFacingScratch.y = 0;
      const lenSq = viewFacingScratch.lengthSq();
      if (lenSq > 1e-10) {
        viewFacingScratch.multiplyScalar(1 / Math.sqrt(lenSq));
        g.rotation.y = Math.atan2(viewFacingScratch.x, viewFacingScratch.z);
      } else {
        g.rotation.y = avatarRotationYFromCombatYaw(p.yaw);
      }
    } else {
      g.rotation.y = avatarRotationYFromCombatYaw(p.yaw);
    }
  }

  const sword = g.userData.sword as Group;
  const shield = g.userData.shield as Group;
  const bow = g.userData.bow as Group;
  const helm = g.userData.helm as Mesh | undefined;
  const chest = g.userData.chestArmor as Mesh | undefined;
  const tassets = g.userData.tassets as Mesh | undefined;
  const torsoMesh = g.userData.torso as Mesh | undefined;
  if (torsoMesh) {
    const mat = torsoMesh.material as MeshLambertMaterial;
    mat.color.setHex(torsoColorForTeam(p.team));
  }

  setWeaponVisible(sword, shield, bow, p.mainHand, p.offHand);
  animateWeaponGroups(sword, shield, bow, p);
  if (helm) helm.visible = hasArmorPiece(p.armor.head, "scoutHelm");
  if (chest) chest.visible = hasArmorPiece(p.armor.chest, "scoutChest");
  if (tassets) tassets.visible = hasArmorPiece(p.armor.legs, "scoutLegs");
}

/**
 * Box-built avatar + primitive weapons for remote players (first-person hides local).
 */
export class RemotePlayers {
  private readonly scene: Scene;
  private readonly localId: string;
  private readonly byId = new Map<string, Group>();
  private readonly samplesById = new Map<string, StateSample[]>();

  constructor(scene: Scene, localPlayerId: string) {
    this.scene = scene;
    this.localId = localPlayerId;
  }

  /**
   * Authoritative poses from the server; stored with receive time for frame interpolation.
   */
  applySnapshot(players: readonly SnapshotPlayer[]): void {
    const receiveTime = performance.now();
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
      this.pushSample(p.id, { t: receiveTime, p });
    }
    for (const [id, g] of this.byId) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.byId.delete(id);
        this.samplesById.delete(id);
      }
    }
  }

  /** Call each frame after simulation; smooths remote motion between network snapshots. */
  update(): void {
    const renderTime = performance.now() - INTERP_DELAY_MS;
    for (const [id, g] of this.byId) {
      const samples = this.samplesById.get(id);
      const resolved = samples
        ? resolveInterpolatedPlayer(samples, renderTime)
        : null;
      if (resolved) {
        this.updateRig(g, resolved);
      }
    }
  }

  dispose(): void {
    for (const g of this.byId.values()) {
      this.scene.remove(g);
    }
    this.byId.clear();
    this.samplesById.clear();
  }

  private pushSample(id: string, sample: StateSample): void {
    let arr = this.samplesById.get(id);
    if (!arr) {
      arr = [];
      this.samplesById.set(id, arr);
    }
    arr.push(sample);
    while (arr.length > MAX_SAMPLES_PER_PLAYER) {
      arr.shift();
    }
    const newest = arr[arr.length - 1].t;
    while (arr.length > 2 && newest - arr[0].t > MAX_SAMPLE_SPAN_MS) {
      arr.shift();
    }
  }

  private createRig(nickname: string): Group {
    return createPlayerAvatarRig(nickname);
  }

  private updateRig(g: Group, p: SnapshotPlayer): void {
    updatePlayerAvatarRig(g, p);
  }
}

function hasArmorPiece(
  current: ArmorPieceKind | null,
  expected: ArmorPieceKind,
): boolean {
  return current === expected;
}
