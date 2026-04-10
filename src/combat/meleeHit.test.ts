import { describe, expect, it } from "vitest";
import { isInMeleeArc } from "./meleeHit";

describe("isInMeleeArc", () => {
  it("hits a target straight ahead within range", () => {
    const eyeY = 2;
    const ok = isInMeleeArc(
      { x: 0, z: 0, eyeY, yaw: 0 },
      { x: 0, z: -1, eyeY },
    );
    expect(ok).toBe(true);
  });

  it("misses behind the attacker", () => {
    const eyeY = 2;
    const ok = isInMeleeArc(
      { x: 0, z: 0, eyeY, yaw: 0 },
      { x: 0, z: 1, eyeY },
    );
    expect(ok).toBe(false);
  });

  it("misses beyond melee range", () => {
    const eyeY = 2;
    const ok = isInMeleeArc(
      { x: 0, z: 0, eyeY, yaw: 0 },
      { x: 0, z: -5, eyeY },
    );
    expect(ok).toBe(false);
  });
});
