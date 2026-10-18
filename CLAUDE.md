# Card Lobby

Static website where friends create or join a lobby, chat, and play card games peer to peer.
Games and their addons are data packs (JSON plus images). Games: Power Hungry Pets and
Exploding Kittens.

Read [docs/DESIGN.md](docs/DESIGN.md) before changing architecture, and
[docs/PACK_FORMAT.md](docs/PACK_FORMAT.md) before touching packs or engine ops.
[docs/ROADMAP.md](docs/ROADMAP.md) says what is built and what is next.

## Commands

- `npm run dev` starts Vite on http://localhost:5173
- `npm run check` type-checks
- `npm test` runs Vitest once, including 1100 simulated games (`SIM_GAMES=5000 npm test` for more)
- `npm run build` type-checks and builds static files into `dist/`
- `npm run e2e` runs the Playwright browser tests in `e2e/` against the production build
  (`npx playwright install chromium` once per machine)
- `npm run zip-pack -- <folder>` zips a pack folder for the lobby's Custom pack tile

## Stack rules

- TypeScript, HTML and CSS only. No UI framework.
- Runtime dependencies: Trystero only. Ask before adding another. Dev tools: Vite, Vitest,
  TypeScript and Playwright (pinned, it must match its browser build).
- No server code. Everything must work as static files.

## Architecture in one paragraph

The lobby creator is the host and is authoritative. Clients send intents, the host validates
them, runs the engine, and sends each player a personal view (a full snapshot of what that
seat may see). Chat goes through the host too. The engine in `src/engine` is pure: no DOM, no
network, no clock, seeded RNG, plain-JSON state. Only the host runs it.

## Invariants (do not break)

- Never put untrusted text into the DOM as HTML. Player names, chat and pack text go through
  `h()` from `src/ui/dom.ts`, which uses text nodes. No `innerHTML` with dynamic content.
- Pack images render only through `<img>`, never inlined SVG.
- Packs are data only. Ops are a fixed list implemented in `src/engine/ops`. A pack that uses
  an unknown op is rejected with a clear error, never partially run.
- Engine state stays JSON-serializable, so the host can save and resume at any point,
  including mid-effect while waiting for a prompt.
- `viewFor(state, seat)` must never include a hidden card the seat does not know.
  Simulation tests assert this.
- Rules decisions for each game live in `docs/rules/`:
  [power-hungry-pets.md](docs/rules/power-hungry-pets.md),
  [exploding-kittens.md](docs/rules/exploding-kittens.md) and
  [power-hungry-pets-wild.md](docs/rules/power-hungry-pets-wild.md) (the example custom pack's
  house addons). Change the file together with its pack.
- Reaction windows are timed by the host's clock only. The engine gets `now` with inputs and
  never reads a clock itself.

## Layout

- `src/net` join codes, protocol types, `Transport` interface, and three transports: Trystero
  (`trystero.ts`, loaded on demand), BroadcastChannel (`local.ts`, `?transport=local`) and an
  in-memory network for tests (`memory.ts`)
- `src/session` `HostSession` (members, lobby, chat, runs the engine, saves a snapshot) and
  `ClientSession` (hello, host lock, latest view). `lobby.ts` holds lobby rules both share
- `src/engine` the pure rules engine: `index.ts` is the API (`startGame`, `apply`, `viewFor`,
  `checkSetup`), `interpreter.ts` runs frames, `ops/` is the fixed op list, `round.ts` rounds,
  turns, showdown and scoring, `view.ts` per-seat views, `testing.ts` and `simulate.ts` test
  harnesses
- `src/packs` pack types, loading, counts, addon merging, validation, and custom packs: `zip.ts`
  (minimal reader), `custom.ts` (import a zip, blob URLs, SHA-256), `cache.ts` (IndexedDB by
  hash, per `?as=` slot), `loader.ts` (cache first, then a checked download)
- `src/ui` DOM helper, router, components, screens
- `src/identity.ts` local player id, name, color, host marker
- `src/styles` design tokens (light and dark) and app styles
- `e2e` browser tests (`*.e2e.ts`), several local-mode tabs acting as players
- `.github/workflows` CI on pull requests, GitHub Pages deploy on `main`
- `public/packs` built-in packs, one folder each, listed in `public/packs/index.json`
- `examples/packs` packs to upload as a zip, not built in. `power-hungry-pets-wild` copies
  Power Hungry Pets (a test keeps the copy in step) and adds two house addons
- `scripts/zip-pack.mjs` zips a pack folder, no dependencies

## Testing locally

Open several tabs with `?transport=local` (no network needed). `?as=2` (or any slot name)
gives a tab its own player identity, so one browser can act as several players. Tests sit next
to the code as `*.test.ts`. Engine rules tests use `Table` from `src/engine/testing.ts`, which
rigs hands and the deck by swapping card identities.
