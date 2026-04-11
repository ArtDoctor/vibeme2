import { describe, expect, it } from "vitest";
import {
  nearestShopIndex,
  SHOP_INTERACT_RADIUS,
  SHOP_POSITIONS,
  SHOP_SAFE_ZONE_COUNT,
  shopCatalogForSafeZoneIndex,
  shopServiceSpotFromCenter,
} from "./shops";

describe("shopServiceSpotFromCenter", () => {
  it("offsets from the origin along +Z (stall counter)", () => {
    const p = shopServiceSpotFromCenter(0, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(1.85, 6);
  });

  it("offsets outward along the radial from the courtyard center", () => {
    const p = shopServiceSpotFromCenter(100, 0);
    const h = 100;
    expect(p.x).toBeCloseTo(100 + (100 / h) * 1.85, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });
});

describe("shopCatalogForSafeZoneIndex", () => {
  it("uses basic stalls at center and edge mids", () => {
    expect(shopCatalogForSafeZoneIndex(0)[0]?.sku).toBe("ironSword");
    expect(shopCatalogForSafeZoneIndex(1)[0]?.sku).toBe("ironSword");
    expect(shopCatalogForSafeZoneIndex(6)[0]?.sku).toBe("ironSword");
    expect(shopCatalogForSafeZoneIndex(7)[0]?.sku).toBe("ironSword");
  });

  it("uses advanced catalog at corner outposts", () => {
    const advanced = shopCatalogForSafeZoneIndex(3);
    expect(advanced.some((o) => o.sku === "steelSword")).toBe(true);
    expect(advanced.find((o) => o.sku === "ironSword")?.price).toBe(38);
  });
});

describe("nearestShopIndex", () => {
  it("resolves each stall position to its own index", () => {
    expect(SHOP_POSITIONS.length).toBe(SHOP_SAFE_ZONE_COUNT);
    for (let i = 0; i < SHOP_POSITIONS.length; i += 1) {
      const p = SHOP_POSITIONS[i];
      expect(nearestShopIndex(p.x, p.z)).toEqual({ index: i, dist: 0 });
    }
  });

  it("returns null deep in the chaos desert", () => {
    expect(nearestShopIndex(130, -240)).toBeNull();
  });

  it("returns null just outside interaction radius", () => {
    const p = SHOP_POSITIONS[0];
    const d = SHOP_INTERACT_RADIUS + 0.05;
    expect(nearestShopIndex(p.x + d, p.z)).toBeNull();
  });
});
