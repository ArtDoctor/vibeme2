import { BOW_MIN_CHARGE } from "../combat/constants";
import type {
  InventoryEntry,
  MainHandKind,
  OffHandKind,
  SnapshotPlayer,
} from "../net/types";
import { mainHandIsSword } from "../net/types";

export interface CombatOutbound {
  mainHand: MainHandKind;
  offHand: OffHandKind | null;
  blocking: boolean;
  bowCharge: number;
  swing: boolean;
  fireArrow: boolean;
}

const SWING_COOLDOWN_S = 0.45;

/**
 * Keyboard + mouse combat for Milestone 2.
 * 1 — sword, 2 — toggle shield off-hand, 3 — bow (works before pointer lock).
 * Sword: LMB swing. Shield: RMB block while sword is equipped. Bow: hold/release LMB.
 */
export class CombatInput {
  mainHand: MainHandKind = "woodenSword";
  offHand: OffHandKind | null = null;
  private blocking = false;
  private bowCharging = false;
  private bowCharge = 0;
  /** Charge snapshot for the outbound that carries `fireArrow`. */
  private bowShotCharge = 0;
  private lastSwingSent = 0;
  private swingPending = false;
  private firePending = false;
  private ownedShield = false;
  private ownedBow = false;
  private invSnapshot: readonly InventoryEntry[] = [];
  private chatSuppressed = false;

  constructor(
    private readonly domElement: HTMLElement,
    private readonly isPointerLocked: () => boolean,
  ) {
    this.domElement.addEventListener("mousedown", this.onMouseDown);
    this.domElement.addEventListener("mouseup", this.onMouseUp);
    this.domElement.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });
    document.addEventListener("keydown", this.onKeyDown);
  }

  setChatSuppressed(suppressed: boolean): void {
    this.chatSuppressed = suppressed;
    if (suppressed) {
      this.blocking = false;
      this.bowCharging = false;
      this.bowCharge = 0;
    }
  }

  /** Call each frame before networking send; `dt` is seconds. */
  update(dt: number): void {
    if (this.chatSuppressed) return;
    const locked = this.isPointerLocked();
    if (!locked) {
      this.blocking = false;
      this.bowCharging = false;
      return;
    }

    if (this.mainHand === "shortBow" && this.bowCharging) {
      this.bowCharge = Math.min(1, this.bowCharge + dt / 1.15);
    } else if (this.mainHand !== "shortBow") {
      this.bowCharge = 0;
    }
  }

  consumeOutbound(): CombatOutbound {
    const swing = this.swingPending;
    const fireArrow = this.firePending;
    this.swingPending = false;
    this.firePending = false;
    const bowCharge = fireArrow ? this.bowShotCharge : this.bowCharge;
    if (fireArrow) {
      this.bowShotCharge = 0;
      this.bowCharge = 0;
    }
    return {
      mainHand: this.mainHand,
      offHand: this.offHand,
      blocking: this.blocking,
      bowCharge,
      swing,
      fireArrow,
    };
  }

  /** Blocking state for first-person shield pose (RMB). */
  getBlocking(): boolean {
    return this.blocking;
  }

  getCurrentMainHand(): MainHandKind {
    return this.mainHand;
  }

  getCurrentOffHand(): OffHandKind | null {
    return this.offHand;
  }

  /** Current bow draw amount 0–1 for local view animation. */
  getBowChargeVisual(): number {
    return this.bowCharge;
  }

  syncFromSnapshot(player: SnapshotPlayer): void {
    this.invSnapshot = player.inventory;
    this.ownedShield = hasInventoryItem(player.inventory, "basicShield");
    this.ownedBow = hasInventoryItem(player.inventory, "shortBow");
    if (!this.ownedShield) {
      this.offHand = null;
      this.blocking = false;
    }
    if (!this.ownedBow && this.mainHand === "shortBow") {
      this.mainHand = firstOwnedSword(this.invSnapshot);
      this.bowCharging = false;
      this.bowCharge = 0;
    }
    if (this.offHand === null && player.offHand !== null) {
      this.offHand = player.offHand;
    }
    if (!hasAnySword(this.invSnapshot)) {
      this.mainHand = player.mainHand;
    } else if (!hasInventoryItem(player.inventory, this.mainHand)) {
      this.mainHand = firstOwnedSword(this.invSnapshot);
    }
    if (player.mainHand !== this.mainHand && !this.isPointerLocked()) {
      this.mainHand = player.mainHand;
    }
    if (player.offHand !== this.offHand && !this.isPointerLocked()) {
      this.offHand = player.offHand;
    }
  }

  dispose(): void {
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    this.domElement.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("keydown", this.onKeyDown);
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.chatSuppressed) return;
    if (!this.isPointerLocked()) return;
    if (e.button === 0) {
      if (mainHandIsSword(this.mainHand)) {
        const now = performance.now() / 1000;
        if (now - this.lastSwingSent >= SWING_COOLDOWN_S) {
          this.swingPending = true;
          this.lastSwingSent = now;
        }
      } else if (this.mainHand === "shortBow") {
        this.bowCharging = true;
        this.bowCharge = 0;
      }
    } else if (e.button === 2 && this.canBlock()) {
      e.preventDefault();
      this.blocking = true;
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (this.chatSuppressed) return;
    if (e.button === 0 && this.mainHand === "shortBow" && this.bowCharging) {
      this.bowCharging = false;
      if (this.bowCharge >= BOW_MIN_CHARGE) {
        this.bowShotCharge = this.bowCharge;
        this.firePending = true;
      }
      this.bowCharge = 0;
    }
    if (e.button === 2) {
      this.blocking = false;
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.chatSuppressed) return;
    if (this.applyWeaponKeyCode(e.code)) {
      e.preventDefault();
      return;
    }
    if (!this.isPointerLocked()) return;
  };

  /** 1–3 / numpad 1–3 switch weapon without pointer lock (mouse combat still needs lock). */
  private applyWeaponKeyCode(code: string): boolean {
    switch (code) {
      case "Digit1":
      case "Numpad1":
        this.cycleOwnedSword();
        this.bowCharging = false;
        this.bowCharge = 0;
        this.blocking = false;
        return true;
      case "Digit2":
      case "Numpad2":
        if (!this.ownedShield) {
          return false;
        }
        this.offHand = this.offHand === "basicShield" ? null : "basicShield";
        if (!this.canBlock()) {
          this.blocking = false;
        }
        return true;
      case "Digit3":
      case "Numpad3":
        if (!this.ownedBow) {
          return false;
        }
        this.mainHand = "shortBow";
        this.blocking = false;
        return true;
      default:
        return false;
    }
  }

  private canBlock(): boolean {
    return mainHandIsSword(this.mainHand) && this.offHand === "basicShield";
  }

  /** Preference order when cycling swords (best first). */
  private cycleOwnedSword(): void {
    const order: MainHandKind[] = [
      "vanguardSword",
      "steelSword",
      "ironSword",
      "woodenSword",
    ];
    const owned = order.filter((k) =>
      hasInventoryItem(this.invSnapshot, k),
    );
    if (owned.length === 0) {
      this.mainHand = "woodenSword";
      return;
    }
    const idx = owned.indexOf(this.mainHand);
    this.mainHand = owned[(idx + 1 + owned.length) % owned.length];
  }
}

function hasAnySword(inv: readonly InventoryEntry[]): boolean {
  return (
    hasInventoryItem(inv, "woodenSword") ||
    hasInventoryItem(inv, "ironSword") ||
    hasInventoryItem(inv, "steelSword") ||
    hasInventoryItem(inv, "vanguardSword")
  );
}

function firstOwnedSword(inv: readonly InventoryEntry[]): MainHandKind {
  const order: MainHandKind[] = [
    "vanguardSword",
    "steelSword",
    "ironSword",
    "woodenSword",
  ];
  for (const k of order) {
    if (hasInventoryItem(inv, k)) return k;
  }
  return "woodenSword";
}

function hasInventoryItem(
  inventory: readonly InventoryEntry[],
  kind: InventoryEntry["kind"],
): boolean {
  return inventory.some((entry) => entry.kind === kind && entry.count > 0);
}
