import { Camera, Vector3 } from "three";

import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { horizontalYawFromCamera } from "../combat/constants";
import { EYE_HEIGHT, PLAYER_RADIUS } from "../game/constants";
import type { DesertWorld } from "../scene/DesertScene";
import type { PlayerState } from "./PlayerState";
import { iterativelyResolvePlayerXz } from "./circleAabbXZ";
import {
  applyCreativeSpacePress,
  createMovementModeState,
  movementSpeedMultiplier,
} from "./movementMode";

export { EYE_HEIGHT };

/**
 * First-person controls + simple kinematic physics.
 *
 * Collision model (intentionally simple — see docs/ARCHITECTURE.md):
 *   - Ground: queried by analytic heightfield function from DesertScene.
 *     No raycasts. Cheap, deterministic, and impossible to tunnel through.
 *     LIMIT: heightfield only — no caves/overhangs. If we ever add them,
 *     this needs to grow into a swept-volume test.
 *   - Obstacles: world-space AABBs. We do circle-vs-box separation in XZ
 *     each frame. LIMIT: no rotation, no slopes; tall thin walls only.
 *     Sub-stepping (4 iterations) keeps the player from squeezing through
 *     overlapping boxes at normal walk speeds, but a fast teleport could
 *     still skip through. Validate authoritative movement on the server
 *     once multiplayer lands (docs/TASKS.md).
 */

const MOVE_SPEED = 7.5;
const JUMP_SPEED = 6.0;
const GRAVITY = 24;
/** Vertical tolerance for "I am on the ground". */
const GROUND_EPSILON = 0.05;
/** How tall a step we will auto-snap up onto (rocks, low ledges). */
const MAX_STEP_UP = 0.6;

/** Pull-back distance for third-person view (meters). */
const THIRD_PERSON_DISTANCE = 3.8;
/** Offset to the camera's right (over-the-shoulder), world meters. */
const THIRD_PERSON_SIDE_OFFSET = 0.55;
/** Slight lift so the camera clears the avatar shoulders. */
const THIRD_PERSON_Y_BIAS = 0.35;

export interface FirstPersonControlsOptions {
  camera: Camera;
  domElement: HTMLElement;
  world: DesertWorld;
  hudHint?: HTMLElement;
  /** Shown while the player is inside the spawn castle safe zone (UI only). */
  safeZoneHint?: HTMLElement;
}

export class FirstPersonControls {
  readonly controls: PointerLockControls;
  readonly state: PlayerState = {
    velocity: { x: 0, y: 0, z: 0 },
    onGround: true,
  };

  private readonly camera: Camera;
  private readonly domElement: HTMLElement;
  private readonly world: DesertWorld;
  private readonly hudHint?: HTMLElement;
  private readonly safeZoneHint?: HTMLElement;
  private readonly move = new Vector3();
  private readonly velocity = new Vector3();
  /** Eye / capsule top — authoritative for physics and networking (not camera when in third person). */
  private readonly eyePosition = new Vector3();
  private readonly scratchFwd = new Vector3();
  private readonly scratchRight = new Vector3();
  private readonly scratchUp = new Vector3(0, 1, 0);
  private thirdPerson = false;

  private keyForward = false;
  private keyBackward = false;
  private keyLeft = false;
  private keyRight = false;
  private keyAscend = false;
  private keyDescend = false;
  private keySprint = false;
  private jumpRequested = false;
  private movementMode = createMovementModeState();

  constructor(options: FirstPersonControlsOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.world = options.world;
    this.hudHint = options.hudHint;
    this.safeZoneHint = options.safeZoneHint;

    this.controls = new PointerLockControls(this.camera, this.domElement);

    this.domElement.addEventListener("click", this.onCanvasClick);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    this.controls.addEventListener("lock", this.onLock);
    this.controls.addEventListener("unlock", this.onUnlock);
  }

  setSpawn(spawn: Vector3): void {
    this.eyePosition.set(spawn.x, spawn.y + EYE_HEIGHT, spawn.z);
    this.camera.position.copy(this.eyePosition);
    this.velocity.set(0, 0, 0);
    this.state.velocity.x = 0;
    this.state.velocity.y = 0;
    this.state.velocity.z = 0;
    this.state.onGround = true;
  }

  /** When true, the camera is offset behind the eye for a third-person view. */
  get isThirdPerson(): boolean {
    return this.thirdPerson;
  }

  update(delta: number): void {
    if (!this.controls.isLocked) {
      if (this.movementMode.creativeMode && this.movementMode.flyMode) {
        this.velocity.set(0, 0, 0);
        this.state.onGround = false;
        this.syncStateVelocity();
      } else {
        // Still apply gravity so the player settles even before locking.
        this.applyGravityOnly(delta);
      }
      this.applyCameraView();
      this.updateSafeZoneHint();
      return;
    }

    if (this.movementMode.creativeMode && this.movementMode.flyMode) {
      this.updateFlyMode(delta);
      this.applyCameraView();
      this.updateSafeZoneHint();
      return;
    }

    this.buildHorizontalMoveFromKeys();
    const speedMultiplier = movementSpeedMultiplier(this.keySprint);
    this.velocity.x = this.move.x * MOVE_SPEED * speedMultiplier;
    this.velocity.z = this.move.z * MOVE_SPEED * speedMultiplier;
    this.velocity.y -= GRAVITY * delta;

    // ---- Integrate XZ, then resolve obstacle penetration ----
    this.eyePosition.x += this.velocity.x * delta;
    this.eyePosition.z += this.velocity.z * delta;

    const collisionFeetY = this.eyePosition.y - EYE_HEIGHT;
    const resolved = iterativelyResolvePlayerXz(
      this.eyePosition.x,
      this.eyePosition.z,
      collisionFeetY,
      this.world.colliders,
      { playerRadius: PLAYER_RADIUS, worldHalfSize: this.world.worldHalfSize },
    );
    this.eyePosition.x = resolved.x;
    this.eyePosition.z = resolved.z;

    // ---- Integrate Y, then snap to ground ----
    this.eyePosition.y += this.velocity.y * delta;

    const groundY = this.world.sampleGroundHeight(
      this.eyePosition.x,
      this.eyePosition.z,
    );
    const targetEyeY = groundY + EYE_HEIGHT;
    const feetY = this.eyePosition.y - EYE_HEIGHT;

    if (feetY <= groundY + GROUND_EPSILON && this.velocity.y <= 0) {
      this.eyePosition.y = targetEyeY;
      this.velocity.y = 0;
      this.state.onGround = true;
      if (this.jumpRequested) {
        this.velocity.y = JUMP_SPEED;
        this.state.onGround = false;
      }
      this.jumpRequested = false;
    } else {
      this.state.onGround = false;
    }

    // Step-up onto short obstacles we are walking into.
    this.applyStepUp(groundY);

    this.syncStateVelocity();

    this.applyCameraView();
    this.updateSafeZoneHint();
  }

  /** Eye position + view angles for multiplayer sync (radians, YXZ order). */
  getNetworkPose(): {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    creative: boolean;
    flying: boolean;
    sprinting: boolean;
  } {
    const p = this.eyePosition;
    const r = this.camera.rotation;
    /** Horizontal bearing for combat / net sync; Euler Y alone drifts when pitch ≠ 0 (YXZ order). */
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: horizontalYawFromCamera(this.camera),
      pitch: r.x,
      creative: this.movementMode.creativeMode,
      flying: this.movementMode.creativeMode && this.movementMode.flyMode,
      sprinting: this.keySprint,
    };
  }

  dispose(): void {
    this.domElement.removeEventListener("click", this.onCanvasClick);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    this.controls.removeEventListener("lock", this.onLock);
    this.controls.removeEventListener("unlock", this.onUnlock);
    this.controls.disconnect();
  }

  // ---------------------------------------------------------------- private

  private applyCameraView(): void {
    this.camera.position.copy(this.eyePosition);
    if (!this.thirdPerson) return;
    this.camera.getWorldDirection(this.scratchFwd);
    this.camera.position
      .copy(this.eyePosition)
      .addScaledVector(this.scratchFwd, -THIRD_PERSON_DISTANCE);
    this.scratchRight.crossVectors(this.scratchFwd, this.scratchUp);
    if (this.scratchRight.lengthSq() > 1e-10) {
      this.scratchRight.normalize();
      this.camera.position.addScaledVector(
        this.scratchRight,
        THIRD_PERSON_SIDE_OFFSET,
      );
    }
    this.camera.position.y += THIRD_PERSON_Y_BIAS;
  }

  private updateSafeZoneHint(): void {
    if (!this.safeZoneHint) return;
    const { x, z } = this.eyePosition;
    const inside = this.world.pointInSpawnSafeZone(x, z);
    this.safeZoneHint.classList.toggle("hidden", !inside);
  }

  private buildHorizontalMoveFromKeys(): void {
    this.move.set(0, 0, 0);
    if (this.keyForward) this.move.z -= 1;
    if (this.keyBackward) this.move.z += 1;
    if (this.keyLeft) this.move.x -= 1;
    if (this.keyRight) this.move.x += 1;

    if (this.move.lengthSq() > 0) {
      this.move.normalize();
      this.move.applyQuaternion(this.camera.quaternion);
      this.move.y = 0;
      if (this.move.lengthSq() > 1e-6) {
        this.move.normalize();
      }
    }
  }

  private updateFlyMode(delta: number): void {
    this.buildHorizontalMoveFromKeys();
    const speed = MOVE_SPEED * movementSpeedMultiplier(this.keySprint);
    this.velocity.x = this.move.x * speed;
    this.velocity.z = this.move.z * speed;
    this.velocity.y = 0;
    if (this.keyAscend) this.velocity.y += speed;
    if (this.keyDescend) this.velocity.y -= speed;

    this.eyePosition.x += this.velocity.x * delta;
    this.eyePosition.y += this.velocity.y * delta;
    this.eyePosition.z += this.velocity.z * delta;

    const collisionFeetY = this.eyePosition.y - EYE_HEIGHT;
    const resolved = iterativelyResolvePlayerXz(
      this.eyePosition.x,
      this.eyePosition.z,
      collisionFeetY,
      this.world.colliders,
      { playerRadius: PLAYER_RADIUS, worldHalfSize: this.world.worldHalfSize },
    );
    this.eyePosition.x = resolved.x;
    this.eyePosition.z = resolved.z;

    this.state.onGround = false;
    this.syncStateVelocity();
  }

  private applyGravityOnly(delta: number): void {
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.velocity.y -= GRAVITY * delta;
    this.eyePosition.y += this.velocity.y * delta;
    const groundY = this.world.sampleGroundHeight(
      this.eyePosition.x,
      this.eyePosition.z,
    );
    if (this.eyePosition.y - EYE_HEIGHT <= groundY) {
      this.eyePosition.y = groundY + EYE_HEIGHT;
      this.velocity.y = 0;
      this.state.onGround = true;
    }
    this.syncStateVelocity();
  }

  /**
   * If the analytic ground in front of us is a bit higher than our feet
   * (e.g. a small dune or a rock we just walked into), nudge up onto it
   * instead of getting stuck.
   */
  private applyStepUp(groundY: number): void {
    const feetY = this.eyePosition.y - EYE_HEIGHT;
    if (feetY < groundY && groundY - feetY <= MAX_STEP_UP) {
      this.eyePosition.y = groundY + EYE_HEIGHT;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.state.onGround = true;
    }
  }

  private syncStateVelocity(): void {
    this.state.velocity.x = this.velocity.x;
    this.state.velocity.y = this.velocity.y;
    this.state.velocity.z = this.velocity.z;
  }

  // ---- DOM event handlers (arrow methods so they bind & dispose cleanly) --

  private readonly onCanvasClick = (): void => {
    if (!this.controls.isLocked) {
      void this.controls.lock();
    }
  };

  private readonly onLock = (): void => {
    this.hudHint?.classList.add("hidden");
  };

  private readonly onUnlock = (): void => {
    this.hudHint?.classList.remove("hidden");
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        this.keyForward = true;
        break;
      case "KeyS":
      case "ArrowDown":
        this.keyBackward = true;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.keyLeft = true;
        break;
      case "KeyD":
      case "ArrowRight":
        this.keyRight = true;
        break;
      case "Space":
        if (this.controls.isLocked) {
          e.preventDefault();
          this.keyAscend = true;
          if (!e.repeat) {
            const nextMode = applyCreativeSpacePress(
              this.movementMode,
              performance.now(),
            );
            if (!this.movementMode.flyMode && nextMode.flyMode) {
              this.velocity.y = 0;
              this.jumpRequested = false;
            }
            this.movementMode = nextMode;
          }
          if (!this.movementMode.flyMode) {
            this.jumpRequested = true;
          }
        }
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.keyDescend = true;
        break;
      case "ControlLeft":
      case "ControlRight":
        this.keySprint = true;
        break;
      case "KeyL":
        if (!e.repeat && this.controls.isLocked) {
          e.preventDefault();
          this.movementMode = this.movementMode.creativeMode
            ? createMovementModeState()
            : { ...createMovementModeState(), creativeMode: true };
          this.velocity.y = 0;
          this.jumpRequested = false;
        }
        break;
      case "KeyR":
        if (!e.repeat && this.controls.isLocked) {
          e.preventDefault();
          this.thirdPerson = !this.thirdPerson;
        }
        break;
      default:
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        this.keyForward = false;
        break;
      case "KeyS":
      case "ArrowDown":
        this.keyBackward = false;
        break;
      case "KeyA":
      case "ArrowLeft":
        this.keyLeft = false;
        break;
      case "KeyD":
      case "ArrowRight":
        this.keyRight = false;
        break;
      case "Space":
        this.keyAscend = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.keyDescend = false;
        break;
      case "ControlLeft":
      case "ControlRight":
        this.keySprint = false;
        break;
      default:
        break;
    }
  };
}
