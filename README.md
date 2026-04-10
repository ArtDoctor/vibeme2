# vibeme2

Browser multiplayer 3D game — knight free-world simulator. **Milestone 1**:
single-player desert with first-person controls, simple terrain following,
basic AABB collision against scattered mountains and rocks.

Long-term vision and feature backlog live in [`docs/TASKS.md`](docs/TASKS.md).
Architecture and collision-model limits are documented in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Contribution rules are in
[`docs/RULES.md`](docs/RULES.md) — read those before opening a PR.

## Quick start

```bash
npm install
npm run dev          # Rust on :8080 + Vite on :5173 (Vite proxies /ws → server)
npm run test         # Vitest (unit tests)
npm run build        # tsc + vite build
npm run smoke:ci     # test + build + vite preview + GET / smoke test
npm run server       # cargo run — serves dist/ + WebSocket (after npm run build)
```

Rust tests: `cargo test --manifest-path server/Cargo.toml`

Click the canvas to lock the mouse. **WASD** to move, **Space** to jump,
**Esc** to release the mouse.

## Stack

- [Vite 6](https://vitejs.dev/) — dev server + bundler
- [TypeScript 5.7](https://www.typescriptlang.org/) — `strict`, `noUnusedLocals`,
  `noUnusedParameters`, `verbatimModuleSyntax`
- [three.js 0.172](https://threejs.org/) — rendering, math, `PointerLockControls`

No physics engine, no ECS, no asset pipeline. Everything is procedural cubes
and cones until gameplay actually demands more.
