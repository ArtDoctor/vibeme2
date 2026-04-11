import { safeZoneCenterXZ, isAdvancedShopSafeZoneIndex } from "./spawnSafeZone";

/**
 * Must match `SAFE_ZONE_SHOP_CENTERS_XZ` in `server/src/world.rs` (one stall per safe courtyard).
 */
export const SHOP_INTERACT_RADIUS = 3.85;

export const SHOP_SAFE_ZONE_COUNT = 7;

/** Stall positions — index = safe zone index (`ALL_SPAWN_SAFE_ZONE_AABBS`). */
export const SHOP_POSITIONS: readonly { readonly x: number; readonly z: number }[] =
  Array.from({ length: SHOP_SAFE_ZONE_COUNT }, (_, i) => safeZoneCenterXZ(i));

export interface ShopOfferClient {
  readonly sku: string;
  readonly label: string;
  readonly price: number;
  readonly needsBoss: boolean;
}

/** Traveler stalls: spawn (0), north (1), south (6) — iron tier + essentials. */
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
