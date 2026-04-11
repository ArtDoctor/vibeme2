import { describe, expect, it } from "vitest";
import {
  blueWarCampCenterXZ,
  ENEMY_WAR_CAMP_EXCLUSION_RADIUS,
  extrudeFromEnemyWarCamps,
  redWarCampCenterXZ,
} from "./teamTerritory";

describe("war camp centers", () => {
  it("places red north and blue south along Z (edge inset)", () => {
    const r = redWarCampCenterXZ();
    const b = blueWarCampCenterXZ();
    expect(r.x).toBe(0);
    expect(b.x).toBe(0);
    expect(r.z).toBeGreaterThan(0);
    expect(b.z).toBeLessThan(0);
    expect(r.z).toBe(-b.z);
  });
});

describe("extrudeFromEnemyWarCamps", () => {
  it("does not move neutral players", () => {
    const out = extrudeFromEnemyWarCamps("neutral", 12, -34);
    expect(out).toEqual({ x: 12, z: -34 });
  });

  it("leaves red players outside the blue camp disk unchanged", () => {
    const bc = blueWarCampCenterXZ();
    const far: [number, number] = [bc.x + 80, bc.z];
    const out = extrudeFromEnemyWarCamps("red", far[0], far[1]);
    expect(out.x).toBeCloseTo(far[0], 6);
    expect(out.z).toBeCloseTo(far[1], 6);
  });

  it("pushes red players at the blue camp center to the exclusion radius", () => {
    const bc = blueWarCampCenterXZ();
    const out = extrudeFromEnemyWarCamps("red", bc.x, bc.z);
    const dx = out.x - bc.x;
    const dz = out.z - bc.z;
    expect(Math.hypot(dx, dz)).toBeCloseTo(ENEMY_WAR_CAMP_EXCLUSION_RADIUS, 5);
  });

  it("pushes blue players at the red camp center to the exclusion radius", () => {
    const rc = redWarCampCenterXZ();
    const out = extrudeFromEnemyWarCamps("blue", rc.x, rc.z);
    const dx = out.x - rc.x;
    const dz = out.z - rc.z;
    expect(Math.hypot(dx, dz)).toBeCloseTo(ENEMY_WAR_CAMP_EXCLUSION_RADIUS, 5);
  });
});
