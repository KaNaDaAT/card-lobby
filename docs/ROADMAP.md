# Roadmap

Each milestone ends with something you can try in the browser. Check items off as they land.

## M0: Scaffold (done)

- [x] Vite, TypeScript, Vitest, Trystero installed
- [x] CLAUDE.md, design, pack format, Power Hungry Pets rules
- [x] Pack data for Power Hungry Pets and the Big Litter addon
- [x] Card art for all 11 cards, card back, cover and addon image (simple SVG)
- [x] Basic layout: home screen and lobby screen (offline preview, no networking yet)
- [x] Type definitions for packs, engine state and protocol
- [x] Join codes with tests
- [x] Addon merging and requires/conflicts checks with tests (pulled forward from M2)

## M1: Connect

Goal: two tabs (and then two machines) see each other in the same lobby and can chat.

- [ ] `src/net/local.ts`: Transport over `BroadcastChannel`, enabled with `?transport=local`.
  Lets several tabs talk without internet. Use it for all early testing.
- [ ] `src/net/trystero.ts`: Transport over Trystero. `joinRoom({ appId, password: code }, code)`,
  one action per protocol message, `onPeerJoin` and `onPeerLeave`.
- [ ] `src/session/host.ts`: seats keyed by `playerId`, lobby settings, chat history (500),
  sends each player a `view` after every change, persists to localStorage.
- [ ] `src/session/client.ts`: sends `hello`, locks onto the host (see DESIGN.md), keeps the
  latest view by `seq`, sends intents.
- [ ] Lobby screen reads from the session instead of local state.
- [ ] Join by link and by code. Copy-link button.
- [ ] Reload as host resumes the lobby. Reload as player gets the seat back.

How: write the session against the `Transport` interface first and test it with two
in-memory transports in Vitest, then plug in BroadcastChannel and Trystero.

## M2: Engine and Power Hungry Pets rules

Goal: a full game of Power Hungry Pets runs headless in a test.

- [x] `src/packs/merge.ts`: apply addons in pack order. Unit tests for add, remove, modify,
  rules deep merge, requires and conflicts.
- [ ] `src/packs/validate.ts`: the checks listed in PACK_FORMAT.md, with readable paths.
- [ ] `src/engine/rng.ts`: small seeded PRNG (sfc32 or xoshiro128**), state stored as numbers.
- [ ] `src/engine/interpreter.ts`: frames, prompts, effect abort, round-end checks after every op.
- [ ] `src/engine/ops/*.ts`: one file per op group. Only the ops marked M2.
- [ ] Showdown with `showdownValue`, tie-break option, `stillTied: allWin`.
- [ ] Scoring: tokens, target fixed at start, deciding round.
- [ ] `src/engine/view.ts`: `viewFor(state, seat)` with knowledge tracking.
- [ ] `src/engine/sim.test.ts`: thousands of seeded random games. Invariants: card count
  constant, no card in two zones, every game ends, no view leaks a hidden card.

How: write the op unit tests from the card texts in `docs/rules/power-hungry-pets.md`, one
test per card at least. Build the simulation early, it finds most bugs.

## M3: Table UI and art

Goal: play a full game with friends in tabs.

- [ ] Table screen from the game view: opponents, deck count, set-aside, played rows, hand.
- [ ] Prompt bar for each prompt kind: choose player, guess, position, confirm, play.
- [ ] Log panel next to chat. Private entries styled differently.
- [ ] Round end and game end overlays. Rematch.
- [ ] CSS animations: deal, play, flip, swap. Respect `prefers-reduced-motion`.
- [x] Card art: one simple SVG per card, in the style of `art/cover.svg`, 500 x 700.
- [ ] Larger card view on hover or tap, with the rules text.
- [ ] Warn before playing the King Cat.

## M4: Disconnects and resume

- [ ] Pause when the active player is away. "Waiting for X" banner.
- [ ] Host action: kick for the round.
- [ ] Sitting out a round when away at round start.
- [ ] Host reload mid-game resumes from saved state, including mid-prompt.
- [ ] Assign an empty seat to a new device.

## M5: Custom packs

- [ ] Zip import on the host (pick a small zip reader, or write a minimal one for stored and
  deflate entries with `DecompressionStream`).
- [ ] SHA-256 hash, IndexedDB cache by hash.
- [ ] `packOffer`, consent card, `packReply`, `packData` with progress.
- [ ] Size and type limits, enforced in Trystero `onReceive` and after unzip.
- [ ] Spectator role for players who declined.

## M6: Polish and deploy

- [ ] Phone layout: chat and log become drawers.
- [ ] TURN config (Trystero `turnConfig`).
- [ ] Deploy `dist/` to GitHub Pages or Cloudflare Pages.
- [ ] Protocol version check with an "update your page" view.

## M7: Exploding Kittens (future work)

- [ ] Paper test: write the base deck in the pack format before building anything. Every card
  that cannot be written down shows a gap in the format.
- [ ] Ops: `endTurn`, `addTurns`, `reverse`, `chooseCard`, `nameCard`, `take`, `cancel`,
  `reorder`, `onDraw` hook.
- [ ] Multi-card plays and combos.
- [ ] Reaction window with deadline (Nope), always full length.
