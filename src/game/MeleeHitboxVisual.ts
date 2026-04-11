import {
  BoxGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import {
  forwardFromCameraYaw,
  HIT_CYLINDER_HEIGHT,
  MELEE_BOX_FORWARD_MAX,
  MELEE_BOX_FORWARD_MIN,
  MELEE_BOX_HALF_WIDTH,
} from "../combat/constants";
import { EYE_HEIGHT } from "./constants";
import type { SnapshotPlayer } from "../net/types";
import type { CombatInput } from "../player/CombatInput";

const DEPTH = MELEE_BOX_FORWARD_MAX - MELEE_BOX_FORWARD_MIN;
const WIDTH = 2 * MELEE_BOX_HALF_WIDTH;

const rightScratch = new Vector3();
const upScratch = new Vector3(0, 1, 0);
const forwardScratch = new Vector3();
const basisScratch = new Matrix4();
const quatScratch = new Quaternion();

/**
 * Semi-transparent world box matching `melee_hit_valid` / `isInMeleeArc` volume
 * while the local swing animation is active.
 */
export class MeleeHitboxVisual {
  private readonly root: Group;

  constructor(scene: Scene) {
    const geom = new BoxGeometry(WIDTH, HIT_CYLINDER_HEIGHT, DEPTH);
    const mat = new MeshBasicMaterial({
      color: 0x5eb3ff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(geom, mat);
    this.root = new Group();
    this.root.name = "meleeHitboxVisual";
    this.root.add(mesh);
    this.root.visible = false;
    scene.add(this.root);
  }

  /**
   * @param pose — network pose (eye height, feet at `y - EYE_HEIGHT`).
   */
  update(
    pose: { x: number; y: number; z: number; yaw: number },
    me: SnapshotPlayer | null,
    combat: CombatInput | null,
  ): void {
    const mainHand = combat?.getCurrentMainHand() ?? me?.mainHand ?? "woodenSword";
    const swingT = me?.swingT ?? 0;
    const show = mainHand === "woodenSword" && swingT > 0.001;
    this.root.visible = show;
    if (!show) return;

    const yaw = pose.yaw;
    const f = forwardFromCameraYaw(yaw);
    const feetY = pose.y - EYE_HEIGHT;
    const midF = (MELEE_BOX_FORWARD_MIN + MELEE_BOX_FORWARD_MAX) / 2;
    const cx = pose.x + f.x * midF;
    const cz = pose.z + f.z * midF;
    const cy = feetY + HIT_CYLINDER_HEIGHT / 2;

    rightScratch.set(Math.cos(yaw), 0, Math.sin(yaw));
    forwardScratch.set(f.x, 0, f.z);
    basisScratch.makeBasis(rightScratch, upScratch, forwardScratch);
    quatScratch.setFromRotationMatrix(basisScratch);
    this.root.position.set(cx, cy, cz);
    this.root.quaternion.copy(quatScratch);
  }

  dispose(scene: Scene): void {
    scene.remove(this.root);
    const mesh = this.root.children[0] as Mesh;
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
  }
}
