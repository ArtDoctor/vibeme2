import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
} from "three";

const GRAVITY = 24;
const MAX_AGE_S = 0.75;
const SIZE_MIN = 0.035;
const SIZE_MAX = 0.1;
const MAX_ALIVE = 420;

type Chunk = {
  mesh: Mesh;
  vx: number;
  vy: number;
  vz: number;
  vrx: number;
  vry: number;
  vrz: number;
  age: number;
};

/**
 * Cheap hit feedback: small unlit cubes with gravity + tumble.
 * Shared geometry/materials; meshes removed when below ground or timed out.
 */
export class HitChunkParticles {
  private readonly scene: Scene;
  private readonly root = new Group();
  private readonly sampleGround: (x: number, z: number) => number;
  private readonly geom = new BoxGeometry(1, 1, 1);
  private readonly matStrike = new MeshBasicMaterial({ color: 0xffb060 });
  private readonly matHurt = new MeshBasicMaterial({ color: 0xff5048 });
  private readonly chunks: Chunk[] = [];

  constructor(scene: Scene, sampleGround: (x: number, z: number) => number) {
    this.scene = scene;
    this.sampleGround = sampleGround;
    scene.add(this.root);
  }

  /**
   * @param kind — `strike`: you hit something (forward-ish spray). `hurt`: you took damage.
   */
  burst(
    x: number,
    y: number,
    z: number,
    kind: "strike" | "hurt" = "strike",
  ): void {
    const mat = kind === "hurt" ? this.matHurt : this.matStrike;
    const count = 11 + Math.floor(Math.random() * 9);
    for (let i = 0; i < count; i++) {
      if (this.chunks.length >= MAX_ALIVE) {
        this.removeOldest(20);
      }
      const mesh = new Mesh(this.geom, mat);
      const s = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
      mesh.scale.setScalar(s);
      mesh.position.set(
        x + (Math.random() - 0.5) * 0.12,
        y + (Math.random() - 0.5) * 0.1,
        z + (Math.random() - 0.5) * 0.12,
      );
      const theta = Math.random() * Math.PI * 2;
      const horiz = 2.2 + Math.random() * 5.5;
      let vx = Math.cos(theta) * horiz * (0.35 + Math.random() * 0.65);
      let vz = Math.sin(theta) * horiz * (0.35 + Math.random() * 0.65);
      let vy = 1.2 + Math.random() * 5.5;
      if (kind === "hurt") {
        vx *= 1.15;
        vz *= 1.15;
        vy = 0.8 + Math.random() * 4.2;
      }
      this.chunks.push({
        mesh,
        vx,
        vy,
        vz,
        vrx: (Math.random() - 0.5) * 14,
        vry: (Math.random() - 0.5) * 14,
        vrz: (Math.random() - 0.5) * 14,
        age: 0,
      });
      this.root.add(mesh);
    }
  }

  update(delta: number): void {
    const d = Math.min(delta, 0.05);
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const p = this.chunks[i];
      p.age += d;
      p.vy -= GRAVITY * d;
      const m = p.mesh;
      m.position.x += p.vx * d;
      m.position.y += p.vy * d;
      m.position.z += p.vz * d;
      m.rotation.x += p.vrx * d;
      m.rotation.y += p.vry * d;
      m.rotation.z += p.vrz * d;
      const gy = this.sampleGround(m.position.x, m.position.z);
      const gone = p.age > MAX_AGE_S || m.position.y < gy - 0.15;
      if (gone) {
        this.root.remove(m);
        this.chunks.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const p of this.chunks) {
      this.root.remove(p.mesh);
    }
    this.chunks.length = 0;
    this.scene.remove(this.root);
    this.geom.dispose();
    this.matStrike.dispose();
    this.matHurt.dispose();
  }

  private removeOldest(n: number): void {
    for (let k = 0; k < n && this.chunks.length > 0; k++) {
      const p = this.chunks.shift();
      if (p) {
        this.root.remove(p.mesh);
      }
    }
  }
}
