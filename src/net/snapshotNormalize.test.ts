import { describe, expect, it } from "vitest";
import {
  normalizeMainHandKind,
  normalizeSnapshotMob,
  normalizeSnapshotMsg,
  normalizeSnapshotPickup,
  normalizeSnapshotPlayer,
  normalizeWeaponKind,
} from "./snapshotNormalize";
import { BOSS_TANK_HP, MOB_HP } from "../combat/constants";

describe("normalizeWeaponKind", () => {
  it("defaults unknown to sword", () => {
    expect(normalizeWeaponKind(undefined)).toBe("sword");
    expect(normalizeWeaponKind("axe")).toBe("sword");
    expect(normalizeWeaponKind(null)).toBe("sword");
  });
});

describe("normalizeMainHandKind", () => {
  it("defaults unknown to wooden sword", () => {
    expect(normalizeMainHandKind(undefined)).toBe("woodenSword");
    expect(normalizeMainHandKind("axe")).toBe("woodenSword");
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
    expect(p.mainHand).toBe("woodenSword");
    expect(p.offHand).toBeNull();
    expect(p.inventory).toEqual([{ kind: "woodenSword", count: 1 }]);
    expect(p.armor).toEqual({ head: null, chest: null, legs: null });
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

  it("normalizes pickup snapshots when present", () => {
    const m = normalizeSnapshotMsg({
      type: "snapshot",
      tick: 2,
      players: [],
      pickups: [{ id: "4", kind: "armor", x: 1, y: 2, z: 3 }],
      mobs: [],
    });
    expect(m.pickups).toEqual([{ id: 4, kind: "armor", x: 1, y: 2, z: 3 }]);
  });
});

describe("normalizeSnapshotMob", () => {
  it("maps boss kinds and default maxHp", () => {
    const tank = normalizeSnapshotMob({
      id: 1,
      kind: "bossTank",
      x: 0,
      y: 1,
      z: 2,
      hp: 100,
    });
    expect(tank.kind).toBe("bossTank");
    expect(tank.maxHp).toBe(BOSS_TANK_HP);

    const creep = normalizeSnapshotMob({
      id: 2,
      kind: "creep",
      hp: 10,
    });
    expect(creep.kind).toBe("creep");
    expect(creep.maxHp).toBe(MOB_HP);
  });
});

describe("normalizeSnapshotPickup", () => {
  it("includes goldAmount for gold pickups", () => {
    const p = normalizeSnapshotPickup({
      id: 3,
      kind: "gold",
      goldAmount: 12,
      x: 0,
      y: 1,
      z: 0,
    });
    expect(p.kind).toBe("gold");
    expect(p.goldAmount).toBe(12);
  });
});
