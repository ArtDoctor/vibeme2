# Architecture

## Module layout

```
src/
  main.ts                       Thin entry. Finds canvas, constructs Game, wires HMR.
  game/
    Game.ts                     Owns renderer, scene, camera, loop, resize, dispose.
                                Wires modules together; never contains gameplay.
  scene/
    DesertScene.ts              Builds terrain mesh, lighting, mountains, rocks.
                                Returns ONLY what gameplay needs (height function,
                                colliders, spawn, world bounds). Renderable meshes
                                stay private to this file.
    terrain.ts                  Pure analytic heightfield function. Shared by the
                                render mesh AND the player ground sampler so they
                                cannot drift out of sync.
  player/
    FirstPersonControls.ts      Input + kinematic movement + collision resolution.
    PlayerState.ts              Plain interface — will be mirrored server-side.
  utils/
    math.ts                     `clamp`, `hash2`. No business logic.
```

### Why this split

The instruction was: don't put collision rules and level geometry in the same
giant file. So:

- `DesertScene.ts` knows nothing about the player. It builds meshes and emits
  a `DesertWorld` interface (`sampleGroundHeight`, `colliders`, `spawn`,
  `worldHalfSize`).
- `FirstPersonControls.ts` knows nothing about meshes. It only consumes the
  `DesertWorld` interface. Swap the desert for a forest by writing a new
  `buildForestScene` that returns the same shape — controls don't change.
- `Game.ts` is the only place that imports both sides. It is the wiring layer.

New systems (mobs, networking, UI overlays) follow the same shape: a builder
function that returns an interface, and a register call from `Game.ts`.

## Deployment (planned)

Production is meant to run from **Docker Compose**: one stack you can point
Coolify (or any host) at, instead of juggling separate frontend-only and
backend-only deploys by default.

The **server is a Rust binary** that:

- Serves the built **Vite frontend** (`dist/` assets: `index.html`, hashed JS/CSS,
  `public/` copies) from the same process that handles **all server concerns** —
  WebSockets, REST (if any), auth/session, authoritative game simulation, and
  persistence. No separate Nginx-only container required for the happy path;
  the Rust app is the single HTTP entry (Compose still maps **expose 80** →
  container port as usual).

- Exposes **endpoints for all server-side behavior** (multiplayer sync, economy,
  combat validation, etc.). The browser client keeps only **session state**
  (e.g. token) and talks to this server; it never is the source of truth for
  world or inventory.

The **frontend** continues to be developed and built with Vite locally (`npm run
build`); the Rust server embeds or serves that output in production. Exact crate
layout (e.g. `server/` next to `src/`) is left to implementation.

## Collision model

vibeme (the previous prototype) used a `Raycaster` straight down for ground
height plus `Box3` AABBs for walls, with circle-vs-box separation in XZ. We
use a deliberately **different** approach here, with the limits documented:

### Ground — analytic heightfield

`scene/terrain.ts` exports `sampleTerrainHeight(x, z): number`. Both the
render mesh and the player query it.

- ✅ Cheap (a few sin/cos), deterministic, no allocation, can never tunnel.
- ✅ Identical across client and (future) server — same function, same answer.
- ❌ **Heightfield only.** No caves, no overhangs, no second floors. The
  function returns one Y per (X, Z).
- ❌ Step-up tolerance is fixed at `MAX_STEP_UP = 0.6 m`. Sharper cliffs are
  walls, not ramps.

If we ever need overhangs, this becomes a swept-volume test against real
geometry, which is a much bigger change. Don't bolt a raycast onto this
function — write the new system properly.

### Obstacles — axis-aligned bounding boxes

`DesertScene` exports an `AABBCollider` per mountain/rock. The player resolves
penetration with circle-vs-box separation in XZ, four iterations per frame.

- ✅ No rotation, no matrix work each frame — colliders are precomputed at
  scene build time.
- ✅ The four-iteration sub-step is enough to escape multi-box overlaps at
  normal walking speeds.
- ❌ **No rotated boxes.** If a future asset needs an angled wall, build it
  as several axis-aligned boxes or upgrade the collider type.
- ❌ **No vertical collision against AABBs.** We treat them as walls only;
  if `feetY > collider.topY` we ignore them (you walk over short rocks).
  Boxes that should act like ceilings are not supported yet.
- ❌ **Fast teleports can skip through.** Normal walk speed is fine; a future
  dash/blink ability needs a swept test or server reconciliation.

### Server reconciliation (future)

For multiplayer, the client will keep doing exactly this — predicted movement
with the same heightfield + AABB resolver. The **server** will run the same
code with the same world data and reject positions that drift past a tolerance.
Because the heightfield is a pure function and colliders are static, both
sides agree by construction. See `docs/TASKS.md` → Multiplayer.

## Lifecycle

`Game` owns one `requestAnimationFrame` loop, one resize listener, one set of
DOM event listeners (via `FirstPersonControls`). `dispose()` tears all of them
down. `main.ts` calls `dispose()` from a Vite HMR hook so dev reloads do not
stack up WebGL contexts.

`handleResize()` clamps `innerWidth/innerHeight` to `>= 1` so a minimised
window cannot produce a `0`-aspect camera and crash.
