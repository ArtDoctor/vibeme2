import { Clock, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { MultiplayerClient } from "../net/multiplayer";
import type { SnapshotMsg } from "../net/types";
import { CombatInput } from "../player/CombatInput";
import { FirstPersonControls } from "../player/FirstPersonControls";
import { buildDesertScene } from "../scene/DesertScene";
import { RemotePlayers } from "./RemotePlayers";
import { WorldArrows } from "./WorldArrows";

/**
 * Owns the renderer, scene, camera, animation loop, resize handler, and dispose.
 *
 * Intentionally thin: it wires modules together and pumps the loop. Level
 * geometry lives in scene/, movement lives in player/. Adding a new system
 * (mobs, networking, UI overlays) means adding a module and calling its
 * update + dispose from here — not editing the scene file.
 */
export interface GameOptions {
  canvas: HTMLCanvasElement;
  hudHint?: HTMLElement;
  safeZoneHint?: HTMLElement;
  /** HP / stamina / gold (multiplayer). */
  hudCombat?: HTMLElement;
  /** When set, other players are rendered for this connection. */
  localPlayerId?: string;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly clock = new Clock();
  private readonly controls: FirstPersonControls;
  private readonly combatInput: CombatInput | null;
  private readonly resizeHandler: () => void;
  private readonly remotePlayers: RemotePlayers | null;
  private readonly worldArrows: WorldArrows | null;
  private readonly hudCombat?: HTMLElement;
  private readonly localPlayerId?: string;
  private multiplayer: MultiplayerClient | null = null;
  private animationId: number | null = null;
  private disposed = false;

  constructor(options: GameOptions) {
    this.canvas = options.canvas;

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene = new Scene();

    this.camera = new PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.05,
      400,
    );

    const world = buildDesertScene(this.scene);

    this.controls = new FirstPersonControls({
      camera: this.camera,
      domElement: this.canvas,
      world,
      hudHint: options.hudHint,
      safeZoneHint: options.safeZoneHint,
    });
    this.controls.setSpawn(world.spawn);

    this.localPlayerId = options.localPlayerId;
    this.hudCombat = options.hudCombat;
    this.remotePlayers =
      options.localPlayerId !== undefined
        ? new RemotePlayers(this.scene, options.localPlayerId)
        : null;
    this.worldArrows =
      options.localPlayerId !== undefined ? new WorldArrows(this.scene) : null;
    this.combatInput =
      options.localPlayerId !== undefined
        ? new CombatInput(this.canvas, () => this.controls.controls.isLocked)
        : null;

    this.resizeHandler = (): void => this.handleResize();
    window.addEventListener("resize", this.resizeHandler);
    // Trigger once so we match whatever the initial canvas size is.
    this.handleResize();
  }

  /** Wire authoritative snapshots + outbound pose after `MultiplayerClient.connect`. */
  attachMultiplayer(client: MultiplayerClient): void {
    if (this.disposed) return;
    this.multiplayer = client;
    if (!this.combatInput) {
      client.startSending(() => {
        const pose = this.controls.getNetworkPose();
        return {
          x: pose.x,
          y: pose.y,
          z: pose.z,
          yaw: pose.yaw,
          pitch: pose.pitch,
          weapon: "sword",
          blocking: false,
          bowCharge: 0,
          swing: false,
          fireArrow: false,
        };
      });
      return;
    }
    const combatInput = this.combatInput;
    client.startSending(() => {
      const pose = this.controls.getNetworkPose();
      const c = combatInput.consumeOutbound();
      return {
        x: pose.x,
        y: pose.y,
        z: pose.z,
        yaw: pose.yaw,
        pitch: pose.pitch,
        weapon: c.weapon,
        blocking: c.blocking,
        bowCharge: c.bowCharge,
        swing: c.swing,
        fireArrow: c.fireArrow,
      };
    });
  }

  applyRemoteSnapshot(msg: SnapshotMsg): void {
    if (this.disposed) return;
    const players = msg.players;
    const arrows = msg.arrows ?? [];
    this.remotePlayers?.applySnapshot(players);
    this.worldArrows?.sync(arrows);
    this.updateCombatHud(players);
  }

  private updateCombatHud(players: SnapshotMsg["players"]): void {
    const el = this.hudCombat;
    const id = this.localPlayerId;
    if (!el || !id) return;
    const me = players.find((p) => p.id === id);
    if (!me) return;
    el.classList.remove("hidden");
    const hpEl = el.querySelector("[data-hp]");
    const stEl = el.querySelector("[data-stamina]");
    const gEl = el.querySelector("[data-gold]");
    const wEl = el.querySelector("[data-weapon]");
    if (hpEl) hpEl.textContent = String(Math.round(me.hp));
    if (stEl) stEl.textContent = String(Math.round(me.stamina));
    if (gEl) gEl.textContent = String(me.gold);
    if (wEl) wEl.textContent = me.weapon;
    const hpFill = el.querySelector("[data-hp-fill]") as HTMLElement | null;
    const stFill = el.querySelector("[data-stamina-fill]") as HTMLElement | null;
    if (hpFill) hpFill.style.width = `${Math.max(0, Math.min(100, me.hp))}%`;
    if (stFill) stFill.style.width = `${Math.max(0, Math.min(100, me.stamina))}%`;
  }

  start(): void {
    if (this.disposed) return;
    const loop = (): void => {
      if (this.disposed) return;
      this.animationId = requestAnimationFrame(loop);
      // Clamp delta so a backgrounded tab can't unleash a huge step on resume.
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.controls.update(delta);
      this.combatInput?.update(delta);
      this.renderer.render(this.scene, this.camera);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    window.removeEventListener("resize", this.resizeHandler);
    this.multiplayer?.dispose();
    this.multiplayer = null;
    this.remotePlayers?.dispose();
    this.worldArrows?.dispose();
    this.combatInput?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }

  private handleResize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}
