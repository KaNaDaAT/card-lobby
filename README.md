# Card Lobby

Card games with friends, right in the browser. One person creates a lobby, the others join by
link or code, everyone chats and plays. Peer to peer and encrypted, no accounts, no game server.

Games are data packs: a `pack.json` with cards and rules, plus images. Addons work like DLC and
can add, remove or change cards and rules. The first game is Power Hungry Pets.

**Status:** playable (milestones 1 to 4). Create a lobby, invite friends, chat, and play full
games of Power Hungry Pets, with rematches, reconnects and host reloads mid-game. Custom packs,
phone drawers, TURN and deployment are next. See [docs/ROADMAP.md](docs/ROADMAP.md).

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

Other scripts: `npm test` (unit tests plus 750 simulated games; `SIM_GAMES=5000 npm test` for
more), `npm run check` (type-check), `npm run build` (static files in `dist/`).

## Docs

- [docs/DESIGN.md](docs/DESIGN.md): architecture, networking, engine, disconnects, custom packs
- [docs/PACK_FORMAT.md](docs/PACK_FORMAT.md): how to write a pack or an addon
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones and what is done
- [docs/rules/power-hungry-pets.md](docs/rules/power-hungry-pets.md): rules as implemented,
  including house rules

## Credits

Power Hungry Pets is a game by Exploding Kittens. This project implements its rules for private
play among friends. The card art here is original and only loosely inspired by the game.
