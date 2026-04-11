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
import {
  CASTLE_GATE_HALF_WIDTH,
  CASTLE_WALL_HEIGHT,
  CASTLE_WALL_THICKNESS,
  SAFE_ZONE_OUTPOST_EDGE_CENTER,
  SPAWN_COURTYARD_HALF,
  SPAWN_SAFE_ZONE_AABB,
  type SpawnSafeZoneAabb,
  isNearAnySafeZoneCastle,
  isPointInSpawnSafeZone,
} from "../world/spawnSafeZone";
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
  /**
   * Castle courtyard interior — same AABB the game server uses for safe-zone rules
   * (no PvP damage, no mob aggro, no mob spawns inside). Client: UI hint only.
   */
  spawnSafeZoneAabb: SpawnSafeZoneAabb;
  pointInSpawnSafeZone(x: number, z: number): boolean;
}

const SAND_COLOR = 0xd7b56d;
const MOUNTAIN_COLOR = 0x7a5a36;
const ROCK_COLOR = 0x9a7a4a;
const CASTLE_STONE_COLOR = 0x8a8780;
const SKY_COLOR = 0xf6c98a;
const FOG_NEAR = 120;
const FOG_FAR = 650;
const MOUNTAIN_COUNT = 36;
const SMALL_MOUNTAIN_COUNT = 72;
const ROCK_COUNT = 140;

/**
 * Builds the desert: terrain mesh, sky/fog, lighting, scattered mountains/rocks.
 * Returns only the data gameplay code needs (collision query + colliders + spawn).
 */
export function buildDesertScene(scene: Scene): DesertWorld {
  scene.background = new Color(SKY_COLOR);
  scene.fog = new Fog(SKY_COLOR, FOG_NEAR, FOG_FAR);

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

  for (let i = 0; i < SMALL_MOUNTAIN_COUNT; i += 1) {
    const x = (hash2(i, 71) - 0.5) * (TERRAIN_HALF_SIZE * 1.6);
    const z = (hash2(i, 83) - 0.5) * (TERRAIN_HALF_SIZE * 1.6);
    if (isNearAnySafeZoneCastle(x, z, 32)) continue;
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

  for (let i = 0; i < ROCK_COUNT; i += 1) {
    const x = (hash2(i, 5) - 0.5) * TERRAIN_HALF_SIZE * 1.7;
    const z = (hash2(i, 7) - 0.5) * TERRAIN_HALF_SIZE * 1.7;
    if (isNearAnySafeZoneCastle(x, z, 28)) continue;
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

  // Safe spawn castles — server-side damage/aggro/spawn checks must match `isPointInSpawnSafeZone`.
  const outE = SAFE_ZONE_OUTPOST_EDGE_CENTER;
  addSpawnCastle(scene, colliders, sampleTerrainHeight);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, 0, outE);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, -outE, outE);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, outE, outE);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, -outE, -outE);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, outE, -outE);

  // TODO(multiplayer): shops, NPCs, mob spawners, boss arenas, team flags.
  // TODO(content): replace cones with proper mountain meshes once art exists.

  const spawn = new Vector3(0, sampleTerrainHeight(0, 0), 0);

  return {
    sampleGroundHeight: sampleTerrainHeight,
    colliders,
    spawn,
    worldHalfSize: TERRAIN_HALF_SIZE,
    spawnSafeZoneAabb: SPAWN_SAFE_ZONE_AABB,
    pointInSpawnSafeZone: isPointInSpawnSafeZone,
  };
}

/**
 * Ring of box walls with a south gate gap; stone-grey meshes vs sand terrain.
 * Colliders are tall AABBs — same model as mountains/rocks (`AABBCollider`).
 */
function addSpawnCastle(
  scene: Scene,
  colliders: AABBCollider[],
  sampleGround: (x: number, z: number) => number,
  centerX = 0,
  centerZ = 0,
): void {
  const half = SPAWN_COURTYARD_HALF;
  const t = CASTLE_WALL_THICKNESS;
  const h = CASTLE_WALL_HEIGHT;
  const wallZSpan = 2 * half + 2 * t;
  const wallXSpan = wallZSpan;

  const stoneMat = new MeshLambertMaterial({ color: CASTLE_STONE_COLOR });

  const addSegment = (cx: number, cz: number, sizeX: number, sizeZ: number): void => {
    const baseY = sampleGround(cx, cz);
    const mesh = new Mesh(
      new BoxGeometry(sizeX, h, sizeZ),
      stoneMat,
    );
    mesh.position.set(cx, baseY + h / 2, cz);
    scene.add(mesh);

    colliders.push({
      minX: cx - sizeX / 2,
      maxX: cx + sizeX / 2,
      minZ: cz - sizeZ / 2,
      maxZ: cz + sizeZ / 2,
      topY: baseY + h,
    });
  };

  const eastX = centerX + half + t / 2;
  addSegment(eastX, centerZ, t, wallZSpan);

  const westX = centerX - half - t / 2;
  addSegment(westX, centerZ, t, wallZSpan);

  const northZ = centerZ + half + t / 2;
  addSegment(centerX, northZ, wallXSpan, t);

  const southZ = centerZ - half - t / 2;
  const southWestOuter = centerX - half - t;
  const southEastOuter = centerX + half + t;
  const gateHalf = CASTLE_GATE_HALF_WIDTH;
  const southLeftW = centerX + -gateHalf - southWestOuter;
  const southRightW = southEastOuter - (centerX + gateHalf);
  const southLeftCx = (southWestOuter + (centerX + -gateHalf)) / 2;
  const southRightCx = (centerX + gateHalf + southEastOuter) / 2;
  addSegment(southLeftCx, southZ, southLeftW, t);
  addSegment(southRightCx, southZ, southRightW, t);
}
