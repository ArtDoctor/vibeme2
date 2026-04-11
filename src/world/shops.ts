import { safeZoneCenterXZ, isAdvancedShopSafeZoneIndex } from "./spawnSafeZone";

/**
 * Must match `safe_zone_shop_spot_xz` in `server/src/world.rs` (one stall per safe courtyard).
 */
export const SHOP_INTERACT_RADIUS = 3.85;

export const SHOP_SAFE_ZONE_COUNT = 8;

/** Distance from safe-zone center toward the map edge — counter / interaction spot (not courtyard middle). */
export const SHOP_SERVICE_SPOT_OFFSET = 1.85;

/** World XZ used for distance checks — offset from courtyard center along the outward radial (spawn uses +Z). */
export function shopServiceSpotFromCenter(
  cx: number,
  cz: number,
): { readonly x: number; readonly z: number } {
  const h = Math.hypot(cx, cz);
  let dx: number;
  let dz: number;
  if (h < 0.01) {
    dx = 0;
    dz = 1;
  } else {
    dx = cx / h;
    dz = cz / h;
  }
  return {
    x: cx + dx * SHOP_SERVICE_SPOT_OFFSET,
    z: cz + dz * SHOP_SERVICE_SPOT_OFFSET,
  };
}

/** Stall interaction positions — index = safe zone index (`ALL_SPAWN_SAFE_ZONE_AABBS`). */
export const SHOP_POSITIONS: readonly { readonly x: number; readonly z: number }[] =
  Array.from({ length: SHOP_SAFE_ZONE_COUNT }, (_, i) => {
    const c = safeZoneCenterXZ(i);
    return shopServiceSpotFromCenter(c.x, c.z);
  });

export interface ShopOfferClient {
  readonly sku: string;
  readonly label: string;
  readonly price: number;
  readonly needsBoss: boolean;
}

/** Traveler stalls: center (0), red north (1), blue south (6), neutral east (7) — iron tier + essentials. */
export const SHOP_CATALOG_BASIC: readonly ShopOfferClient[] = [
  { sku: "ironSword", label: "Iron sword", price: 42, needsBoss: false },
  { sku: "basicShield", label: "Shield", price: 32, needsBoss: false },
  { sku: "shortBow", label: "Short bow", price: 52, needsBoss: false },
  { sku: "scoutHelm", label: "Scout helm", price: 18, needsBoss: false },
  { sku: "scoutChest", label: "Scout chest", price: 26, needsBoss: false },
  { sku: "scoutLegs", label: "Scout legs", price: 20, needsBoss: false },
];

/** Corner outposts (2–5): steel, vanguard, discounted basics. */
export const SHOP_CATALOG_ADVANCED: readonly ShopOfferClient[] = [
  { sku: "ironSword", label: "Iron sword", price: 38, needsBoss: false },
  { sku: "steelSword", label: "Steel sword", price: 92, needsBoss: false },
  { sku: "vanguardSword", label: "Vanguard sword", price: 185, needsBoss: true },
  { sku: "basicShield", label: "Shield", price: 29, needsBoss: false },
  { sku: "shortBow", label: "Short bow", price: 48, needsBoss: false },
  { sku: "scoutHelm", label: "Scout helm", price: 16, needsBoss: false },
  { sku: "scoutChest", label: "Scout chest", price: 24, needsBoss: false },
  { sku: "scoutLegs", label: "Scout legs", price: 18, needsBoss: false },
];

export function shopCatalogForSafeZoneIndex(
  shopIndex: number,
): readonly ShopOfferClient[] {
  return isAdvancedShopSafeZoneIndex(shopIndex)
    ? SHOP_CATALOG_ADVANCED
    : SHOP_CATALOG_BASIC;
}

/** Sell prices per unit — must match `sell_price_gold` in `server/src/items.rs`. */
export interface ShopSellOfferClient {
  readonly kind: string;
  readonly label: string;
  readonly unitGold: number;
}

export const SHOP_SELL_OFFERS: readonly ShopSellOfferClient[] = [
  { kind: "ironSword", label: "Iron sword", unitGold: 16 },
  { kind: "steelSword", label: "Steel sword", unitGold: 38 },
  { kind: "vanguardSword", label: "Vanguard sword", unitGold: 72 },
  { kind: "basicShield", label: "Shield", unitGold: 12 },
  { kind: "shortBow", label: "Short bow", unitGold: 20 },
  { kind: "scoutHelm", label: "Scout helm", unitGold: 7 },
  { kind: "scoutChest", label: "Scout chest", unitGold: 10 },
  { kind: "scoutLegs", label: "Scout legs", unitGold: 8 },
  { kind: "gearUpgradeToken", label: "Gear token", unitGold: 35 },
];

export function nearestShopIndex(
  x: number,
  z: number,
): { index: number; dist: number } | null {
  let best: { index: number; dist: number } | null = null;
  for (let i = 0; i < SHOP_POSITIONS.length; i += 1) {
    const p = SHOP_POSITIONS[i];
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= SHOP_INTERACT_RADIUS && (best === null || d < best.dist)) {
      best = { index: i, dist: d };
    }
  }
  return best;
}
