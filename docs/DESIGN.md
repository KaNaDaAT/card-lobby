# Design

## Goals

- Friends open one static website, create or join a lobby, chat, and play card games.
- Games are data packs (JSON plus images). Addons are optional DLC that add, remove or change
  cards and rules.
- Peer to peer and encrypted. No game server.
- First game: Power Hungry Pets. Exploding Kittens is the design check that keeps the engine
  general enough for future packs.

## Non-goals (for now)

- Cheat-proof play. The host's browser holds the deck and could cheat with devtools. This is
  for friends.
- Voice or video.
- A public lobby browser. Rooms are joined by link or code.
- Host migration. If the host leaves for good, the game ends.

## Stack

- TypeScript (strict), HTML, CSS. No UI framework.
- Vite for dev server and build. Vitest for tests.
- Trystero for WebRTC. Default strategy is Nostr, so no signaling server of our own.
- Output is static files. Host on GitHub Pages, Cloudflare Pages or anything similar.

## Layers

| Layer | Folder | Runs on | Job |
|---|---|---|---|
| Transport | `src/net` | everyone | Trystero room wrapper, plus a BroadcastChannel transport for local dev |
| Session | `src/session` | host or client | Host: seats, lobby settings, chat history, pack offers, engine state, saving. Client: send intents, keep latest view |
| Engine | `src/engine` | host only | Pure rules: `start`, `apply(state, input)`, `viewFor(state, seat)` |
| Packs | `src/packs` | everyone | Load, validate, merge addons, resolve counts |
| UI | `src/ui` | everyone | Screens drawn from the latest view |

## Host-authoritative model

- The lobby creator is the host.
- Clients send intents ("select this pack", "play this card", "I choose Tom").
- The host validates each intent, applies it, and sends every player a personal view.
- A view is a full snapshot of what that seat may see. It is small (a few hundred bytes to a
  few KB), so sending the whole thing on every change is simpler than diffs.
- Every view carries a `seq`. Clients drop views older than the one they have.
- Chat goes through the host. The host keeps the last 500 messages and sends them on join.
  Slow mode (2 seconds by default, the host picks 0 to 60) drops a player's message that
  comes too soon and tells only them. The host is exempt, and can clear the chat for
  everyone. Players can clear it on their own screen.
- Clients never run game rules. They only draw views and answer prompts.

## Rooms, codes and encryption

- A join code is 8 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0, 1, I or O),
  shown as `ABCD-EFGH`. That is 40 bits.
- Room URL: `https://<site>/#/r/ABCDEFGH`. The part after `#` is never sent to any server.
- Join: `joinRoom({ appId: 'card-lobby', password: code }, code)`.
  - The password makes Trystero encrypt the signaling messages (AES-GCM). A relay that does
    not know the code cannot read them or swap keys.
  - The data channels themselves are always DTLS encrypted, end to end.
- Tradeoff: the code is also the key. 40 bits is fine against guessing by strangers. It is not
  meant to stop a determined attacker who runs a relay. Acceptable for friends.
- TURN: some networks block direct connections. Set `VITE_TURN_URLS` (and username and
  credential) at build time and they go into Trystero's `turnConfig`. `VITE_NOSTR_RELAYS`
  replaces the default relays. See `.env.example`. One free TURN account is enough for a friend
  group. These values end up in the public JavaScript.

## Identity, host lock and reconnects

- `playerId`: random, stored in localStorage together with name and color.
- `?as=<slot>` uses a separate identity slot, so several tabs in one browser can be different
  players during development.
- On joining, a client sends `hello` to every peer. Non-hosts ignore it.
- Only the host sends `view`. A client locks onto the first peer that sends a view for this
  room and ignores views from anyone else. If the host reconnects with a new Trystero peer id,
  the client accepts it when the view's `hostPlayerId` matches the locked one.
- The host maps `playerId` to a seat. Reconnecting with the same `playerId` gives the seat
  back. If two connections share a `playerId`, the newest wins.
- The host can assign an empty seat to a new `playerId` (someone switched device).
- The creator stores `host:<code>` and the saved session in localStorage. Opening the room URL
  again in that browser resumes as host.

## Protocol

Trystero actions. Payload types live in `src/net/protocol.ts`.

| Action | Direction | Payload |
|---|---|---|
| `hello` | client to host | protocol version, playerId, name, color, cached pack hashes |
| `view` | host to client | seq, hostPlayerId, lobby view, game view or null |
| `say` | client to host | chat text, at most 500 characters |
| `chat` | host to client | chat messages (history on join, then new ones) |
| `intent` | client to host | a lobby or game intent |
| `packOffer` | host to client | one custom file: hash, `game` or `addon` (with the game it extends), name, author, bytes, image count |
| `packReply` | client to host | hash, accept or decline, `cached` once the pack is loaded, error if it did not check out |
| `packData` | host to client | the zip bytes of the file the client asked for. The client checks them against that offer's hash |

A client with a different protocol version gets a view that says "update your page" and
nothing else.

## Lobby

- The host picks a game from a gallery: cover art, name, player range, short description.
- Below it, the game's addons as cards with image, description and a toggle. Requirements and
  conflicts are shown and enforced. The player range updates as addons change it.
- Options declared by the pack and its addons (tie-break, tokens to win) appear as a form.
- The host can change how many copies of each card go into the deck (0 to 20), for cards
  whose count is a plain number. Counts that depend on the players (one kitten less than
  players) are rules and stay. Start is blocked while the counts break round setup for the
  players at the table. The counts are fixed when the game starts and saved with it. The
  host can save counts as named presets in their browser, per game, and load them later.
- The host picks the seats, from the game's minimum up to 12. Fewer than the game allows
  makes the rest watch. More than it allows keeps counts that depend on the players by ranges
  (tokens to win) at their value for the game's maximum, and Start is blocked while the deck
  cannot be dealt for the players at the table.
- The host can end a game at any time, which sends everyone back to the lobby.
- Each card shows the icon of the game or addon it comes from, when the pack has one.
- Everyone sees the same lobby live. Only the host can change it.
- Players list: color avatar, name, host and you badges, connection state, pack-ready state.
- Start is enabled only when the player count fits and every player has the pack. Otherwise
  the button says why.
- Players beyond the maximum, or who declined a custom pack, are spectators.

## Engine

### State

Plain JSON, defined in `src/engine/types.ts`.

- `cards`: every card instance by uid, with its card id, face-up flag and `knownBy` seats.
- `zones`: shared zones (deck, set-aside) and per-player zones (`hand:<seat>`,
  `played:<seat>`). Each zone has a visibility: `public`, `owner` or `hidden`.
- `players`: seat, playerId, name, color, round status (`in`, `out`, `sittingOut`), tokens,
  statuses (like `protected` until their next turn), connected flag.
- `turn`: current seat, direction, extra turns owed.
- `program`: the interpreter's stack of frames.
- `prompt`: the one question the game is waiting on, or null.
- `stack`: plays waiting to resolve (reaction windows, empty for Pets).
- `flags`: round flags that are on, like `upsideDown`. Public, cleared when a round starts.
- `rng`: PRNG state. `log`: entries with visibility.

### Execution

- Rules and card effects are lists of ops (see PACK_FORMAT.md).
- An interpreter runs them with an explicit stack of frames `{ ops, pc, ctx }`.
- It runs until it needs input (a prompt) or the stack is empty.
- A prompt names who must answer, what kind of answer, the valid choices, whether it is
  optional, and an optional deadline. An answer input fills it and execution continues.
- Because the stack is data, the host can save at any moment, even mid-effect, and resume
  after a reload.
- If an op has nothing to act on (no valid player to choose, empty zone to peek), the rest of
  that effect is skipped. The card still counts as played.
- Round-end conditions (for example "one player left") are checked after every op.

### Plays and reactions

- A play moves one or more cards to `played:<seat>` (or the `play` op's `to` zone), pushes it
  onto `stack` with an end time, and the program waits. Several cards must make a combo.
- The window has length 0 when no card in the merged deck can react. That is always the case
  in Pets, where plays resolve at once.
- When reactions exist (Exploding Kittens' Nope), the window always runs its full length, even
  if nobody holds a reaction card. Closing early would tell everyone who has none.
- Anyone still in may send a `react` input with a card that has `onReact`. Its ops run at once
  (`cancel` flips whether the play resolves, so a Nope on a Nope brings it back), and the
  window restarts.
- The engine has no clock. The host passes its clock with inputs (`now`), sets a timer for the
  window's end and sends a `timeout` input then. The play resolves, or does nothing if it ends
  canceled. Views carry the time left, so clients can count down.

### Hooks

Cards can define op lists for these events:

| Hook | When |
|---|---|
| `onPlay` | The card is played as an action |
| `onDiscard` | The card lands face up in front of a player by playing it or being forced to. Not when revealed by elimination |
| `onDraw` | The card is drawn (the Exploding Kitten) |
| `onReact` | The card is played as a reaction in another play's window (Nope) |
| `whileHeld` | Passive effect while in hand (future) |
| `onTurnStart`, `onTurnEnd` | Around the holder's turn (future) |
| `showdownValue` | Value rules used only at round end |

### Statuses

A status sits on a player or a card and has a duration: `ownNextTurn`, `endOfTurn`,
`endOfRound` or `permanent`. Status definitions in the pack say what they do, for example
`protected` makes the player untargetable. The engine removes `ownNextTurn` statuses at the
start of the owner's turn.

### Visibility and knowledge

- `viewFor(seat)` includes a card's identity only when the zone is public, the seat owns an
  `owner` zone, or the seat is in that card's `knownBy`.
- Hidden zones are sent as a count plus the cards this seat knows, with their positions.
- Spectators see a hidden card only when every player knows it (it was revealed to all).
- At round end, final hands and the set-aside cards are shown to everyone. The draw pile stays
  hidden.
- Peeking adds the viewer to `knownBy`. Moving a card inside a hidden zone keeps knowledge
  (Mouse Trapper knows where it put the card).
- A card put into a hidden zone at a chosen or random position (Mouse Trapper, a defused
  kitten) moves the cards below it down by one. So everyone but the mover forgets every card
  in that zone: known positions, or a known card turning up in someone's hand, would tell
  where it went. A random or chosen card taken from a hand (Pair, Favor) does the same for
  that hand. The simulation tries several answers to every position question and checks that
  nobody else's view changes.
- Shuffling a zone clears `knownBy` for its cards and gives them new uids, so nobody can track
  a card through a shuffle by its id.
- The simulation test checks that no view ever contains a hidden card its seat does not know.

### Randomness

The host seeds a small PRNG from `crypto.getRandomValues` and stores its state in the game
state. Tests use fixed seeds so games replay exactly.

### Log

Each entry is visible to everyone or to listed seats. Example: "Mia guessed 5 for Tom. Wrong."
goes to all, "Tom holds the Battle Bunny" goes to Mia only.

## Disconnects (decided)

- The game keeps going until the missing player has to act, then pauses with "Waiting for X".
- The host can kick a player for the round. That works like being knocked out: their card goes
  face up and they get no token. Seat, tokens and chat stay.
- A player still away when a round starts sits out that round. They are dealt in at the next
  round start after they return.
- Round setup uses the players in that round, so a 3-player game with one person sitting out
  uses the 2-player setup.
- Tokens to win are fixed when the game starts.
- If the host is away, everyone sees "Host is away" and waits. The host saves after every
  change, and reloading resumes the game.

## Custom packs

A zip is one of two things:

- **A game**: `pack.json` (with its own addons, if any) and images. It joins the gallery.
- **An addon** for a game the lobby has: `addon.json` with `extends` (the game's pack id) and
  its images. It joins that game's addons, after the game's own, in upload order. Its image
  paths are moved under `uploads/<hash>/`, so they cannot clash with the game's files.

1. The host picks a `.zip` in the lobby's gallery. `pack.json` or `addon.json` sits at the root
   of the zip or inside one top folder.
2. The host validates it (zip limits, file types, the pack and each addon with what it
   requires; for an addon zip, how it fits its game), computes its SHA-256, and caches it in
   IndexedDB. Cached games and addons come back in that browser next time. Each `?as=` slot has
   its own cache, like a separate device. An uploaded game is picked, an uploaded addon is
   turned on.
3. The lobby lists the custom files it uses: the game if it was uploaded, then each uploaded
   addon that is on. The host sends a `packOffer` for each to every player, and again whenever
   one reconnects or an uploaded addon is turned on. Players who have a hash cached load it
   and reply `cached` without being asked.
4. Everyone else sees one consent card for all of them: each file's name, author, size, image
   count, and "Only accept packs from people you trust. A pack can contain any images and
   text."
5. Accept: the client asks for the files one at a time; the host sends each as `packData`, at
   most three times per file and player. The client checks the size against the offer, the
   SHA-256, unzips and validates, caches, and replies `cached`. Progress comes from Trystero's
   receive progress. A player is ready when they have every file. Start waits until every
   seated player is ready.
6. Decline: that player watches this game. The consent card stays, so they can change their
   mind, also during the game.

Safety rules:

- Packs are data only. There is no way to ship code in a pack.
- Limits: 25 MB per zip, 2 MB per image, 1 MB per JSON file, 500 files, 80 MB unpacked. Image
  types: png, jpg, webp, svg. Files zip tools add (`__MACOSX`, `.DS_Store`) are skipped, any
  other file type rejects the pack. An entry that inflates past its declared size is stopped
  while inflating.
- Every action has a size cap. `packData` is only taken from the host, only while this page
  is downloading a file it asked for, and no bigger than that file's offer. Trystero's `onReceive` declines anything else
  before the transfer starts.
- Images are shown only via `<img src="blob:...">`. An SVG loaded that way cannot run scripts.
- All pack text is set as text, never parsed as HTML.
- A Content-Security-Policy in `index.html` allows scripts only from the site itself, so even
  a markup bug cannot run injected script.
- Clients validate the pack against the schema too. They never trust the host's validation.

## Screens

1. **Home**: name and color, Create lobby, Join with code.
2. **Lobby**: header with code and copy-link button, game gallery, selected game with addons
   and options, players, chat, Start.
3. **Table**, in two layouts each player picks for themselves (remembered per browser):
   - **Classic**: opponents along the top, deck and set-aside in the middle, your hand at the
     bottom, played cards in front of each player, tokens per player, log and chat in a side
     panel (a drawer on phones), players below the table. Between the middle and your hand,
     one slot holds the question, the reaction window or who the game waits on, so the table
     does not jump when they come and go.
   - **Round table**: everyone seated around an oval in turn order, clockwise, you at the
     bottom. The seat the game waits on glows, an arrow and a spotlight point at it, and the
     middle says whose move it is, with the shared piles, round flags and the latest event.
     The question and your hand sit side by side in a bar pinned to the bottom of the screen,
     so the hand never scrolls away; when nothing is asked of you the bar says who the game
     waits on. The oval takes the height that is left, and gets wider rather than smaller on
     short screens. Players move into a tab beside the log. On narrow screens the seats sit
     in a grid instead of an oval.
   - In both, clicking a card in your hand opens it large with its text, with Play and Back.
     Cards played in combos are picked instead, and one picked card shows its text. A
     question about one card shows that card: where it goes back (Mouse Trapper, a defused
     kitten), or whether to swap for it (Doggy Grave Digger, Treasure Magpie, Haggling Hamster).
   - The room uses the whole window. On wide screens the cards grow with it, so the table fills
     the screen instead of sitting in a narrow column.
4. **Signals** (`src/ui/events.ts` compares the view a page had with the new one): a big
   "Your turn" when your turn starts, a glow on your area while the game waits on you, a flash
   on the seat that played a card, a red flash and shake on a player who goes out, a riffle on a
   pile that was shuffled, and the newest log line sliding in. The tab title says "Your move".
   Each comes with a short sound (`src/ui/sound.ts`, made with the Web Audio API, no sound
   files), with a mute switch in the top bar that the browser remembers. Reduced motion turns
   the animations off.
5. **Round end**: hands revealed, the winner, tokens. **Game end**: winner and rematch.

## Testing

- Unit tests for each op and for addon merging.
- Simulation: thousands of random games with random legal inputs and fixed seeds. Invariants:
  card count never changes, no card is in two zones, every game ends, no view leaks a hidden
  card.
- Manual multi-tab play with the local transport, then a real test over Trystero.

## Exploding Kittens check

Power Hungry Pets never needs these, but the core left room for them so Exploding Kittens
became new ops, not a rewrite (milestone 7, built):

- Plays with several cards (combos), which is why a play is a list of card uids.
- Prompts to any player, not just the active one (Favor makes the target choose).
- Reaction windows timed by the host (the Nope window).
- The reaction stack (Nope cancels the top play, a Nope can be Noped).
- `onDraw` (the kitten explodes when drawn) and extra turns owed (Attack).

Writing the deck in the pack format first (the paper test) showed what was missing: a play
that repeats until the player passes, cards that only go in combos, moving a card by its id,
secret moves (only the mover knows where the kitten went back), and dealing some cards before
others go into the deck (`buildDeck` with `only` and `except`).
