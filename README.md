# Card Lobby

> **About this project.** Card Lobby is a test project, made to play card games with friends.
> Anyone is welcome to use it, host it or build on it. It was created almost entirely with AI
> (Claude Code): the code, the docs, the card art and the house rules. People looked at it and
> played it, but nobody reviewed every line, so expect rough edges and read the code before
> you rely on it for anything beyond a game night.

Card games with friends, right in the browser. One person creates a lobby, the others join by
link or code, everyone chats and plays. Peer to peer and encrypted, no accounts, no game server.

Games are data packs: a `pack.json` with cards and rules, plus images. Addons work like DLC and
can add, remove or change cards and rules. Two games ship with it: Power Hungry Pets (with three
addons: Big Litter, Off the Scale and Second Litter) and Exploding Kittens.

**Status:** playable and deployable (milestones 1 to 7). Create a lobby, invite friends, chat,
and play full games of Power Hungry Pets or Exploding Kittens (combos and a timed Nope window
included), with rematches, reconnects and host reloads mid-game. Hosts can upload their own
packs or addons as a .zip, and players accept them before they download. Each player can switch the
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

Packs are JSON and images, no code. A zip is either a whole game (`pack.json`) or an addon for
a game the lobby has (`addon.json` that names the game in `extends`). Pick it with the Custom
pack tile in the lobby; the lobby lists any problems with their file and path.

**[docs/TUTORIAL.md](docs/TUTORIAL.md)** walks you through it: your first addon, changing cards
and rules, and a whole new game. Its worked examples are the two house addons that ship with
Power Hungry Pets, Off the Scale (a -1 that turns the round upside down and an ∞ that calls
last call) and Second Litter (a new pet for each number from 1 to 8), and its hands-on example
is in [examples/my-first-addon](examples/my-first-addon). `npm run zip-pack -- <folder>` zips
a game or addon folder the way the lobby expects. [docs/PACK_FORMAT.md](docs/PACK_FORMAT.md)
lists every field and op.

## Docs

- [docs/TUTORIAL.md](docs/TUTORIAL.md): make your own addon or game, step by step
- [docs/DESIGN.md](docs/DESIGN.md): architecture, networking, engine, disconnects, custom packs
- [docs/PACK_FORMAT.md](docs/PACK_FORMAT.md): every field, op and condition of a pack or addon
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones and what is done
- [docs/rules/power-hungry-pets.md](docs/rules/power-hungry-pets.md) and
  [docs/rules/exploding-kittens.md](docs/rules/exploding-kittens.md): rules as implemented,
  including house rules

## License and credits

The code, docs and art in this repository are under the [MIT license](LICENSE): use them as
you like.

Power Hungry Pets and Exploding Kittens are games by Exploding Kittens, and their names belong
to them. This project is not affiliated with or endorsed by Exploding Kittens. It implements
their rules for play among friends; if you enjoy them, buy the real games. The card art here
is original (generated for this project) and only loosely inspired by the games.
