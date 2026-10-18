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

## M1: Connect (done)

Goal: two tabs (and then two machines) see each other in the same lobby and can chat.

- [x] `src/net/local.ts`: Transport over `BroadcastChannel`, enabled with `?transport=local`.
  Lets several tabs talk without internet. Use it for all early testing.
- [x] `src/net/trystero.ts`: Transport over Trystero. `joinRoom({ appId, password: code }, code)`,
  one action per protocol message, `onPeerJoin` and `onPeerLeave`.
- [x] `src/session/host.ts`: seats keyed by `playerId`, lobby settings, chat history (500),
  sends each player a `view` after every change, persists to localStorage.
- [x] `src/session/client.ts`: sends `hello`, locks onto the host (see DESIGN.md), keeps the
  latest view by `seq`, sends intents.
- [x] Lobby screen reads from the session instead of local state.
- [x] Join by link and by code. Copy-link button.
- [x] Reload as host resumes the lobby. Reload as player gets the seat back.

How: write the session against the `Transport` interface first and test it with two
in-memory transports in Vitest, then plug in BroadcastChannel and Trystero.

Not yet tried: a real game over Trystero between two machines (the sandbox this was built in
has no route to Nostr relays). Local mode is tested in a real browser.

## M2: Engine and Power Hungry Pets rules (done)

Goal: a full game of Power Hungry Pets runs headless in a test.

- [x] `src/packs/merge.ts`: apply addons in pack order. Unit tests for add, remove, modify,
  rules deep merge, requires and conflicts.
- [x] `src/packs/validate.ts`: the checks listed in PACK_FORMAT.md, with readable paths.
- [x] `src/engine/rng.ts`: small seeded PRNG (sfc32 or xoshiro128**), state stored as numbers.
- [x] `src/engine/interpreter.ts`: frames, prompts, effect abort, round-end checks after every op.
- [x] `src/engine/ops/*.ts`: one file per op group. Only the ops marked M2.
- [x] Showdown with `showdownValue`, tie-break option, `stillTied: allWin`.
- [x] Scoring: tokens, target fixed at start, deciding round.
- [x] `src/engine/view.ts`: `viewFor(state, seat)` with knowledge tracking.
- [x] `src/engine/sim.test.ts`: thousands of seeded random games. Invariants: card count
  constant, no card in two zones, every game ends, no view leaks a hidden card.

How: write the op unit tests from the card texts in `docs/rules/power-hungry-pets.md`, one
test per card at least. Build the simulation early, it finds most bugs.

Done as `src/engine/rules.test.ts` (card by card) and `sim.test.ts` / `sim-litter.test.ts`
(950 random games per `npm test` across the three sim files, with kicks and dropped connections; `SIM_GAMES=5000 npm test`
for a deeper run). The host session runs the engine too: start, answers, next round, rematch,
back to lobby, kick for the round, hand a seat to a new device, resume mid-prompt after reload.

## M3: Table UI and art (done)

Goal: play a full game with friends in tabs.

- [x] Table screen from the game view: opponents, deck count, set-aside, played rows, hand.
- [x] Prompt bar for each prompt kind: choose player, guess, position, confirm, play.
- [x] Log panel next to chat. Private entries styled differently.
- [x] Round end and game end overlays. Rematch.
- [x] CSS animations: deal, play, flip, swap. Respect `prefers-reduced-motion`. (One arrival
  animation for every card that appears, changes hands or is revealed.)
- [x] Card art: one simple SVG per card, in the style of `art/cover.svg`, 500 x 700.
- [x] Larger card view on hover or tap, with the rules text.
- [x] Warn before playing the King Cat. (Any card whose `onDiscard` knocks out its holder.)

## M4: Disconnects and resume (done)

- [x] Pause when the active player is away. "Waiting for X" banner.
- [x] Host action: kick for the round.
- [x] Sitting out a round when away at round start.
- [x] Host reload mid-game resumes from saved state, including mid-prompt.
- [x] Assign an empty seat to a new device.

## M5: Custom packs (done)

- [x] Zip import on the host (pick a small zip reader, or write a minimal one for stored and
  deflate entries with `DecompressionStream`). Own reader in `src/packs/zip.ts`.
- [x] SHA-256 hash, IndexedDB cache by hash.
- [x] `packOffer`, consent card, `packReply`, `packData` with progress.
- [x] Size and type limits, enforced in Trystero `onReceive` and after unzip.
- [x] Spectator role for players who declined.

## M6: Polish and deploy (done, deploy needs Pages turned on)

- [x] Phone layout: chat and log become drawers.
- [x] TURN config (Trystero `turnConfig`), from `VITE_TURN_*` build settings.
- [x] Deploy `dist/` to GitHub Pages or Cloudflare Pages. `.github/workflows/deploy.yml`
  publishes on every push to `main` once Settings > Pages > Source is set to GitHub Actions.
- [x] Browser tests (`npm run e2e`, Playwright) for the lobby, a whole game, custom packs and
  the phone drawers, run in CI on pull requests.
- [x] Protocol version check with an "update your page" view.

## M7: Exploding Kittens (done, base game)

- [x] Paper test: write the base deck in the pack format before building anything. Every card
  that cannot be written down shows a gap in the format. (The gaps became `onDraw`, `onReact`,
  `comboOnly`, `rules.combos`, `rules.reactions`, the `handHas` condition, and `buildDeck`
  `only`/`except` for the Defuse and kitten setup.)
- [x] Ops: `endTurn`, `addTurns`, `chooseCard`, `nameCard`, `take`, `cancel`, `onDraw` hook.
  `reverse` and `reorder` wait for the expansions that need them (Reverse, Alter the Future).
- [x] Multi-card plays and combos (pair, three of a kind, five different).
- [x] Reaction window with deadline (Nope), always full length. The host times it; each
  reaction restarts it; a host reload mid-window resumes it.
- [x] Table UI: pick several cards for a combo, the window banner with its timer bar and a
  Nope button, cards to pick from (Favor, five different), compact piles for big hands.

Done as `src/engine/kittens.test.ts` (card by card and combo by combo), `sim-kittens.test.ts`
(random games for 2 to 5 players with combos and random Nopes), `src/session/reactions.test.ts`
(timers through the host session) and `e2e/kittens.e2e.ts`.

Next: expansion cards (Reverse, Alter the Future, Draw from the Bottom) as an addon, once
someone wants them.

## M8: Example custom pack and table view

- [x] Addon zips: a zip is a game or an addon for a game the lobby has. Uploaded addons join
  their game, are offered to players with the game in one consent card, and come back from the
  cache. Protocol version 3.
- [x] Two house addons for Power Hungry Pets, now built in: Off the Scale (-1 and ∞) and
  Second Litter (a new pet for 1 to 8).
- [x] A tutorial for making packs ([TUTORIAL.md](TUTORIAL.md)), with a hands-on example addon
  in `examples/my-first-addon`. `npm run zip-pack` zips game and addon folders.
- [x] Format additions they needed: `valueLabel`, round `flags` with the `flag` op and
  condition, `showdown.lowestWins`, a showdown called early from a card, `passHands`, and
  `except` for choosing players.
- [x] Optional round-table view: players seated around a table in turn order, an arrow and a
  glow on whoever has to act, players in a tab beside the log. Classic stays the default.
