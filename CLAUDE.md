# Card Lobby

Static website where friends create or join a lobby, chat, and play card games peer to peer.
Games and their addons are data packs (JSON plus images). First game: Power Hungry Pets.

Read [docs/DESIGN.md](docs/DESIGN.md) before changing architecture, and
[docs/PACK_FORMAT.md](docs/PACK_FORMAT.md) before touching packs or engine ops.
[docs/ROADMAP.md](docs/ROADMAP.md) says what is built and what is next.

## Commands

- `npm run dev` starts Vite on http://localhost:5173
- `npm run check` type-checks
- `npm test` runs Vitest once
- `npm run build` type-checks and builds static files into `dist/`

## Stack rules

- TypeScript, HTML and CSS only. No UI framework.
- Runtime dependencies: Trystero only. Ask before adding another.
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
- Rules decisions for Power Hungry Pets live in
  [docs/rules/power-hungry-pets.md](docs/rules/power-hungry-pets.md). Change that file
  together with the pack.

## Layout

- `src/net` join codes, protocol types, `Transport` interface. Trystero and BroadcastChannel
  transports come in milestone 1
- `src/session` host and client sessions (milestone 1, not created yet)
- `src/engine` state and input types so far. Interpreter, ops and views come in milestone 2
- `src/packs` pack types, loading, counts, addon merging
- `src/ui` DOM helper, router, components, screens
- `src/identity.ts` local player id, name, color, host marker
- `src/styles` design tokens (light and dark) and app styles
- `public/packs` built-in packs, one folder each, listed in `public/packs/index.json`

## Testing locally

Open several tabs. `?as=2` (or any slot name) gives a tab its own player identity, so one
browser can act as several players. Tests sit next to the code as `*.test.ts`.
