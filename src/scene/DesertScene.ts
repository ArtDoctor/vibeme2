import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
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
  safeZoneCenterXZ,
  TEAM_BLUE_SAFE_ZONE_INDEX,
  TEAM_NEUTRAL_SAFE_ZONE_INDEX,
  TEAM_RED_SAFE_ZONE_INDEX,
} from "../world/spawnSafeZone";
import { isAdvancedShopSafeZoneIndex } from "../world/spawnSafeZone";
import {
  blueWarCampCenterXZ,
  ENEMY_WAR_CAMP_EXCLUSION_RADIUS,
  redWarCampCenterXZ,
} from "../world/teamTerritory";
import { SHOP_SAFE_ZONE_COUNT } from "../world/shops";
import {
  BIOME_RED_MIN_Z,
  biomeMountainColor,
  biomeRockColor,
  setBiomeGroundColor,
} from "../world/biomes";
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

/** Semi-transparent disks — red/blue war-camp exclusion (server `extrude_from_enemy_war_camps`). */
function addWarCampTerritoryDisks(
  scene: Scene,
  sampleGround: (x: number, z: number) => number,
): void {
  const r = ENEMY_WAR_CAMP_EXCLUSION_RADIUS;
  const geom = new CircleGeometry(r, 56);
  const addDisk = (cx: number, cz: number, color: number): void => {
    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const m = new Mesh(geom, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, sampleGround(cx, cz) + 0.055, cz);
    m.renderOrder = -5;
    scene.add(m);
  };
  const rc = redWarCampCenterXZ();
  const bc = blueWarCampCenterXZ();
  addDisk(rc.x, rc.z, 0xcc4444);
  addDisk(bc.x, bc.z, 0x4466cc);
}

const CASTLE_STONE_COLOR = 0x8a8780;
const SKY_COLOR = 0xf6c98a;
const FOG_NEAR = 120;
const FOG_FAR = 650;
const MOUNTAIN_COUNT = 36;
const SMALL_MOUNTAIN_COUNT = 72;
const ROCK_COUNT = 140;
const FOREST_TREE_COUNT = 96;

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
  const groundColors = new Float32BufferAttribute(
    new Float32Array(positions.count * 3),
    3,
  );
  const _gcol = new Color();
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    positions.setY(i, sampleTerrainHeight(x, z));
    setBiomeGroundColor(z, _gcol);
    groundColors.setXYZ(i, _gcol.r, _gcol.g, _gcol.b);
  }
  positions.needsUpdate = true;
  geometry.setAttribute("color", groundColors);
  geometry.computeVertexNormals();

  const ground = new Mesh(
    geometry,
    new MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
  );
  ground.name = "desert-ground";
  scene.add(ground);

  addWarCampTerritoryDisks(scene, sampleTerrainHeight);

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
      new MeshLambertMaterial({
        color: biomeMountainColor(z),
        flatShading: true,
      }),
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
      new MeshLambertMaterial({
        color: biomeMountainColor(z),
        flatShading: true,
      }),
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
      new MeshLambertMaterial({ color: biomeRockColor(z) }),
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

  const trunkMat = new MeshLambertMaterial({ color: 0x5c4030 });
  const foliageMat = new MeshLambertMaterial({
    color: 0x2d6a3a,
    flatShading: true,
  });
  const zTreeMin = BIOME_RED_MIN_Z + 16;
  const zTreeMax = TERRAIN_HALF_SIZE - 22;
  for (let i = 0; i < FOREST_TREE_COUNT; i += 1) {
    const x = (hash2(i, 191) - 0.5) * (TERRAIN_HALF_SIZE * 1.85);
    const z = zTreeMin + hash2(i, 193) * (zTreeMax - zTreeMin);
    if (isNearAnySafeZoneCastle(x, z, 42)) {
      continue;
    }
    const th = 1.7 + hash2(i, 197) * 0.85;
    const fr = 1.15 + hash2(i, 199) * 0.95;
    const fh = 3.2 + hash2(i, 201) * 2.4;
    const baseY = sampleTerrainHeight(x, z);
    const trunk = new Mesh(
      new BoxGeometry(0.38, th, 0.38),
      trunkMat,
    );
    trunk.position.set(x, baseY + th / 2, z);
    scene.add(trunk);
    const layers = 2 + (hash2(i, 203) > 0.55 ? 1 : 0);
    for (let li = 0; li < layers; li += 1) {
      const ly = baseY + th + li * 1.05;
      const lr = fr * (1 - li * 0.18);
      const lh = fh * (1 - li * 0.12);
      const foliage = new Mesh(
        new ConeGeometry(lr, lh, 6),
        foliageMat,
      );
      foliage.position.set(x, ly + lh / 2, z);
      scene.add(foliage);
    }
    colliders.push({
      minX: x - 0.22,
      maxX: x + 0.22,
      minZ: z - 0.22,
      maxZ: z + 0.22,
      topY: baseY + th,
    });
  }

  // Safe spawn castles — server-side damage/aggro/spawn checks must match `isPointInSpawnSafeZone`.
  const outE = SAFE_ZONE_OUTPOST_EDGE_CENTER;
  addSpawnCastle(scene, colliders, sampleTerrainHeight);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, 0, outE);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, 0, -outE);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, -outE, outE);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, outE, outE);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, -outE, -outE);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, outE, -outE);
  addSpawnCastle(scene, colliders, sampleTerrainHeight, outE, 0);

  const flagRed = 0xcc4444;
  const flagBlue = 0x4466cc;
  const flagNeutral = 0xd8d4c8;
  addCourtyardTeamFlag(scene, sampleTerrainHeight, TEAM_RED_SAFE_ZONE_INDEX, flagRed);
  addCourtyardTeamFlag(scene, sampleTerrainHeight, TEAM_BLUE_SAFE_ZONE_INDEX, flagBlue);
  addCourtyardTeamFlag(scene, sampleTerrainHeight, TEAM_NEUTRAL_SAFE_ZONE_INDEX, flagNeutral);

  const shopWallMat = new MeshLambertMaterial({ color: 0x7a6a58 });
  const shopWallMatAdvanced = new MeshLambertMaterial({ color: 0x5c4d3e });
  const shopRoofMat = new MeshLambertMaterial({ color: 0x5a5045 });
  const shopRoofMatAdvanced = new MeshLambertMaterial({ color: 0x4a4036 });
  const shopTableMat = new MeshLambertMaterial({ color: 0x6b5540 });
  for (let si = 0; si < SHOP_SAFE_ZONE_COUNT; si += 1) {
    const c = safeZoneCenterXZ(si);
    addShopStall(
      scene,
      colliders,
      sampleTerrainHeight,
      c.x,
      c.z,
      isAdvancedShopSafeZoneIndex(si),
      shopWallMat,
      shopWallMatAdvanced,
      shopRoofMat,
      shopRoofMatAdvanced,
      shopTableMat,
    );
  }

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
/** Pole + cloth plane facing the map center — Milestone 5 team markers. */
function addCourtyardTeamFlag(
  scene: Scene,
  sampleGround: (x: number, z: number) => number,
  zoneIndex: number,
  flagColor: number,
): void {
  const c = safeZoneCenterXZ(zoneIndex);
  const cx = c.x;
  const cz = c.z;
  const baseY = sampleGround(cx, cz);
  const pole = new Mesh(
    new BoxGeometry(0.14, 2.5, 0.14),
    new MeshLambertMaterial({ color: 0x5a5248 }),
  );
  pole.position.set(cx, baseY + 1.25, cz);
  scene.add(pole);
  const cloth = new Mesh(
    new PlaneGeometry(0.88, 0.52),
    new MeshLambertMaterial({
      color: flagColor,
      side: DoubleSide,
    }),
  );
  const dx = -cx;
  const dz = -cz;
  const len = Math.hypot(dx, dz);
  const nx = len > 1e-6 ? dx / len : 0;
  const nz = len > 1e-6 ? dz / len : 1;
  cloth.position.set(cx + nx * 0.42, baseY + 2.12, cz + nz * 0.42);
  cloth.rotation.y = Math.atan2(-nx, -nz);
  scene.add(cloth);
}

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

function stallOutwardDir(
  centerX: number,
  centerZ: number,
): { fx: number; fz: number; rx: number; rz: number } {
  const h = Math.hypot(centerX, centerZ);
  let fx: number;
  let fz: number;
  if (h < 0.01) {
    fx = 0;
    fz = 1;
  } else {
    fx = centerX / h;
    fz = centerZ / h;
  }
  return { fx, fz, rx: -fz, rz: fx };
}

function pushStallObbWall(
  colliders: AABBCollider[],
  cx: number,
  cz: number,
  y0: number,
  fx: number,
  fz: number,
  rx: number,
  rz: number,
  alongFwd: number,
  alongRight: number,
  halfAlongRight: number,
  halfAlongFwd: number,
  height: number,
): void {
  const px = cx + fx * alongFwd + rx * alongRight;
  const pz = cz + fz * alongFwd + rz * alongRight;
  const corners: [number, number][] = [
    [
      px + rx * halfAlongRight + fx * halfAlongFwd,
      pz + rz * halfAlongRight + fz * halfAlongFwd,
    ],
    [
      px - rx * halfAlongRight + fx * halfAlongFwd,
      pz - rz * halfAlongRight + fz * halfAlongFwd,
    ],
    [
      px + rx * halfAlongRight - fx * halfAlongFwd,
      pz + rz * halfAlongRight - fz * halfAlongFwd,
    ],
    [
      px - rx * halfAlongRight - fx * halfAlongFwd,
      pz - rz * halfAlongRight - fz * halfAlongFwd,
    ],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  colliders.push({
    minX,
    maxX,
    minZ,
    maxZ,
    topY: y0 + height,
  });
}

function makeMerchantTitleSprite(): Sprite {
  const canvas = document.createElement("canvas");
  const w = 640;
  const h = 160;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 56px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.88)";
    ctx.lineWidth = 10;
    ctx.strokeText("Merchant", w / 2, h / 2);
    ctx.fillStyle = "#f0dca8";
    ctx.fillText("Merchant", w / 2, h / 2);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  const mat = new SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new Sprite(mat);
  sprite.scale.set(3.8, 0.95, 1);
  sprite.position.set(0, 2.42, 0);
  return sprite;
}

/**
 * Open-front stall against the outer courtyard wall: three walls + roof, counter table, humanoid NPC.
 * Local +Z = toward the map edge (wall behind the vendor). Must stay aligned with `add_shop_stall_colliders` in `server/src/world.rs`.
 */
function addShopStall(
  scene: Scene,
  colliders: AABBCollider[],
  sampleGround: (x: number, z: number) => number,
  centerX: number,
  centerZ: number,
  advanced: boolean,
  wallMat: MeshLambertMaterial,
  wallMatAdv: MeshLambertMaterial,
  roofMat: MeshLambertMaterial,
  roofMatAdv: MeshLambertMaterial,
  tableMat: MeshLambertMaterial,
): void {
  const { fx, fz, rx, rz } = stallOutwardDir(centerX, centerZ);
  const y0 = sampleGround(centerX, centerZ);
  const wMat = advanced ? wallMatAdv : wallMat;
  const rMat = advanced ? roofMatAdv : roofMat;

  const stall = new Group();
  stall.position.set(centerX, y0, centerZ);
  stall.rotation.y = Math.atan2(fx, fz);

  const back = new Mesh(
    new BoxGeometry(3.5, 2.7, 0.32),
    wMat,
  );
  back.position.set(0, 1.35, 3.88);
  stall.add(back);

  const leftWall = new Mesh(new BoxGeometry(0.3, 2.5, 1.48), wMat);
  leftWall.position.set(-1.62, 1.25, 3.1);
  stall.add(leftWall);

  const rightWall = new Mesh(new BoxGeometry(0.3, 2.5, 1.48), wMat);
  rightWall.position.set(1.62, 1.25, 3.1);
  stall.add(rightWall);

  const roof = new Mesh(new BoxGeometry(3.85, 0.22, 2.85), rMat);
  roof.position.set(0, 2.86, 3.05);
  stall.add(roof);

  const table = new Mesh(new BoxGeometry(2.2, 0.07, 0.95), tableMat);
  table.position.set(0, 0.92, 2.08);
  stall.add(table);

  const legFL = new Mesh(new BoxGeometry(0.12, 0.88, 0.12), tableMat);
  legFL.position.set(-0.95, 0.48, 1.68);
  stall.add(legFL);
  const legFR = new Mesh(new BoxGeometry(0.12, 0.88, 0.12), tableMat);
  legFR.position.set(0.95, 0.48, 1.68);
  stall.add(legFR);
  const legBL = new Mesh(new BoxGeometry(0.12, 0.88, 0.12), tableMat);
  legBL.position.set(-0.95, 0.48, 2.48);
  stall.add(legBL);
  const legBR = new Mesh(new BoxGeometry(0.12, 0.88, 0.12), tableMat);
  legBR.position.set(0.95, 0.48, 2.48);
  stall.add(legBR);

  const skin = new MeshLambertMaterial({ color: advanced ? 0xe8b898 : 0xd8a878 });
  const shirt = new MeshLambertMaterial({ color: advanced ? 0x6a7a72 : 0x5c6a62 });
  const pants = new MeshLambertMaterial({ color: 0x4a4f58 });

  const vendor = new Group();
  vendor.position.set(0, 0, 3.35);
  vendor.rotation.y = Math.PI;

  const legL = new Mesh(new BoxGeometry(0.22, 0.42, 0.24), pants);
  legL.position.set(-0.16, 0.21, 0);
  const legR = new Mesh(new BoxGeometry(0.22, 0.42, 0.24), pants);
  legR.position.set(0.16, 0.21, 0);
  const torso = new Mesh(new BoxGeometry(0.52, 0.62, 0.34), shirt);
  torso.position.set(0, 0.72, 0);
  const armL = new Mesh(new BoxGeometry(0.14, 0.48, 0.14), shirt);
  armL.position.set(-0.38, 0.72, 0.06);
  const armR = new Mesh(new BoxGeometry(0.14, 0.48, 0.14), shirt);
  armR.position.set(0.38, 0.72, 0.06);
  const head = new Mesh(new BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.set(0, 1.22, 0);

  vendor.add(legL);
  vendor.add(legR);
  vendor.add(torso);
  vendor.add(armL);
  vendor.add(armR);
  vendor.add(head);

  const title = makeMerchantTitleSprite();
  vendor.add(title);

  stall.add(vendor);
  scene.add(stall);

  pushStallObbWall(
    colliders,
    centerX,
    centerZ,
    y0,
    fx,
    fz,
    rx,
    rz,
    3.88,
    0,
    1.75,
    0.16,
    2.75,
  );
  pushStallObbWall(
    colliders,
    centerX,
    centerZ,
    y0,
    fx,
    fz,
    rx,
    rz,
    3.1,
    -1.62,
    0.15,
    0.74,
    2.55,
  );
  pushStallObbWall(
    colliders,
    centerX,
    centerZ,
    y0,
    fx,
    fz,
    rx,
    rz,
    3.1,
    1.62,
    0.15,
    0.74,
    2.55,
  );
  pushStallObbWall(
    colliders,
    centerX,
    centerZ,
    y0,
    fx,
    fz,
    rx,
    rz,
    2.08,
    0,
    1.1,
    0.475,
    0.94,
  );
}
