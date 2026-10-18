# Make your own pack

Every game in Card Lobby is a pack: JSON files that describe the cards and the rules, plus
images. There is no code in a pack. The engine has a fixed set of building blocks (ops), and a
pack puts them together. That means you can make new cards, change old ones or write a whole
new game with nothing but a text editor.

There are two kinds of zips you can upload in the lobby:

- **An addon** for a game the lobby has, like Power Hungry Pets. It adds cards, changes cards
  or changes rules. It holds an `addon.json` and its images.
- **A whole game.** It holds a `pack.json`, its images and, if you like, its own addons.

This tutorial uses the two house addons of Power Hungry Pets as worked examples. Both ship with
the game, so you can turn them on in the lobby and see every card in action:

- **Second Litter**: a new pet for each number from 1 to 8. It is the best place to learn how
  single cards work. File: [second-litter.json](../public/packs/power-hungry-pets/addons/second-litter.json).
- **Off the Scale**: a -1 and an ∞ that change how the round ends. It shows how an addon
  changes the rules, not only the cards. File: [off-the-scale.json](../public/packs/power-hungry-pets/addons/off-the-scale.json).

Their art is in [public/packs/power-hungry-pets/art](../public/packs/power-hungry-pets/art).
The rules as played are in [docs/rules/power-hungry-pets.md](rules/power-hungry-pets.md).
Every field and op is listed in [PACK_FORMAT.md](PACK_FORMAT.md); this tutorial covers the
ones you need first.

## Before you start

- **A text editor that understands JSON**, such as VS Code. It shows a missing comma before the
  lobby does.
- **Images**: SVG, PNG, JPG or WebP. Cards are 500 x 700 pixels, addon pictures and game
  covers 1280 x 800. The app draws the card's number in the top-left corner and its name along
  the bottom, so keep those parts of the art plain.
- **A way to zip.** From a copy of this repository, `npm run zip-pack -- <folder>` makes
  `<folder>.zip` with the files where the lobby expects them. Any zip tool works too: zip the
  folder itself, or its contents.
- **A way to test alone.** Open the site with `?transport=local` and create a lobby. Copy the
  link and open it in a second tab with `&as=2` added, and that tab is a second player. To run
  the site yourself: `npm install`, then `npm run dev`, then open http://localhost:5173.

## How one card works

Here is Nosy Ferret from Second Litter:

```json
{
  "id": "nosy-ferret",
  "name": "Nosy Ferret",
  "value": 2,
  "count": 1,
  "image": "art/nosy-ferret.svg",
  "text": "Choose another player and secretly look at their card.",
  "onPlay": [
    { "op": "choosePlayer", "as": "t", "from": "others" },
    { "op": "reveal", "zone": "hand:$t", "to": "self" }
  ]
}
```

- `id` is how rules and other packs refer to the card: lowercase letters, digits and dashes,
  unique in the game. `name` is what players see.
- `value` is the number on the card. Power Hungry Pets compares it at the showdown, in guesses
  and in Battle Bunny duels.
- `count` is how many copies go into the deck.
- `text` is printed on the card. Write it for players; the engine never reads it.
- `onPlay` is a list of ops that run, top to bottom, when someone plays the card.

The two ops:

1. `choosePlayer` asks the player who played the card to pick someone. `from: "others"` means
   any other player still in the round (players shielded by Shell Shield are skipped). `as: "t"`
   stores the choice under the name `t`.
2. `reveal` shows the cards in a zone to some players. `hand:$t` is the hand of the player
   stored as `t`. `to: "self"` means only the player who played the card.

Change one word and you get Gossip Parrot, the 1 of the same addon: `"to": "all"` shows the
card to everyone.

If an op has nothing to work with (everyone else is shielded, say), the rest of the card's ops
are skipped. The card still counts as played. The log usually tells players why nothing
happened.

### More patterns, from the rest of Second Litter

Each card in Second Litter shows another way to combine ops. Open the file next to this table.

| Card | Ops | What it shows |
|---|---|---|
| Pillow-Fight Panda | `discard`, `draw` with `fallback`, `if` with `in` | Forcing cards face up (a King Cat knocks out its holder), and only drawing for players still in |
| Tunnel Mole | `move` to `deck` at `bottom`, `draw` | Moving a card between zones. Who knows a card is tracked for you |
| Swapsie Squirrel | `choosePlayer` twice with `except`, `swap` | Picking two different players |
| Treasure Magpie | `peek` with `as`, `confirm`, `if` with `is`, `move` with `card` | Asking yes or no, and moving one particular card |
| Penguin Parade | `selectPlayers`, `passHands` | Doing something to everyone at once, without asking |
| Haggling Hamster | `reveal` to `self`, `confirm` with `{$t}` in its text, `swap` | Putting a player's name into a question |

## Part 1: your first addon

You will make **Sleepy Ferrets**, an addon with one card: a ferret that peeks at a card like
Nosy Ferret, then takes a nap like Shell Shield. The finished folder is in
[examples/my-first-addon](../examples/my-first-addon), so you can compare as you go.

### 1. Make the folder

```
my-first-addon/
  addon.json
  art/
    addon.svg
    sleepy-ferret.svg
```

The images can be anything for now. Copy `nosy-ferret.svg` from the Power Hungry Pets art
folder and rename it if you have no art yet.

### 2. Write addon.json

<!-- tutorial example: examples/my-first-addon/addon.json -->
```json
{
  "format": 1,
  "id": "sleepy-ferrets",
  "name": "Sleepy Ferrets",
  "description": "The tutorial addon: a ferret that peeks at a card and then takes a nap.",
  "extends": "power-hungry-pets",
  "author": "The Card Lobby tutorial",
  "image": "art/addon.svg",
  "cards": {
    "add": [
      {
        "id": "sleepy-ferret",
        "name": "Sleepy Ferret",
        "value": 4,
        "count": 1,
        "image": "art/sleepy-ferret.svg",
        "text": "Choose another player and secretly look at their card. Then take a nap: until your next turn, other cards cannot affect you.",
        "onPlay": [
          { "op": "choosePlayer", "as": "t", "from": "others" },
          { "op": "reveal", "zone": "hand:$t", "to": "self" },
          { "op": "status", "who": "self", "id": "protected", "until": "ownNextTurn" }
        ]
      }
    ]
  }
}
```

- `format` is always `1` for now.
- `id` must be new for the game. Power Hungry Pets already has `big-litter`, `off-the-scale`
  and `second-litter`.
- `extends` is the `id` from the game's `pack.json`, here `power-hungry-pets`. It is what makes
  this an addon zip.
- `image` is the picture in the lobby's addon list. Paths are relative to the folder.
- The card's first two ops are Nosy Ferret's. The third is Shell Shield's `onPlay` from the
  Power Hungry Pets `pack.json`: it gives the player the `protected` status until their next
  turn. Statuses come from the game's rules, so your addon can use the game's `protected`.

Why value 4? Shell Shield is a 4, and the Sleepy Ferret does what Shell Shield does and a
little more. A higher number would make it a card you want to keep at the showdown as well.
Second Litter follows the same idea: each new pet does about as much as the old pet with its
number.

Because an op with nothing to work with skips the rest, the ferret does not nap when every
other player is shielded. Put the `status` op first if you want the nap to happen anyway.

### 3. Zip it

```bash
npm run zip-pack -- my-first-addon
```

This writes `my-first-addon.zip` next to the folder. With another zip tool, make sure
`addon.json` ends up at the top of the zip, or inside one folder at the top.

### 4. Upload it

1. Create a lobby and pick Power Hungry Pets.
2. Click the **Custom pack** tile and pick the zip.
3. The addon appears in the game's addon list, turned on, marked "Uploaded". The Sleepy Ferret
   shows up among the cards.

If something is wrong, the lobby lists the problems with the file and the place in it, for
example:

| Message | What to do |
|---|---|
| `Sleepy Ferrets/addon.json: cards.sleepy-ferret.onPlay[1]: unknown op "revael"` | A typo in an op name. The list of ops is in PACK_FORMAT.md |
| `... onPlay[1].zone: variable "$target" is not set by an earlier op` | A `$name` that no earlier op stored with `as` |
| `addon.json: image "art/sleepy.svg" is missing from the zip` | The path in the JSON does not match the file |
| `Sleepy Ferrets is an addon for the game "power-hungry-pet", which this lobby does not have.` | `extends` must be the game's exact id |
| `Power Hungry Pets already has an addon with the id "second-litter".` | Pick a new `id` |

Your browser keeps the zip, so the addon is still there next time you host. The **Remove**
button on a turned-off uploaded addon takes it away again.

### 5. Play it

Open a second tab as another player (see "Before you start"). That player is asked whether to
download the addon first; everyone who joins is. Start the game and play the ferret. The game
log tells you what happened, and lines only you can see are marked.

## Part 2: changing cards that exist

Big Litter, the third Power Hungry Pets addon, adds no cards at all. It changes how many
copies there are, lets up to 10 players join, and changes an option's default:

```json
"players": { "max": 10 },
"cards": {
  "modify": {
    "crystal-bowl": { "count": 8 },
    "mouse-trapper": { "count": 5 }
  }
},
"options": {
  "modify": {
    "tokensToWin": { "default": { "byPlayers": { "2-3": 3, "4-10": 2 } } }
  }
}
```

- `cards.modify` changes fields of a card by its id: its count, value, text, image, or a whole
  op list like `onPlay`.
- `cards.remove` takes cards out: `"remove": ["royal-robovac"]`.
- Addons apply one after another: the game's own addons in their listed order, then uploaded
  addons in the order they were uploaded. When two addons change the same field, the later one
  wins.
- A count can depend on the player count, like `{ "byPlayers": { "2-3": 3, "4-10": 2 } }`.

## Part 3: changing the rules

Off the Scale changes how the round ends. Each of its parts is a technique you can reuse.

### Numbers beyond the usual

The Backflip Bat has `"value": -1`. The Galaxy Goldfish has `"value": 100` with
`"valueLabel": "∞"`: the engine compares 100, players see ∞ on the card and in guesses.

### When a card goes face up: onDiscard

The Bat's ops are in `onDiscard`, not `onPlay`. `onPlay` runs only when someone plays the card.
`onDiscard` runs whenever the card lands face up in front of a player: when it is played, and
also when Snake Sorcerer or Pillow-Fight Panda forces it face up. The King Cat works the same
way.

### A switch for the whole round: flags

```json
"rules": {
  "flags": {
    "upsideDown": { "label": "Upside down", "text": "The lowest card wins the showdown." }
  },
  "showdown": { "lowestWins": { "flag": "upsideDown" } }
}
```

and in the Bat's `onDiscard`:

```json
{ "op": "flag", "id": "upsideDown", "to": "toggle" }
```

- `rules.flags` declares a flag. While it is on, the table shows its label and text to
  everyone.
- The `flag` op turns it on, off, or flips it (`"to": "toggle"`), which is how the second Bat
  turns the round back.
- `{ "flag": "upsideDown" }` is a condition, usable in `if` ops and in rules.
  `showdown.lowestWins` takes a condition: while it holds, the lowest card wins.
- Addon rules merge into the game's rules, so `showdown` keeps the game's tie-break.

### A mark on one player: statuses

The Goldfish gives its player a status, and the turn checks for it:

```json
"statuses": { "lastCall": { "label": "On last call" } }
```

```json
{ "op": "status", "who": "self", "id": "lastCall", "until": "endOfRound" }
```

The label shows on the player's seat. `until` can be `ownNextTurn`, `endOfTurn`, `endOfRound`
or `permanent`. `{ "hasStatus": ["self", "lastCall"] }` is the matching condition.

### Replacing the turn

```json
"turn": [
  {
    "op": "if",
    "cond": { "hasStatus": ["self", "lastCall"] },
    "then": [{ "op": "log", "text": "Last call is over." }, { "op": "endRound", "by": "showdown" }]
  },
  { "op": "if", "cond": { "zoneEmpty": "deck" }, "then": [{ "op": "endRound", "by": "showdown" }] },
  { "op": "draw", "who": "self" },
  { "op": "play", "min": 1, "max": 1 }
]
```

When rules merge, objects merge key by key, but lists are replaced whole. So to add a step to
the turn, an addon copies the game's whole `turn` list and adds its step. Here the new first
step ends the round at the start of the caller's next turn. The other three are the Power
Hungry Pets turn, unchanged.

### Leave room for an answer

A first version of the Goldfish ended the round the moment it was played, and the first Bat
flipped the round for good. Nobody could do anything about either. Now the Goldfish gives
everyone one more turn, and a second Bat can flip the round back. When you design a strong
card, ask what the other players can do about it.

## Part 4: a whole new game

A game is a folder with a `pack.json`:

```
my-game/
  pack.json
  addons/          (optional)
  art/
    cover.svg
    back.svg
    ...
```

The easiest start is a copy of a built-in game:

- [public/packs/power-hungry-pets](../public/packs/power-hungry-pets): hold one card, draw one,
  play one, best card at the showdown.
- [public/packs/exploding-kittens](../public/packs/exploding-kittens): play many cards, combos,
  a Nope that anyone can play in a timed window, cards that do something when drawn.

Give the copy a new `id` and `name`, then change it bit by bit. The parts of `pack.json`:

| Part | What it is |
|---|---|
| `id`, `name`, `version`, `description`, `author` | About the game. The `id` is what addons put in `extends` |
| `engine` | The engine version it needs, `"0.1"` |
| `players` | `{ "min": 2, "max": 6 }` |
| `art` | `cover` and `back` images, and an `accent` color for the page while the game is picked |
| `options` | Choices the host makes in the lobby, like tokens to win |
| `rules.zones`, `rules.playerZones` | Where cards can be: a `deck`, every player's `hand` and `played` row, and any others you need |
| `rules.roundSetup` | Ops that run at the start of each round: build the deck, shuffle, deal |
| `rules.turn` | Ops that run for each turn |
| `rules.roundEnd`, `rules.showdown`, `rules.scoring`, `rules.rounds` | How a round ends, how it is decided, how many wins make the game, who starts |
| `cards` | Every card |
| `addons` | Paths of addon files in the folder |

The Power Hungry Pets round setup, for example, reads like the rulebook:

```json
"roundSetup": [
  { "op": "buildDeck", "to": "deck" },
  { "op": "shuffle", "zone": "deck" },
  { "op": "move", "from": "deck", "to": "setAside", "count": 1 },
  { "op": "deal", "from": "deck", "to": "all", "count": 1 }
]
```

Zip the folder and upload it with the Custom pack tile: it joins the game gallery. The lobby
checks a game (and every addon, together with its game) when you upload it, and even runs the
round setup for every player count the game allows, so a deck that is too small for 6 players
is caught before anyone plays.

## Sharing

- In a lobby, the host's zips go to the players over the same connection as the game. Each
  player sees what the zip is, who made it and how big it is, and decides whether to download
  it. Who says no watches instead.
- Limits: 25 MB per zip, 2 MB per image, 1 MB per JSON file. Only JSON and images are allowed.
- Images are only ever shown as pictures, and text only as text, so a pack cannot run code on
  anyone's computer.
- To make a game or addon part of your own copy of Card Lobby, put it in `public/packs` like the
  built-in ones (games are listed in `public/packs/index.json`, addons in their game's
  `pack.json`), and write down its rules in `docs/rules`.

## Where to go next

- [PACK_FORMAT.md](PACK_FORMAT.md): every field, op and condition.
- [docs/rules](rules): how the built-in games and addons are meant to play.
- The game log: when a card does something unexpected, the log usually says why.
