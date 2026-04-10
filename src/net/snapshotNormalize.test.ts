import { describe, expect, it } from "vitest";
import {
  normalizeSnapshotMsg,
  normalizeSnapshotPlayer,
  normalizeWeaponKind,
} from "./snapshotNormalize";

describe("normalizeWeaponKind", () => {
  it("defaults unknown to sword", () => {
    expect(normalizeWeaponKind(undefined)).toBe("sword");
    expect(normalizeWeaponKind("axe")).toBe("sword");
    expect(normalizeWeaponKind(null)).toBe("sword");
  });
});

describe("normalizeSnapshotPlayer", () => {
  it("fills combat fields when missing (legacy / partial snapshots)", () => {
    const p = normalizeSnapshotPlayer({
      id: "1",
      nickname: "legacy",
      x: 1,
      y: 2,
      z: 3,
      yaw: 0,
      pitch: 0,
    });
    expect(p.weapon).toBe("sword");
    expect(p.bowCharge).toBe(0);
    expect(p.swingT).toBe(0);
    expect(p.blocking).toBe(false);
    expect(p.gold).toBe(0);
    expect(p.hp).toBe(100);
    expect(p.stamina).toBe(100);
  });
});

describe("normalizeSnapshotMsg", () => {
  it("tolerates missing players array", () => {
    const m = normalizeSnapshotMsg({ type: "snapshot", tick: 5 });
    expect(m.players).toEqual([]);
    expect(m.mobs).toEqual([]);
    expect(m.tick).toBe(5);
  });

  it("parses deaths ids when present", () => {
    const m = normalizeSnapshotMsg({
      type: "snapshot",
      tick: 1,
      deaths: ["abc", "", 42],
      mobs: [],
    });
    expect(m.deaths).toEqual(["abc", "42"]);
  });
});
