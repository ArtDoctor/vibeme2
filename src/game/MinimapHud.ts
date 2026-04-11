import { BIOME_BLUE_MAX_Z, BIOME_RED_MIN_Z } from "../world/biomes";
import { ALL_SPAWN_SAFE_ZONE_AABBS } from "../world/spawnSafeZone";

const W = 168;
const H = 168;

/**
 * Top-down world minimap (XZ) with biome tint, safe zones, player heading, nearby mobs.
 */
export class MinimapHud {
  private readonly canvas: HTMLCanvasElement;
  private readonly wrap: HTMLElement | null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly half: number;

  constructor(canvas: HTMLCanvasElement, worldHalfSize: number) {
    this.canvas = canvas;
    this.wrap = canvas.parentElement;
    const c = canvas.getContext("2d");
    if (!c) {
      throw new Error("MinimapHud: 2d context unavailable");
    }
    this.ctx = c;
    this.half = worldHalfSize;
    canvas.width = W;
    canvas.height = H;
  }

  setVisible(visible: boolean): void {
    this.canvas.classList.toggle("hidden", !visible);
    this.wrap?.classList.toggle("hidden", !visible);
  }

  update(
    playerX: number,
    playerZ: number,
    yaw: number,
    mobs: readonly { x: number; z: number }[],
  ): void {
    const ctx = this.ctx;
    const half = this.half;
    const mapToU = (wx: number): number => ((wx + half) / (2 * half)) * W;
    const mapToV = (wz: number): number => ((wz + half) / (2 * half)) * H;

    // Biome bands (canvas V increases with world +Z; winter south is smaller V)
    const vBlue = mapToV(BIOME_BLUE_MAX_Z);
    const vRed = mapToV(BIOME_RED_MIN_Z);
    ctx.fillStyle = "#d8e4ea";
    ctx.fillRect(0, 0, W, Math.max(1, vBlue));
    ctx.fillStyle = "#d7b56d";
    ctx.fillRect(0, vBlue, W, Math.max(1, vRed - vBlue));
    ctx.fillStyle = "#86a870";
    ctx.fillRect(0, vRed, W, Math.max(1, H - vRed));

    // Safe zone footprints
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.strokeStyle = "rgba(255,248,220,0.35)";
    ctx.lineWidth = 1;
    for (const a of ALL_SPAWN_SAFE_ZONE_AABBS) {
      const u0 = mapToU(a.minX);
      const u1 = mapToU(a.maxX);
      const v0 = mapToV(a.minZ);
      const v1 = mapToV(a.maxZ);
      ctx.fillRect(u0, v0, Math.max(1, u1 - u0), Math.max(1, v1 - v0));
      ctx.strokeRect(u0 + 0.5, v0 + 0.5, Math.max(1, u1 - u0) - 1, Math.max(1, v1 - v0) - 1);
    }

    // World edge
    ctx.strokeStyle = "rgba(40,32,20,0.5)";
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Mobs (red)
    ctx.fillStyle = "rgba(200,60,50,0.85)";
    for (const m of mobs) {
      const u = mapToU(m.x);
      const v = mapToV(m.z);
      if (u >= -4 && u <= W + 4 && v >= -4 && v <= H + 4) {
        ctx.beginPath();
        ctx.arc(u, v, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player wedge
    const pu = mapToU(playerX);
    const pv = mapToV(playerZ);
    ctx.save();
    ctx.translate(pu, pv);
    ctx.rotate(yaw);
    ctx.fillStyle = "rgba(255,244,210,0.95)";
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // North tick
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "10px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", W / 2, 11);
  }

  dispose(): void {
    /* canvas is DOM-owned */
  }
}
