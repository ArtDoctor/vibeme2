import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
} from "three";
import type {
  MainHandKind,
  OffHandKind,
  SnapshotPlayer,
} from "../net/types";
import { mainHandIsSword } from "../net/types";

const STEEL_MAT = new MeshLambertMaterial({ color: 0xb8c4d0 });
const GRIP_MAT = new MeshLambertMaterial({ color: 0x5c4030 });
const WOOD_MAT = new MeshLambertMaterial({ color: 0x8b5a2b });
const STRING_MAT = new MeshLambertMaterial({ color: 0xd8c8a8 });
const WOOD_BLADE_MAT = new MeshLambertMaterial({ color: 0xb07a40 });

export interface WeaponGroups {
  sword: Group;
  shield: Group;
  bow: Group;
}

type LayoutTriple = {
  sword: { pos: readonly [number, number, number]; rotY: number };
  shield: { pos: readonly [number, number, number]; rotY: number };
  bow: { pos: readonly [number, number, number]; rotY: number };
};

/** Layout for weapons rigged to a third-person avatar (see RemotePlayers). */
export const WEAPON_LAYOUT_THIRD: LayoutTriple = {
  sword: { pos: [0.38, 0.75, -0.12], rotY: -0.35 },
  shield: { pos: [-0.54, 0.2, -0.05], rotY: 0.45 },
  bow: { pos: [0.35, 0.78, -0.1], rotY: -0.2 },
};

/** Layout for first-person view (parented to camera). */
export const WEAPON_LAYOUT_FIRST: LayoutTriple = {
  sword: { pos: [0.32, -0.22, -0.52], rotY: -0.42 },
  shield: { pos: [-0.5, -0.74, -0.48], rotY: 0.5 },
  bow: { pos: [0.3, -0.18, -0.5], rotY: -0.28 },
};

/** Idle carry: slight pitch on shield; RMB block swaps to position-based raise (see animateWeaponGroups). */
const SHIELD_IDLE_ROT_X = -0.52;

const SHIELD_BLOCK_POS_DELTA_FIRST: readonly [number, number, number] = [
  0.1, 0.22, -0.12,
];
const SHIELD_BLOCK_POS_DELTA_THIRD: readonly [number, number, number] = [
  0.08, 0.14, -0.1,
];

type ShieldBaseline = {
  pos: readonly [number, number, number];
  rotY: number;
  blockDelta: readonly [number, number, number];
};

function tagShieldBaseline(
  shield: Group,
  layout: LayoutTriple,
  blockDelta: readonly [number, number, number],
): void {
  (shield.userData as { shieldBaseline?: ShieldBaseline }).shieldBaseline = {
    pos: layout.shield.pos,
    rotY: layout.shield.rotY,
    blockDelta,
  };
}

function buildSwordBase(): Group {
  const g = new Group();
  const blade = new Mesh(new BoxGeometry(0.07, 0.52, 0.035), WOOD_BLADE_MAT);
  blade.position.y = 0.28;
  const guard = new Mesh(new BoxGeometry(0.32, 0.05, 0.05), WOOD_MAT);
  guard.position.y = 0.02;
  g.add(blade);
  g.add(guard);
  return g;
}

function buildShieldBase(): Group {
  const g = new Group();
  const plate = new Mesh(new BoxGeometry(0.52, 0.72, 0.07), STEEL_MAT);
  plate.position.y = 0.36;
  const grip = new Mesh(new BoxGeometry(0.09, 0.18, 0.07), GRIP_MAT);
  grip.position.set(-0.12, 0.22, 0.06);
  g.add(plate);
  g.add(grip);
  return g;
}

function buildBowBase(): Group {
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
  return g;
}

function applyLayout(
  sword: Group,
  shield: Group,
  bow: Group,
  layout: LayoutTriple,
): void {
  sword.position.set(...layout.sword.pos);
  sword.rotation.y = layout.sword.rotY;
  shield.position.set(...layout.shield.pos);
  shield.rotation.y = layout.shield.rotY;
  bow.position.set(...layout.bow.pos);
  bow.rotation.y = layout.bow.rotY;
}

export function buildWeaponGroupsThirdPerson(): WeaponGroups {
  const sword = buildSwordBase();
  const shield = buildShieldBase();
  const bow = buildBowBase();
  applyLayout(sword, shield, bow, WEAPON_LAYOUT_THIRD);
  tagShieldBaseline(shield, WEAPON_LAYOUT_THIRD, SHIELD_BLOCK_POS_DELTA_THIRD);
  return { sword, shield, bow };
}

export function buildWeaponGroupsFirstPerson(): WeaponGroups {
  const sword = buildSwordBase();
  const shield = buildShieldBase();
  const bow = buildBowBase();
  applyLayout(sword, shield, bow, WEAPON_LAYOUT_FIRST);
  tagShieldBaseline(shield, WEAPON_LAYOUT_FIRST, SHIELD_BLOCK_POS_DELTA_FIRST);
  return { sword, shield, bow };
}

export function setWeaponVisible(
  sword: Group,
  shield: Group,
  bow: Group,
  mainHand: MainHandKind,
  offHand: OffHandKind | null,
): void {
  const swordActive = mainHandIsSword(mainHand);
  sword.visible = swordActive;
  shield.visible = swordActive && offHand === "basicShield";
  bow.visible = mainHand === "shortBow";
}

/**
 * Same pose logic for remote avatars and local first-person rig (swing / block / bow draw).
 */
export function animateWeaponGroups(
  sword: Group,
  shield: Group,
  bow: Group,
  p: Pick<
    SnapshotPlayer,
    "mainHand" | "offHand" | "swingT" | "blocking" | "bowCharge"
  >,
): void {
  const swing = Math.min(1, Math.max(0, p.swingT));
  sword.rotation.z = 0;
  sword.rotation.x = -swing * 1.12;

  const shieldBlock =
    p.blocking && mainHandIsSword(p.mainHand) && p.offHand === "basicShield";
  const bl = (shield.userData as { shieldBaseline?: ShieldBaseline })
    .shieldBaseline;
  if (bl) {
    const [dx, dy, dz] = bl.blockDelta;
    if (shieldBlock) {
      shield.position.set(
        bl.pos[0] + dx,
        bl.pos[1] + dy,
        bl.pos[2] + dz,
      );
      shield.rotation.x = 0;
    } else {
      shield.position.set(bl.pos[0], bl.pos[1], bl.pos[2]);
      shield.rotation.x = SHIELD_IDLE_ROT_X;
    }
    shield.rotation.y = bl.rotY;
  } else {
    shield.rotation.x = shieldBlock ? 0 : SHIELD_IDLE_ROT_X;
  }

  const charge = Math.min(1, Math.max(0, p.bowCharge));
  const tri = bow.children[0] as Mesh;
  const str = bow.children[1] as Mesh;
  if (tri && str) {
    const s = 0.65 + charge * 0.45;
    tri.scale.set(s, s, s);
    str.scale.y = 0.75 + charge * 0.35;
  }
}
