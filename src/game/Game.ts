import { Clock, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { MultiplayerClient } from "../net/multiplayer";
import type { SnapshotMsg } from "../net/types";
import { FirstPersonControls } from "../player/FirstPersonControls";
import { buildDesertScene } from "../scene/DesertScene";
import { RemotePlayers } from "./RemotePlayers";

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
  private readonly resizeHandler: () => void;
  private readonly remotePlayers: RemotePlayers | null;
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

    this.remotePlayers =
      options.localPlayerId !== undefined
        ? new RemotePlayers(this.scene, options.localPlayerId)
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
    client.startSending(() => this.controls.getNetworkPose());
  }

  applyRemoteSnapshot(msg: SnapshotMsg): void {
    if (this.disposed || !this.remotePlayers) return;
    this.remotePlayers.applySnapshot(msg.players);
  }

  start(): void {
    if (this.disposed) return;
    const loop = (): void => {
      if (this.disposed) return;
      this.animationId = requestAnimationFrame(loop);
      // Clamp delta so a backgrounded tab can't unleash a huge step on resume.
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.controls.update(delta);
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
