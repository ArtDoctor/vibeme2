# Task list

The project plan. Every feature the user has described lives here, with
status and details. Update this file when you finish or discover work.

Legend: `[x] done` · `[~] in progress` · `[ ] todo`

---

## Milestone 1 — Single-player walkable desert

- [x] Vite + TypeScript + Three.js scaffold, strict tsconfig.
- [x] `Game` class owning renderer, scene, camera, animation loop, resize, dispose.
- [x] Desert scene module: sand-colored ground, hemisphere + directional light,
      sky/fog, scattered cone "mountains" (big and small), cube rocks.
- [x] Analytic heightfield (`scene/terrain.ts`) shared by render mesh and player.
- [x] First-person controls module: WASD + mouselook + jump + gravity.
- [x] AABB collision against mountains/rocks with circle-vs-box separation.
- [x] Stable resize (no NaN aspect, no canvas crash on minimise).
- [x] `npm run smoke:ci` — production build + HTTP smoke test.
- [x] Docs: ARCHITECTURE, RULES, TASKS.

## Milestone 1.5 — Safe spawn castle

- [x] **Castle spawn zone** at world origin: a ring of box walls (cubes
      stretched into wall segments) forming a small enclosure with one gate.
      All players spawn inside it. Visually distinct (stone-grey blocks vs
      sand) so it's obvious where "home" is.
- [x] **Safe zone flag** on the spawn area — no PvP damage, no mob aggro,
      no mob spawning inside. Server-enforced; the client only renders the
      hint. The castle interior bounds are a single AABB the server checks
      before applying any damage event (`src/world/spawnSafeZone.ts`).
- [x] **Gate** is open by default (no door logic in v1) — just a gap in the
      wall. Players walk out into the desert.
- [x] Castle walls reuse the existing `AABBCollider` system — no new
      collider type. Walls are tall enough that step-up doesn't pop you over
      them (taller than `MAX_STEP_UP`).
- [x] TODO note in `DesertScene.ts` pointing here when the castle is added.

## Milestone 2 — Player avatar and combat primitives

- [x] **Player model** built from 3–4 boxes (torso + head + 2 limbs). For now
      hidden in first-person; appears for other players in MP.
- [x] **Sword** model: 2 boxes (blade + crossguard). Equipped state, swing
      animation = simple rotation.
- [x] **Shield** model: 1 big box + 1 small box (grip). Blocking state reduces
      damage from frontal sources, fully blocks "heavy ranged" boss attacks.
- [x] **Bow** model: a triangle (`ConeGeometry` segmented = 3) + a thin string
      box. Charge-up + release. Spawns a small box "arrow" projectile.
- [x] Player HP, stamina, hitbox (capsule approximated as cylinder for now).
- [x] Death = full reset to spawn, drop everything, lose all gold and gear.

## Milestone 3 — Mobs

Mob AI is dumb on purpose at first: state machine of `idle / chase / attack / dead`.

- [ ] **Small mob** (3–4 boxes, like the player): wanders, aggros at ~10m,
      melees on contact, dies in 2–3 hits, drops a small amount of gold.
- [ ] **Aggro range and chained aggro**: a mob targets a player only when
      the player is within its **base aggro radius** (small mobs ~10 m, bosses
      ~25 m). However, if the player is within an **extended radius** (say
      1.8× the base) AND has already engaged a *nearby* enemy of the same
      kind (dealt damage in the last few seconds), the mob also aggros — so
      starting one fight pulls neighbours, but a player walking quietly past
      at medium range is left alone. Server-authoritative; aggro is a state
      on the mob, not on the client.
- [ ] **Safe zone respect**: mobs never path into the spawn castle and never
      aggro a player who is currently inside it. (See Milestone 1.5.)
- [ ] **Boss A — Tank**: oversized box body, very high HP, slow, ranged
      heavy attack (large slow projectile). Designed to require a shield to
      survive frontally. Spawns in a fixed arena.
- [ ] **Boss B — Summoner**: faster than Tank, lower HP, can spawn small mobs
      around itself on a cooldown. Designed to punish solo play.
- [ ] Loot tables: small mobs drop gold; bosses drop gold + a chance at a
      gear upgrade token.
- [ ] Authoritative HP and positions on the server (see Multiplayer).

## Milestone 4 — Economy and progression

- [ ] **Shops** scattered around the map. Each shop = one box building +
      one NPC box. Interact key opens a tiny inventory UI.
- [ ] **Tiered gear**: starter (free pickups in the world), basic (cheap
      shop), good (expensive shop), boss-locked (only after killing a boss).
- [ ] **Gold** is the only currency. Server-authoritative balance.
- [ ] **Permadeath**: on death, server wipes the player's inventory + gold
      and respawns them at the spawn point with starter loadout.

## Milestone 5 — Teams and PvP rules

- [ ] **Three teams**: `blue`, `red`, `neutral`. Team is chosen on first join
      and persisted in the server-side session record.
- [ ] **No teammate damage** for blue/red. Neutral can damage anyone, anyone
      can damage neutral.
- [ ] No formal "party" system. Players can group up freely; cooperation is
      emergent. Boss kill credit goes to everyone who dealt damage above a
      threshold.
- [ ] Team color visible on the player model (tinted torso box).

## Milestone 6 — Multiplayer

The big one. Approach: client predicts using the same pure modules the server
runs; server is authoritative; client keeps only a session token in
`localStorage`.

- [x] **Transport**: WebSocket to the **Rust** server (same process that serves
      the SPA). JSON messages (`server/`, `/ws`).
- [x] **Session**: join screen → nickname validation → `welcome` with session
      UUID → `localStorage` key `vibeme2.session`. Reconnect sends the same token.
      In-memory nick uniqueness for connected players; persistence across deploys
      not done yet.
- [x] **Nickname labels above players**: canvas-texture sprites above remote
      box avatars. Own avatar hidden (first-person). Team tint: still todo
      (Milestone 5).
- [ ] **Money leaderboard (top-right HUD)**: persistent panel listing the
      top N players by gold, updated from server broadcasts. Shows nickname,
      team color dot, gold amount. Visible to everyone. Server is the only
      source — client never computes ranks locally.
- [~] **State authority**: server is authoritative for **player positions**
      (validated each input). Inventory, gold, HP, mobs — still todo
      (Milestones 2–4).
- [x] **Movement validation**: Rust uses the same terrain function + collider
      list as `DesertScene` / `terrain.ts`, clamps speed, resolves AABBs, snaps
      ground (see `server/src/world.rs`, `server/src/validate.rs`).
- [~] **Tick rate**: 20 Hz snapshots over WebSocket; remote poses snap (no
      interpolation yet).
- [~] **Cheat surface**: positions derived from client-reported pose with
      server clamp + collision; no inventory/HP yet.
- [~] **Deployment**: **Dockerfile** at repo root (Node build + `cargo build`,
      runtime serves `dist/` + `/ws`). Docker Compose file still optional;
      Coolify can build/run the Dockerfile directly.

## Milestone 7 — Polish and content

- [ ] Replace cone mountains with low-poly mesh imports (still simple).
- [ ] Bigger world, multiple biomes (still desert-themed for v1).
- [ ] Sound effects (WebAudio, no external lib).
- [ ] Minimap.
- [ ] Daily reset / world events.

---

## Tooling backlog

- [x] Unit test runner (**Vitest**). Tests in `src/**/*.test.ts`: `utils/math.ts`,
      `scene/terrain.ts`, `player/circleAabbXZ.ts`. Rust: `cargo test` in `server/`
      for `world` + `validate`.
- [ ] Lint (eslint or biome). The strict tsconfig already catches a lot.
- [x] CI workflow (`.github/workflows/ci.yml`): `npm run smoke:ci` + `cargo test`.
- [ ] Bundle size budget in `vite.config.ts`.

## Out of scope (for now)

- Procedural quest generator
- Voice chat
- Mobile / touch controls
- Cosmetic customization beyond team color
