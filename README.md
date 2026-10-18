# Card Lobby

Card games with friends, right in the browser. One person creates a lobby, the others join by
link or code, everyone chats and plays. Peer to peer and encrypted, no accounts, no game server.

Games are data packs: a `pack.json` with cards and rules, plus images. Addons work like DLC and
can add, remove or change cards and rules. The first game is Power Hungry Pets.

**Status:** scaffold (milestone 0). The home and lobby screens run as an offline preview.
Networking, the rules engine and the game table are next. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. Add `?as=2` (or any name) to the URL in another tab to act as
a second player in the same browser.

Other scripts: `npm test`, `npm run check` (type-check), `npm run build` (static files in
`dist/`).

## Docs

- [docs/DESIGN.md](docs/DESIGN.md): architecture, networking, engine, disconnects, custom packs
- [docs/PACK_FORMAT.md](docs/PACK_FORMAT.md): how to write a pack or an addon
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones and what is done
- [docs/rules/power-hungry-pets.md](docs/rules/power-hungry-pets.md): rules as implemented,
  including house rules

## Credits

Power Hungry Pets is a game by Exploding Kittens. This project implements its rules for private
play among friends. The card art here is original and only loosely inspired by the game.
