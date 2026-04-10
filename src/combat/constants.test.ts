import { PerspectiveCamera, Vector3 } from "three";
import {
  avatarRotationYFromCombatYaw,
  forwardFromCameraYaw,
  horizontalYawFromCamera,
} from "./constants";
import { describe, expect, it } from "vitest";

const flatScratch = new Vector3();

function flatLookXZ(cam: PerspectiveCamera): { x: number; z: number } {
  cam.getWorldDirection(flatScratch);
  flatScratch.y = 0;
  const lenSq = flatScratch.lengthSq();
  if (lenSq < 1e-10) {
    return { x: 0, z: -1 };
  }
  flatScratch.multiplyScalar(1 / Math.sqrt(lenSq));
  return { x: flatScratch.x, z: flatScratch.z };
}

describe("horizontalYawFromCamera", () => {
  it("matches flattened getWorldDirection for any horizontal aim (combat yaw)", () => {
    const cam = new PerspectiveCamera();
    cam.rotation.order = "YXZ";
    for (const yaw of [0, 0.7, -1.1, Math.PI / 2, -Math.PI / 2, 2.3, -0.4]) {
      cam.rotation.y = yaw;
      cam.rotation.x = 0;
      cam.updateMatrixWorld(true);
      const flat = flatLookXZ(cam);
      const h = horizontalYawFromCamera(cam);
      const f = forwardFromCameraYaw(h);
      expect(f.x).toBeCloseTo(flat.x, 5);
      expect(f.z).toBeCloseTo(flat.z, 5);
    }
  });

  it("avatarRotationYFromCombatYaw: local +Z matches combat forward on XZ", () => {
    for (const ψ of [0, 0.7, -1.2, Math.PI / 2, -Math.PI / 4]) {
      const r = avatarRotationYFromCombatYaw(ψ);
      const fc = forwardFromCameraYaw(ψ);
      expect(Math.sin(r)).toBeCloseTo(fc.x, 5);
      expect(Math.cos(r)).toBeCloseTo(fc.z, 5);
    }
  });

  it("differs from rotation.y when pitch is non-zero (Euler YXZ)", () => {
    const cam = new PerspectiveCamera();
    cam.rotation.order = "YXZ";
    cam.rotation.y = 0.9;
    cam.rotation.x = 0.4;
    cam.updateMatrixWorld(true);
    expect(horizontalYawFromCamera(cam)).not.toBeCloseTo(cam.rotation.y, 2);
  });
});
