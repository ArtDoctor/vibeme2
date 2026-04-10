import { Camera, Vector3 } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import type { AABBCollider, DesertWorld } from "../scene/DesertScene";
import { clamp } from "../utils/math";
import type { PlayerState } from "./PlayerState";

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

const EYE_HEIGHT = 1.65;
const PLAYER_RADIUS = 0.35;
const MOVE_SPEED = 7.5;
const JUMP_SPEED = 6.0;
const GRAVITY = 24;
/** Vertical tolerance for "I am on the ground". */
const GROUND_EPSILON = 0.05;
/** How tall a step we will auto-snap up onto (rocks, low ledges). */
const MAX_STEP_UP = 0.6;

export interface FirstPersonControlsOptions {
  camera: Camera;
  domElement: HTMLElement;
  world: DesertWorld;
  hudHint?: HTMLElement;
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
  private readonly move = new Vector3();
  private readonly velocity = new Vector3();

  private keyForward = false;
  private keyBackward = false;
  private keyLeft = false;
  private keyRight = false;
  private jumpRequested = false;

  constructor(options: FirstPersonControlsOptions) {
    this.camera = options.camera;
    this.domElement = options.domElement;
    this.world = options.world;
    this.hudHint = options.hudHint;

    this.controls = new PointerLockControls(this.camera, this.domElement);

    this.domElement.addEventListener("click", this.onCanvasClick);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    this.controls.addEventListener("lock", this.onLock);
    this.controls.addEventListener("unlock", this.onUnlock);
  }

  setSpawn(spawn: Vector3): void {
    this.camera.position.set(spawn.x, spawn.y + EYE_HEIGHT, spawn.z);
    this.velocity.set(0, 0, 0);
    this.state.velocity.x = 0;
    this.state.velocity.y = 0;
    this.state.velocity.z = 0;
    this.state.onGround = true;
  }

  update(delta: number): void {
    if (!this.controls.isLocked) {
      // Still apply gravity so the player settles even before locking.
      this.applyGravityOnly(delta);
      return;
    }

    // ---- Build desired horizontal velocity from input ----
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

    this.velocity.x = this.move.x * MOVE_SPEED;
    this.velocity.z = this.move.z * MOVE_SPEED;
    this.velocity.y -= GRAVITY * delta;

    // ---- Integrate XZ, then resolve obstacle penetration ----
    this.camera.position.x += this.velocity.x * delta;
    this.camera.position.z += this.velocity.z * delta;

    for (let iter = 0; iter < 4; iter += 1) {
      this.resolveWorldBounds();
      this.resolveColliders();
    }

    // ---- Integrate Y, then snap to ground ----
    this.camera.position.y += this.velocity.y * delta;

    const groundY = this.world.sampleGroundHeight(
      this.camera.position.x,
      this.camera.position.z,
    );
    const targetEyeY = groundY + EYE_HEIGHT;
    const feetY = this.camera.position.y - EYE_HEIGHT;

    if (feetY <= groundY + GROUND_EPSILON && this.velocity.y <= 0) {
      this.camera.position.y = targetEyeY;
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

    this.state.velocity.x = this.velocity.x;
    this.state.velocity.y = this.velocity.y;
    this.state.velocity.z = this.velocity.z;
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

  private applyGravityOnly(delta: number): void {
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.velocity.y -= GRAVITY * delta;
    this.camera.position.y += this.velocity.y * delta;
    const groundY = this.world.sampleGroundHeight(
      this.camera.position.x,
      this.camera.position.z,
    );
    if (this.camera.position.y - EYE_HEIGHT <= groundY) {
      this.camera.position.y = groundY + EYE_HEIGHT;
      this.velocity.y = 0;
      this.state.onGround = true;
    }
  }

  private resolveWorldBounds(): void {
    const limit = this.world.worldHalfSize - 1;
    this.camera.position.x = clamp(this.camera.position.x, -limit, limit);
    this.camera.position.z = clamp(this.camera.position.z, -limit, limit);
  }

  /** Push the player out of every overlapping AABB in XZ (circle-vs-box). */
  private resolveColliders(): void {
    const feetY = this.camera.position.y - EYE_HEIGHT;
    for (const c of this.world.colliders) {
      // Skip obstacles entirely below us (we walked over them).
      if (feetY > c.topY - 0.05) continue;
      this.resolveOneCollider(c);
    }
  }

  private resolveOneCollider(c: AABBCollider): void {
    const px = this.camera.position.x;
    const pz = this.camera.position.z;
    const cx = clamp(px, c.minX, c.maxX);
    const cz = clamp(pz, c.minZ, c.maxZ);
    const dx = px - cx;
    const dz = pz - cz;
    const dist = Math.hypot(dx, dz);

    if (dist >= PLAYER_RADIUS - 1e-6) {
      return;
    }

    if (dist > 1e-7) {
      const push = (PLAYER_RADIUS - dist) / dist;
      this.camera.position.x += dx * push;
      this.camera.position.z += dz * push;
      return;
    }

    // Player center is exactly inside the box — push out along the nearest face.
    const dMinX = px - c.minX;
    const dMaxX = c.maxX - px;
    const dMinZ = pz - c.minZ;
    const dMaxZ = c.maxZ - pz;
    let m = dMinX;
    let ax = -1;
    let az = 0;
    if (dMaxX < m) {
      m = dMaxX;
      ax = 1;
      az = 0;
    }
    if (dMinZ < m) {
      m = dMinZ;
      ax = 0;
      az = -1;
    }
    if (dMaxZ < m) {
      m = dMaxZ;
      ax = 0;
      az = 1;
    }
    const push = PLAYER_RADIUS + 0.02 - m;
    if (push > 0) {
      this.camera.position.x += ax * push;
      this.camera.position.z += az * push;
    }
  }

  /**
   * If the analytic ground in front of us is a bit higher than our feet
   * (e.g. a small dune or a rock we just walked into), nudge up onto it
   * instead of getting stuck.
   */
  private applyStepUp(groundY: number): void {
    const feetY = this.camera.position.y - EYE_HEIGHT;
    if (feetY < groundY && groundY - feetY <= MAX_STEP_UP) {
      this.camera.position.y = groundY + EYE_HEIGHT;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.state.onGround = true;
    }
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
          this.jumpRequested = true;
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
      default:
        break;
    }
  };
}
