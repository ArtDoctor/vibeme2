import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from "three";
import { EYE_HEIGHT } from "./constants";
import type { SnapshotPlayer } from "../net/types";

const BODY_MAT = new MeshLambertMaterial({ color: 0x4a8c6a });
const HEAD_MAT = new MeshLambertMaterial({ color: 0xe8c4a0 });

function makeNicknameSprite(nickname: string): Sprite {
  const canvas = document.createElement("canvas");
  const w = 512;
  const h = 128;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 52px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 8;
    ctx.strokeText(nickname, w / 2, h / 2);
    ctx.fillStyle = "#f4e9c8";
    ctx.fillText(nickname, w / 2, h / 2);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  const mat = new SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new Sprite(mat);
  sprite.scale.set(3.2, 0.8, 1);
  sprite.position.y = 2.35;
  return sprite;
}

/**
 * Simple box avatar + nickname for each remote player (first-person hides local).
 */
export class RemotePlayers {
  private readonly scene: Scene;
  private readonly localId: string;
  private readonly byId = new Map<string, Group>();

  constructor(scene: Scene, localPlayerId: string) {
    this.scene = scene;
    this.localId = localPlayerId;
  }

  applySnapshot(players: readonly SnapshotPlayer[]): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === this.localId) continue;
      seen.add(p.id);
      let g = this.byId.get(p.id);
      if (!g) {
        g = this.createRig(p.nickname);
        this.byId.set(p.id, g);
        this.scene.add(g);
      }
      this.updateRig(g, p);
    }
    for (const [id, g] of this.byId) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.byId.delete(id);
      }
    }
  }

  dispose(): void {
    for (const g of this.byId.values()) {
      this.scene.remove(g);
    }
    this.byId.clear();
  }

  private createRig(nickname: string): Group {
    const g = new Group();
    const body = new Mesh(new BoxGeometry(0.55, 0.95, 0.35), BODY_MAT);
    body.position.y = 0.55;
    const head = new Mesh(new BoxGeometry(0.38, 0.38, 0.38), HEAD_MAT);
    head.position.y = 1.25;
    g.add(body);
    g.add(head);
    g.add(makeNicknameSprite(nickname));
    return g;
  }

  private updateRig(g: Group, p: SnapshotPlayer): void {
    const feetY = p.y - EYE_HEIGHT;
    g.position.set(p.x, feetY, p.z);
    g.rotation.y = p.yaw;
  }
}
