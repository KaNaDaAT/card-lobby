# Card Lobby

Card games with friends, right in the browser. One person creates a lobby, the others join by
link or code, everyone chats and plays. Peer to peer and encrypted, no accounts, no game server.

Games are data packs: a `pack.json` with cards and rules, plus images. Addons work like DLC and
can add, remove or change cards and rules. Two games ship with it: Power Hungry Pets and
Exploding Kittens.

**Status:** playable and deployable (milestones 1 to 7). Create a lobby, invite friends, chat,
and play full games of Power Hungry Pets or Exploding Kittens (combos and a timed Nope window
included), with rematches, reconnects and host reloads mid-game. Hosts can upload their own
packs as a .zip, and players accept them before they download. Each player can switch the
table between the classic layout and a round table. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. Rooms connect over WebRTC by default, so friends on other
machines can join by link or code.

To try it alone in one browser, use local mode, which links tabs with `BroadcastChannel` and
needs no network:

1. Open http://localhost:5173/?transport=local and create a lobby.
2. Copy the link (it keeps local mode) and open it in another tab with `&as=2` added, so that
   tab is a second player. `&as=3` for a third, and so on.

Other scripts: `npm test` (unit tests plus 1100 simulated games; `SIM_GAMES=5000 npm test` for
more), `npm run e2e` (browser tests against the production build; run
`npx playwright install chromium` once first), `npm run check` (type-check), `npm run build`
(static files in `dist/`).

## Deploy

`dist/` is plain static files, so any static host works. The repository includes a GitHub
Actions workflow that tests, builds and publishes to GitHub Pages on every push to `main`.
Turn it on once under Settings > Pages > Source: GitHub Actions.

Players behind strict networks (some offices and mobile carriers) may need a TURN server. Set
`VITE_TURN_URLS`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL` when building (locally in
`.env.local`, see `.env.example`; for the Pages workflow as repository variables `TURN_URLS`,
`TURN_USERNAME` and the secret `TURN_CREDENTIAL`). They end up in the public JavaScript, so use
an account meant for your group.

## Make your own pack

Copy `public/packs/power-hungry-pets` (or `exploding-kittens` for a draw-and-react game),
change `pack.json` and the art, zip the folder, and pick the zip with the Custom pack tile in
the lobby. The lobby lists any problems with their file and path. [docs/PACK_FORMAT.md](docs/PACK_FORMAT.md) describes every field and op.

`npm run zip-pack -- <folder>` zips a pack folder the way the lobby expects. To try it, zip the
example in `examples/packs/power-hungry-pets-wild`: Power Hungry Pets with two house addons,
Off the Scale (a -1 that turns the round upside down and an ∞ that calls the showdown) and
Second Litter (a new pet for each number from 1 to 8). Its rules are in
[docs/rules/power-hungry-pets-wild.md](docs/rules/power-hungry-pets-wild.md).

## Docs

- [docs/DESIGN.md](docs/DESIGN.md): architecture, networking, engine, disconnects, custom packs
- [docs/PACK_FORMAT.md](docs/PACK_FORMAT.md): how to write a pack or an addon
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones and what is done
- [docs/rules/power-hungry-pets.md](docs/rules/power-hungry-pets.md) and
  [docs/rules/exploding-kittens.md](docs/rules/exploding-kittens.md): rules as implemented,
  including house rules

## Credits

Power Hungry Pets and Exploding Kittens are games by Exploding Kittens. This project
implements their rules for private play among friends. The card art here is original and only
loosely inspired by the games.
