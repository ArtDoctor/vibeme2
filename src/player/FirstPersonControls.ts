import { Camera, PerspectiveCamera, Vector3 } from "three";

import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { horizontalYawFromCamera } from "../combat/constants";
import { EYE_HEIGHT, PLAYER_RADIUS } from "../game/constants";
import type { PlayerTeam } from "../net/types";
import type { DesertWorld } from "../scene/DesertScene";
import { extrudeFromEnemyWarCamps } from "../world/teamTerritory";
import type { PlayerState } from "./PlayerState";
import { iterativelyResolvePlayerXz } from "./circleAabbXZ";
import {
  applyCreativeSpacePress,
  createMovementModeState,
  CREATIVE_MOVE_SPEED,
  DEFAULT_MOVE_SPEED,
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
/** Extra pull-back for death reveal (meters, animated). */
const DEATH_EXTRA_PULL = 3.15;
/** FOV bump while death camera is active (degrees). */
const DEATH_FOV_EXTRA = 9;
const VIEW_BOB_AMP = 0.038;
const VIEW_BOB_FREQ = 11.5;

export interface FirstPersonControlsOptions {
  camera: Camera;
  domElement: HTMLElement;
  world: DesertWorld;
  hudHint?: HTMLElement;
  /** Shown while the player is inside the spawn castle safe zone (UI only). */
  safeZoneHint?: HTMLElement;
  /** Shown while creative mode is enabled (UI only). */
  creativeHint?: HTMLElement;
  /** Multiplayer: push feet out of the enemy war-camp disk (matches server). */
  getPlayerTeam?: () => PlayerTeam | null;
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
  private readonly creativeHint?: HTMLElement;
  private readonly getPlayerTeam?: () => PlayerTeam | null;
  private readonly move = new Vector3();
  private readonly velocity = new Vector3();
  /** Eye / capsule top — authoritative for physics and networking (not camera when in third person). */
  private readonly eyePosition = new Vector3();
  private readonly scratchFwd = new Vector3();
  private readonly scratchRight = new Vector3();
  private readonly scratchUp = new Vector3(0, 1, 0);
  private readonly scratchShake = new Vector3();
  private thirdPerson = false;
  private thirdPersonBeforeDeath = false;
  /** Death / revive UI: orbit camera on frozen pose, no movement look. */
  private deathCameraActive = false;
  private deathCameraElapsed = 0;
  private damageShake = 0;
  private viewBobPhase = 0;
  private viewWalkActive = false;
  private readonly baseFov: number;

  private keyForward = false;
  private keyBackward = false;
  private keyLeft = false;
  private keyRight = false;
  private keyAscend = false;
  private keyDescend = false;
  private keySprint = false;
  private jumpRequested = false;
  private movementMode = createMovementModeState();
  /** When true (e.g. chat compose), movement and look are frozen; pointer lock is released externally. */
  private inputSuppressed = false;

  constructor(options: FirstPersonControlsOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.world = options.world;
    this.hudHint = options.hudHint;
    this.safeZoneHint = options.safeZoneHint;
    this.creativeHint = options.creativeHint;
    this.getPlayerTeam = options.getPlayerTeam;

    this.controls = new PointerLockControls(this.camera, this.domElement);
    this.baseFov =
      options.camera instanceof PerspectiveCamera ? options.camera.fov : 72;

    this.domElement.addEventListener("click", this.onCanvasClick);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    this.controls.addEventListener("lock", this.onLock);
    this.controls.addEventListener("unlock", this.onUnlock);
  }

  /**
   * Disables WASD, mouse-look integration, and combat movement while chat or modal UI owns input.
   * Clears held movement keys when enabling suppression.
   */
  setInputSuppressed(suppressed: boolean): void {
    this.inputSuppressed = suppressed;
    if (suppressed) {
      this.keyForward = false;
      this.keyBackward = false;
      this.keyLeft = false;
      this.keyRight = false;
      this.keyAscend = false;
      this.keyDescend = false;
      this.keySprint = false;
      this.jumpRequested = false;
      this.velocity.set(0, 0, 0);
      this.syncStateVelocity();
    }
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

  /** Hard-set the local eye pose from the authoritative server snapshot. */
  syncAuthoritativePose(pose: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
  }): void {
    this.eyePosition.set(pose.x, pose.y, pose.z);
    this.velocity.set(0, 0, 0);
    this.state.velocity.x = 0;
    this.state.velocity.y = 0;
    this.state.velocity.z = 0;
    this.state.onGround = true;
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.x = pose.pitch;
    this.camera.rotation.y = pose.yaw;
    this.camera.rotation.z = 0;
    this.applyCameraView();
  }

  /** Pull local prediction back to server truth when drift grows too large. */
  reconcileAuthoritativePose(
    pose: {
      x: number;
      y: number;
      z: number;
      yaw: number;
      pitch: number;
    },
    maxPositionError = 1.25,
  ): boolean {
    const dx = this.eyePosition.x - pose.x;
    const dy = this.eyePosition.y - pose.y;
    const dz = this.eyePosition.z - pose.z;
    const errorSq = dx * dx + dy * dy + dz * dz;
    if (errorSq <= maxPositionError * maxPositionError) {
      return false;
    }
    // Preserve the current look direction for ordinary movement corrections so a
    // late authoritative position update does not visibly tug the camera yaw.
    if (errorSq <= 36.0) {
      this.eyePosition.set(pose.x, pose.y, pose.z);
      this.velocity.set(0, 0, 0);
      this.state.velocity.x = 0;
      this.state.velocity.y = 0;
      this.state.velocity.z = 0;
      this.state.onGround = true;
      this.applyCameraView();
      return true;
    }
    this.syncAuthoritativePose(pose);
    return true;
  }

  /** When true, the camera is offset behind the eye for a third-person view. */
  get isThirdPerson(): boolean {
    return this.thirdPerson;
  }

  /** Third-person body mesh (R key or death cam). */
  get shouldShowThirdPersonRig(): boolean {
    return this.thirdPerson || this.deathCameraActive;
  }

  get isDeathCameraActive(): boolean {
    return this.deathCameraActive;
  }

  /** Death UI: orbit camera, freeze controls separately from chat suppression. */
  beginDeathCamera(): void {
    this.thirdPersonBeforeDeath = this.thirdPerson;
    this.deathCameraActive = true;
    this.deathCameraElapsed = 0;
    this.thirdPerson = true;
  }

  endDeathCamera(): void {
    this.deathCameraActive = false;
    this.deathCameraElapsed = 0;
    this.thirdPerson = this.thirdPersonBeforeDeath;
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Camera kick when taking damage (normalized-ish amount). */
  addDamageShake(amount: number): void {
    const a = Math.min(80, Math.max(0, amount));
    this.damageShake = Math.min(1, this.damageShake + a * 0.028);
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.05);
    this.damageShake = Math.max(0, this.damageShake - dt * 2.5);
    if (this.deathCameraActive) {
      this.deathCameraElapsed += dt;
    }

    const canWalkBob =
      !this.inputSuppressed &&
      !this.deathCameraActive &&
      this.controls.isLocked &&
      !(this.movementMode.creativeMode && this.movementMode.flyMode) &&
      this.state.onGround &&
      (this.keyForward ||
        this.keyBackward ||
        this.keyLeft ||
        this.keyRight);
    this.viewWalkActive = canWalkBob && !this.thirdPerson;
    if (this.viewWalkActive) {
      this.viewBobPhase += dt * VIEW_BOB_FREQ;
    }

    if (this.inputSuppressed) {
      this.applyCameraView();
      this.updateSafeZoneHint();
      this.updateCreativeHint();
      return;
    }
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
      this.updateCreativeHint();
      return;
    }

    if (this.movementMode.creativeMode && this.movementMode.flyMode) {
      this.updateFlyMode(delta);
      this.applyCameraView();
      this.updateSafeZoneHint();
      this.updateCreativeHint();
      return;
    }

    this.buildHorizontalMoveFromKeys();
    const speedMultiplier = movementSpeedMultiplier(this.keySprint);
    const base = this.effectiveHorizontalMoveSpeed();
    this.velocity.x = this.move.x * base * speedMultiplier;
    this.velocity.z = this.move.z * base * speedMultiplier;
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
    this.applyEnemyWarCampExtrusion();

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
    this.updateCreativeHint();
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
    this.endDeathCamera();
    this.domElement.removeEventListener("click", this.onCanvasClick);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    this.controls.removeEventListener("lock", this.onLock);
    this.controls.removeEventListener("unlock", this.onUnlock);
    this.controls.disconnect();
  }

  // ---------------------------------------------------------------- private

  private applyDamageShakeOffset(): void {
    if (this.damageShake <= 1e-4) {
      return;
    }
    const s = this.damageShake * 0.09;
    this.scratchShake.set(
      (Math.random() - 0.5) * 2 * s,
      (Math.random() - 0.5) * 2 * s * 0.55,
      (Math.random() - 0.5) * 2 * s,
    );
    this.camera.position.add(this.scratchShake);
  }

  private applyCameraView(): void {
    const orbit = this.thirdPerson || this.deathCameraActive;

    if (!orbit) {
      this.camera.position.copy(this.eyePosition);
      if (this.viewWalkActive) {
        this.camera.position.y += Math.sin(this.viewBobPhase) * VIEW_BOB_AMP;
      }
      this.applyDamageShakeOffset();
      if (this.camera instanceof PerspectiveCamera) {
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    let extra = 0;
    let fov = this.baseFov;
    if (this.deathCameraActive) {
      const u = Math.min(1, this.deathCameraElapsed / 0.42);
      const ease = u * u * (3 - 2 * u);
      extra = DEATH_EXTRA_PULL * ease;
      fov = this.baseFov + DEATH_FOV_EXTRA * ease;
    }
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.copy(this.eyePosition);
    this.camera.getWorldDirection(this.scratchFwd);
    const dist = THIRD_PERSON_DISTANCE + extra;
    this.camera.position.addScaledVector(this.scratchFwd, -dist);
    this.scratchRight.crossVectors(this.scratchFwd, this.scratchUp);
    if (this.scratchRight.lengthSq() > 1e-10) {
      this.scratchRight.normalize();
      this.camera.position.addScaledVector(
        this.scratchRight,
        THIRD_PERSON_SIDE_OFFSET,
      );
    }
    this.camera.position.y += THIRD_PERSON_Y_BIAS;
    this.applyDamageShakeOffset();
  }

  private updateSafeZoneHint(): void {
    if (!this.safeZoneHint) return;
    const { x, z } = this.eyePosition;
    const inside = this.world.pointInSpawnSafeZone(x, z);
    this.safeZoneHint.classList.toggle("hidden", !inside);
  }

  private updateCreativeHint(): void {
    if (!this.creativeHint) return;
    this.creativeHint.classList.toggle("hidden", !this.movementMode.creativeMode);
  }

  /** Walk/run base speed before sprint multiplier. */
  private effectiveHorizontalMoveSpeed(): number {
    return this.movementMode.creativeMode ? CREATIVE_MOVE_SPEED : DEFAULT_MOVE_SPEED;
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
    const speed =
      CREATIVE_MOVE_SPEED * movementSpeedMultiplier(this.keySprint);
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
    this.applyEnemyWarCampExtrusion();

    this.state.onGround = false;
    this.syncStateVelocity();
  }

  private applyEnemyWarCampExtrusion(): void {
    const team = this.getPlayerTeam?.() ?? null;
    if (team === null) {
      return;
    }
    const o = extrudeFromEnemyWarCamps(team, this.eyePosition.x, this.eyePosition.z);
    this.eyePosition.x = o.x;
    this.eyePosition.z = o.z;
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
    if (this.inputSuppressed) return;
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
    if (this.inputSuppressed) return;
    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        this.keyForward = true;
        break;
      case "KeyS":
        if (e.ctrlKey || e.metaKey) {
          break;
        }
        this.keyBackward = true;
        break;
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
      case "KeyQ":
        this.keyDescend = true;
        break;
      case "ShiftLeft":
      case "ShiftRight":
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
    if (this.inputSuppressed) return;
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
      case "KeyQ":
        this.keyDescend = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.keySprint = false;
        break;
      default:
        break;
    }
  };
}
