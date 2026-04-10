import { BoxGeometry, Mesh, MeshLambertMaterial, Scene } from "three";
import type { SnapshotArrow } from "../net/types";

const ARROW_MAT = new MeshLambertMaterial({ color: 0x6a4a2a });

/**
 * Server-driven box arrows for Milestone 2 (see `server/src/combat.rs` Arrow).
 */
export class WorldArrows {
  private readonly scene: Scene;
  private readonly byId = new Map<number, Mesh>();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  sync(arrows: readonly SnapshotArrow[]): void {
    const seen = new Set<number>();
    for (const a of arrows) {
      seen.add(a.id);
      let m = this.byId.get(a.id);
      if (!m) {
        m = new Mesh(new BoxGeometry(0.12, 0.08, 0.45), ARROW_MAT);
        m.castShadow = false;
        this.byId.set(a.id, m);
        this.scene.add(m);
      }
      m.position.set(a.x, a.y, a.z);
      m.rotation.y = a.yaw;
    }
    for (const [id, mesh] of this.byId) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.byId.delete(id);
      }
    }
  }

  dispose(): void {
    for (const mesh of this.byId.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.byId.clear();
  }
}
