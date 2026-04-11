import {
  BoxGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Scene,
} from "three";
import type { SnapshotPickup } from "../net/types";

const SHIELD_MAT = new MeshLambertMaterial({ color: 0x7d8fa5 });
const BOW_MAT = new MeshLambertMaterial({ color: 0x946234 });
const ARMOR_MAT = new MeshLambertMaterial({ color: 0xa7864d });
const GOLD_MAT = new MeshLambertMaterial({ color: 0xc9a227 });
const TOKEN_MAT = new MeshLambertMaterial({ color: 0x9b7cff });
const ITEM_MAT = new MeshLambertMaterial({ color: 0xb060c8 });

type PickupView = {
  root: Group;
  bobSeed: number;
};

export class WorldPickups {
  private readonly scene: Scene;
  private readonly byId = new Map<number, PickupView>();
  private time = 0;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  sync(pickups: readonly SnapshotPickup[]): void {
    const seen = new Set<number>();
    for (const pickup of pickups) {
      seen.add(pickup.id);
      let view = this.byId.get(pickup.id);
      if (!view) {
        view = {
          root: buildPickupMesh(pickup.kind),
          bobSeed: (pickup.id % 13) * 0.27,
        };
        this.byId.set(pickup.id, view);
        this.scene.add(view.root);
      }
      view.root.position.set(pickup.x, pickup.y, pickup.z);
      view.root.userData.baseY = pickup.y;
    }
    for (const [id, view] of this.byId) {
      if (!seen.has(id)) {
        this.scene.remove(view.root);
        disposePickup(view.root);
        this.byId.delete(id);
      }
    }
  }

  update(delta: number): void {
    this.time += Math.min(delta, 0.05);
    for (const view of this.byId.values()) {
      const baseY =
        typeof view.root.userData.baseY === "number"
          ? (view.root.userData.baseY as number)
          : view.root.position.y;
      view.root.position.y = baseY + Math.sin(this.time * 2.4 + view.bobSeed) * 0.12;
      view.root.rotation.y += delta * 0.7;
    }
  }

  dispose(): void {
    for (const view of this.byId.values()) {
      this.scene.remove(view.root);
      disposePickup(view.root);
    }
    this.byId.clear();
  }
}

function buildPickupMesh(kind: SnapshotPickup["kind"]): Group {
  const root = new Group();
  let mesh: Mesh;
  switch (kind) {
    case "bow":
      mesh = new Mesh(new BoxGeometry(0.24, 0.78, 0.12), BOW_MAT);
      break;
    case "armor":
      mesh = new Mesh(new BoxGeometry(0.55, 0.55, 0.28), ARMOR_MAT);
      break;
    case "gold":
      mesh = new Mesh(new BoxGeometry(0.38, 0.22, 0.38), GOLD_MAT);
      break;
    case "gearToken":
      mesh = new Mesh(new BoxGeometry(0.32, 0.08, 0.42), TOKEN_MAT);
      break;
    case "item":
      mesh = new Mesh(new BoxGeometry(0.4, 0.36, 0.4), ITEM_MAT);
      break;
    default:
      mesh = new Mesh(new BoxGeometry(0.52, 0.68, 0.08), SHIELD_MAT);
      break;
  }
  root.add(mesh);
  return root;
}

function disposePickup(root: Group): void {
  for (const child of root.children) {
    if (child instanceof Mesh) {
      child.geometry.dispose();
    }
  }
}
