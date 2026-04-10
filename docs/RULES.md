# Project rules

These rules apply to every change. CI is enforced by `npm run smoke:ci` (unit
tests + production build + HTTP smoke). Rust tests: `cargo test --manifest-path server/Cargo.toml`.

## Language and types

1. **Strict TypeScript only.** `tsconfig.json` enables `strict`,
  `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`,
   `verbatimModuleSyntax`. Do not weaken these.
2. **No `any`.** Use `unknown` and narrow, or define a real type.
3. Type-only imports use `import type`.
4. Public functions and exported interfaces are explicitly typed. Inferred
  types inside function bodies are fine.

## Build and tests

1. `**npm run build` must pass** (`tsc` then `vite build`) before merging.
2. `**npm run test` must pass** (Vitest). Pure logic lives in small modules
  (`scene/terrain.ts`, `utils/math.ts`, `player/circleAabbXZ.ts`, etc.) — add
   or extend tests there when behavior changes.
3. `**npm run smoke:ci` must pass** after any substantive change. It runs unit
  tests, the production build, boots `vite preview`, and verifies `GET /`
   returns 2xx. "Substantive" means: any change to `src/`, `index.html`,
   `vite.config.ts`, `tsconfig.json`, or `package.json`.
4. **Rust `cargo test` in `server/`** must pass when `server/src/` or
  `server/Cargo.toml` changes.

## Module boundaries

1. **Scene modules expose interfaces, not meshes.** A scene builder returns
  the data gameplay needs (height function, colliders, spawn). Renderable
   `Mesh`/`Object3D` references stay private to the scene file.
2. **Player/controls modules know nothing about meshes.** They only consume
  the scene's interface. This is what lets us swap levels.
3. `**Game.ts` is the only place that wires modules together.** It does not
  contain gameplay logic.
4. **No new files in `scene/` that mix geometry and collision rules.** Put
  pure terrain math in `scene/terrain.ts` (or a sibling), and the mesh-build
    in the scene file.

## Collision

1. The ground sampler is `scene/terrain.ts` → `sampleTerrainHeight`. Do not
  add a second source of truth (no per-mesh raycasts for ground).
2. Static obstacles are `AABBCollider`s. If a feature needs rotated or
  swept colliders, **upgrade the collider type** rather than bolting on a
    parallel system. Document the change in `docs/ARCHITECTURE.md`.

## Multiplayer authority

1. The client predicts; the **server validates**. Inventory, mob HP, money,
  coordinates — anything a player would cheat — must be authoritative
    server-side. The client may keep a session token in `localStorage`, but
    the server is the source of truth.
2. Same code, both sides. Pure functions (terrain height, damage formulas,
  item math) live in modules importable by both client and server. No
    "client-only" gameplay shortcuts.

## Documentation

1. **Update `docs/TASKS.md`** when you finish a task or discover a new one.
  The task list is the project plan.
2. **Update `docs/ARCHITECTURE.md`** when you change a module boundary or
  the collision model.
3. Public interfaces get a doc comment that says *what it returns* and
  *what its limits are*. Limits are not optional — see the collision
    section in `ARCHITECTURE.md` for the format.

## Code style

1. Prefer small modules over big ones. If a file is over ~400 lines, split it.
2. No dead code, no commented-out blocks. `TODO(topic):` comments are fine
  and should reference a section in `docs/TASKS.md`.
3. No third-party physics engine, no ECS framework, no asset pipeline until
  a milestone in `docs/TASKS.md` actually requires it.
4. **Read `docs/` before you change behavior or structure.** At minimum read this
  file (`docs/RULES.md`). Read `docs/ARCHITECTURE.md` when touching scene,
    player, collision, or wiring. Use `docs/TASKS.md` for planned work and
    backlog context.
5. **Run the full test suite after any code change** (before you stop): `npm run test`
  and `cargo test --manifest-path server/Cargo.toml`. Fix failures before
    moving on.