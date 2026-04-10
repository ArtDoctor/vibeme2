import {
  BoxGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
  Vector3,
} from "three";
import { hash2 } from "../utils/math";
import {
  TERRAIN_HALF_SIZE,
  TERRAIN_SEGMENTS,
  sampleTerrainHeight,
} from "./terrain";

/**
 * Axis-aligned bounding box collider, in world space, no rotation.
 * See docs/ARCHITECTURE.md ("Collision model") for limits.
 */
export interface AABBCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Top of the obstacle in world Y. Used so the player can walk over short rocks. */
  topY: number;
}

/** Everything gameplay needs from the world. Renderable meshes stay private to this module. */
export interface DesertWorld {
  /** Sample world ground height (terrain only — does not include mountain tops). */
  sampleGroundHeight(x: number, z: number): number;
  /** Static obstacles. Player resolves XZ overlap against these. */
  colliders: readonly AABBCollider[];
  /** Where to spawn the player (camera/feet position is computed by Game). */
  spawn: Vector3;
  /** Soft horizontal world bounds — keeps the player on the rendered terrain. */
  worldHalfSize: number;
}

const SAND_COLOR = 0xd7b56d;
const MOUNTAIN_COLOR = 0x7a5a36;
const ROCK_COLOR = 0x9a7a4a;
const SKY_COLOR = 0xf6c98a;

/**
 * Builds the desert: terrain mesh, sky/fog, lighting, scattered mountains/rocks.
 * Returns only the data gameplay code needs (collision query + colliders + spawn).
 */
export function buildDesertScene(scene: Scene): DesertWorld {
  scene.background = new Color(SKY_COLOR);
  scene.fog = new Fog(SKY_COLOR, 60, 220);

  // ---- Lighting -----------------------------------------------------------
  const sun = new DirectionalLight(0xfff1c4, 1.05);
  sun.position.set(40, 80, 20);
  scene.add(sun);

  const sky = new HemisphereLight(0xffe6b0, 0xc88a4a, 0.55);
  scene.add(sky);

  // ---- Terrain mesh -------------------------------------------------------
  // PlaneGeometry built XY then rotated to XZ. We displace Y per-vertex from
  // the same `sampleTerrainHeight` the player uses, so render and physics
  // never disagree.
  const geometry = new PlaneGeometry(
    TERRAIN_HALF_SIZE * 2,
    TERRAIN_HALF_SIZE * 2,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    positions.setY(i, sampleTerrainHeight(x, z));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const ground = new Mesh(
    geometry,
    new MeshLambertMaterial({ color: SAND_COLOR }),
  );
  ground.name = "desert-ground";
  scene.add(ground);

  // ---- Mountains and rocks ------------------------------------------------
  // Procedurally placed using a deterministic hash so the world is the same
  // every reload. Big mountains are cones, small rocks are cubes. Each becomes
  // an AABB collider.
  const colliders: AABBCollider[] = [];

  const MOUNTAIN_COUNT = 14;
  for (let i = 0; i < MOUNTAIN_COUNT; i += 1) {
    const r = 60 + hash2(i, 11) * (TERRAIN_HALF_SIZE - 80);
    const a = hash2(i, 23) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const radius = 8 + hash2(i, 31) * 14;
    const height = 18 + hash2(i, 41) * 26;
    const baseY = sampleTerrainHeight(x, z);

    const cone = new Mesh(
      new ConeGeometry(radius, height, 5),
      new MeshLambertMaterial({ color: MOUNTAIN_COLOR, flatShading: true }),
    );
    cone.position.set(x, baseY + height / 2, z);
    scene.add(cone);

    colliders.push({
      minX: x - radius * 0.65,
      maxX: x + radius * 0.65,
      minZ: z - radius * 0.65,
      maxZ: z + radius * 0.65,
      topY: baseY + height,
    });
  }

  const SMALL_MOUNTAIN_COUNT = 22;
  for (let i = 0; i < SMALL_MOUNTAIN_COUNT; i += 1) {
    const x = (hash2(i, 71) - 0.5) * (TERRAIN_HALF_SIZE * 1.6);
    const z = (hash2(i, 83) - 0.5) * (TERRAIN_HALF_SIZE * 1.6);
    if (Math.hypot(x, z) < 18) continue; // keep spawn area clear
    const radius = 3 + hash2(i, 97) * 5;
    const height = 5 + hash2(i, 113) * 8;
    const baseY = sampleTerrainHeight(x, z);

    const cone = new Mesh(
      new ConeGeometry(radius, height, 5),
      new MeshLambertMaterial({ color: MOUNTAIN_COLOR, flatShading: true }),
    );
    cone.position.set(x, baseY + height / 2, z);
    scene.add(cone);

    colliders.push({
      minX: x - radius * 0.6,
      maxX: x + radius * 0.6,
      minZ: z - radius * 0.6,
      maxZ: z + radius * 0.6,
      topY: baseY + height,
    });
  }

  const ROCK_COUNT = 40;
  for (let i = 0; i < ROCK_COUNT; i += 1) {
    const x = (hash2(i, 5) - 0.5) * TERRAIN_HALF_SIZE * 1.7;
    const z = (hash2(i, 7) - 0.5) * TERRAIN_HALF_SIZE * 1.7;
    if (Math.hypot(x, z) < 10) continue;
    const w = 0.8 + hash2(i, 17) * 1.6;
    const h = 0.6 + hash2(i, 19) * 1.4;
    const d = 0.8 + hash2(i, 29) * 1.6;
    const baseY = sampleTerrainHeight(x, z);

    const rock = new Mesh(
      new BoxGeometry(w, h, d),
      new MeshLambertMaterial({ color: ROCK_COLOR }),
    );
    rock.position.set(x, baseY + h / 2, z);
    scene.add(rock);

    colliders.push({
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
      topY: baseY + h,
    });
  }

  // TODO(multiplayer): shops, NPCs, mob spawners, boss arenas, team flags.
  // TODO(content): replace cones with proper mountain meshes once art exists.

  const spawn = new Vector3(0, sampleTerrainHeight(0, 0), 0);

  return {
    sampleGroundHeight: sampleTerrainHeight,
    colliders,
    spawn,
    worldHalfSize: TERRAIN_HALF_SIZE,
  };
}
