import { BOW_MIN_CHARGE } from "../combat/constants";
import type { WeaponKind } from "../net/types";

export interface CombatOutbound {
  weapon: WeaponKind;
  blocking: boolean;
  bowCharge: number;
  swing: boolean;
  fireArrow: boolean;
}

const SWING_COOLDOWN_S = 0.45;

/**
 * Keyboard + mouse combat for Milestone 2.
 * 1–3 / numpad 1–3 — weapon (works before pointer lock). Sword: LMB swing. Shield: RMB block.
 * Bow: hold LMB to charge, release to fire (mouse needs pointer lock).
 */
export class CombatInput {
  weapon: WeaponKind = "sword";
  private blocking = false;
  private bowCharging = false;
  private bowCharge = 0;
  /** Charge snapshot for the outbound that carries `fireArrow`. */
  private bowShotCharge = 0;
  private lastSwingSent = 0;
  private swingPending = false;
  private firePending = false;

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

  /** Call each frame before networking send; `dt` is seconds. */
  update(dt: number): void {
    const locked = this.isPointerLocked();
    if (!locked) {
      this.blocking = false;
      this.bowCharging = false;
      return;
    }

    if (this.weapon === "bow" && this.bowCharging) {
      this.bowCharge = Math.min(1, this.bowCharge + dt / 1.15);
    } else if (this.weapon !== "bow") {
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
      weapon: this.weapon,
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

  /** Current bow draw amount 0–1 for local view animation. */
  getBowChargeVisual(): number {
    return this.bowCharge;
  }

  dispose(): void {
    this.domElement.removeEventListener("mousedown", this.onMouseDown);
    this.domElement.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("keydown", this.onKeyDown);
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.isPointerLocked()) return;
    if (e.button === 0) {
      if (this.weapon === "sword") {
        const now = performance.now() / 1000;
        if (now - this.lastSwingSent >= SWING_COOLDOWN_S) {
          this.swingPending = true;
          this.lastSwingSent = now;
        }
      } else if (this.weapon === "bow") {
        this.bowCharging = true;
        this.bowCharge = 0;
      }
    } else if (e.button === 2 && this.weapon === "shield") {
      e.preventDefault();
      this.blocking = true;
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0 && this.weapon === "bow" && this.bowCharging) {
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
        this.weapon = "sword";
        this.bowCharging = false;
        this.bowCharge = 0;
        this.blocking = false;
        return true;
      case "Digit2":
      case "Numpad2":
        this.weapon = "shield";
        this.bowCharging = false;
        this.bowCharge = 0;
        return true;
      case "Digit3":
      case "Numpad3":
        this.weapon = "bow";
        this.blocking = false;
        return true;
      default:
        return false;
    }
  }
}
