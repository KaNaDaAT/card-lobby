# Pack format

A pack is one game: its cards, its rules, its art, and its addons. Packs are data only. The
engine ships a fixed set of ops (building blocks), and packs combine them.

New to packs? Start with [TUTORIAL.md](TUTORIAL.md). This file is the reference.

Reference packs: [public/packs/power-hungry-pets](../public/packs/power-hungry-pets) (its
addons show card changes, flags, statuses and a replaced turn) and
[public/packs/exploding-kittens](../public/packs/exploding-kittens) (combos, reactions, extra
turns, `onDraw`).

Status markers in this document:

- **M2** means built in milestone 2 (the Power Hungry Pets engine).
- **M7** means built in milestone 7 (for Exploding Kittens).
- **Future** means designed but not scheduled. A pack that uses a future op is rejected.

## Folder layout

```
my-pack/
  pack.json
  addons/
    some-addon.json
  art/
    cover.svg
    back.svg
    some-card.svg
```

Built-in packs live in `public/packs/<id>/` and are listed in `public/packs/index.json`.
A custom pack is the same folder zipped, with `pack.json` at the root of the zip or inside one
top folder (what zipping the folder itself gives you). Only `.json` files and png, jpg, webp or
svg images may be in it. Limits: 25 MB for the zip, 2 MB per image, 1 MB per JSON file.

An addon can also come in a zip of its own, for a game the lobby already has (built in or
uploaded). See "Addon zips" below. `npm run zip-pack -- <folder>` zips either kind.

## pack.json

| Field | Type | Notes |
|---|---|---|
| `format` | `1` | Format version of this file |
| `id` | string | Lowercase, digits and dashes. Unique |
| `name` | string | Shown in the gallery |
| `version` | string | The pack's own version, like `1.0.0` |
| `author` | string | Optional |
| `description` | string | One or two sentences for the gallery |
| `engine` | string | Lowest engine version the pack needs, like `0.1` |
| `players` | `{ min, max }` | Player range without addons |
| `art` | `{ cover, back, accent?, icon? }` | Image paths relative to the pack folder. `accent` is a CSS color for the lobby. `icon` is a small square image shown in a corner of the game's own cards, like a set symbol |
| `options` | Option[] | Settings the host picks in the lobby |
| `rules` | Rules | Zones, statuses, round setup, turn, showdown, scoring |
| `cards` | Card[] | The base deck |
| `addons` | string[] | Paths of addon files. This order is also the merge order |

Image sizes: cover and addon images 1280 x 800 (16:10), cards and back 500 x 700 (5:7), icons
64 x 64 (square, drawn small, so bold shapes read best). SVG, PNG, JPG or WebP.

Card images are illustrations only. The app draws the value, name and text on top, so an
addon can change a card's value without new art. Keep the top-left corner and the bottom
third of card art calm.

## Cards

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique in the pack |
| `name` | string | |
| `value` | number | Optional. Used by guesses, comparisons and the showdown |
| `valueLabel` | string | Optional, 1 to 3 characters shown instead of the value, on cards and in guesses. `"value": 100, "valueLabel": "∞"` makes an infinity card |
| `count` | Count | How many copies go into the deck |
| `text` | string | Rules text printed on the card. Plain text |
| `image` | string | Optional art path |
| `tags` | string[] | Optional, for filters and combos |
| `onPlay` | Op[] | Runs when the card is played as an action |
| `onDiscard` | Op[] | Runs when the card lands face up in front of a player, by playing it or being forced to. Not when revealed by elimination |
| `onDraw` | Op[] | M7. Runs when the card is drawn (an Exploding Kitten) |
| `onReact` | Op[] | M7. Makes the card a reaction: it can be played by anyone while a play's reaction window is open. Only `cancel`, `log` and `if`, and nothing that asks |
| `comboOnly` | boolean | M7. The card cannot be played alone, only in a combo (cat cards) |
| `showdownValue` | ValueRule[] | Overrides `value` at round end. First matching rule wins |

`ValueRule`: `{ "if": Condition, "value": number | "highest" | "lowest" }`. Use `"highest"`
instead of a big number, so an addon that adds higher cards cannot silently beat it.
`"highest"` beats and `"lowest"` loses to every number, also when `showdown.lowestWins`
turns the showdown around.

## Counts

A count is used for card copies and for options like tokens to win.

```json
3
{ "perPlayer": 1, "offset": -1 }
{ "byPlayers": { "2-3": 3, "4-6": 2, "7+": 2 } }
```

- `perPlayer` and `offset`: players in the round times `perPlayer`, plus `offset`.
- `byPlayers` keys are `"N"`, `"N-M"` or `"N+"`. A player count that matches no key is a
  validation error.

## Options

Options appear in the lobby. Rules refer to them with `{ "option": "<id>" }`.

```json
{
  "id": "tieBreak",
  "label": "Tie-break",
  "type": "select",
  "choices": [
    { "value": "highestPlayed", "label": "Highest played card" },
    { "value": "sumPlayed", "label": "Total of played cards" }
  ],
  "default": "highestPlayed"
}
```

| Type | Extra fields | Default |
|---|---|---|
| `select` | `choices` | one of the choice values |
| `number` | `min`, `max` | a number or a Count |
| `toggle` | | `true` or `false` |

## Rules

```json
"rules": {
  "zones": { "deck": { "visibility": "hidden" } },
  "playerZones": { "hand": { "visibility": "owner" }, "played": { "visibility": "public" } },
  "statuses": { "protected": { "label": "Shielded", "untargetable": true } },
  "roundSetup": [ ops ],
  "turn": [ ops ],
  "roundEnd": { "lastStanding": true },
  "combos": [ { "name": "Pair", "size": 2, "match": "same", "ops": [ ops ] } ],
  "reactions": { "seconds": { "option": "nopeSeconds" } },
  "showdown": { "tieBreak": { "option": "tieBreak" }, "stillTied": "allWin" },
  "scoring": { "roundWin": 1, "toWin": { "option": "tokensToWin" }, "tiedAtTarget": "decidingRound" },
  "rounds": { "first": "random", "next": "lastWinner" }
}
```

| Field | Meaning |
|---|---|
| `zones` | Shared zones. Visibility `hidden` (count only), `public`. Optional `label` names the zone in logs, like `"the draw pile"`. The engine needs a `deck` zone |
| `playerZones` | Zones every player has. Visibility `owner` (only the owner sees), `public`. Optional `label`. The engine needs `hand` and `played` |
| `statuses` | Status definitions. `untargetable: true` means choosers and group selectors skip the player |
| `flags` | Switches for the whole round, like `{ "upsideDown": { "label": "Upside down", "text": "The lowest card wins the showdown." } }`. The `flag` op sets them, the `flag` condition reads them, and the table shows the label and text while one is on. All are off when a round starts |
| `roundSetup` | Ops run at the start of every round, for the players in that round |
| `turn` | Ops run for each turn. `self` is the active player |
| `roundEnd.lastStanding` | End the round as soon as one player is left. Checked after every op |
| `combos` | M7. Multi-card plays. `match`: `same` (all one card id) or `distinct` (all different). Playing them runs `ops` instead of the cards' `onPlay` (`onDiscard` still fires) |
| `reactions.seconds` | M7. How long a reaction window stays open, 1 to 60 seconds or a number option. Only used when the deck has `onReact` cards. Each reaction restarts the window, and it always runs its full length, so it never tells who holds a reaction |
| `showdown` | How the round is decided when `endRound` runs with `by: "showdown"`. Highest effective value wins. `tieBreak`: `highestPlayed`, `sumPlayed` or `none`. `stillTied`: `allWin`. `lowestWins`: a condition; when it holds, the lowest value wins instead (the tie-break stays the same). `endRound` may also run from a card, which calls the showdown early |
| `scoring.roundWin` | Tokens for each round winner |
| `scoring.toWin` | Tokens needed to win the game. Fixed when the game starts |
| `scoring.tiedAtTarget` | `decidingRound`: if several players reach the target together, they play one more round among themselves |
| `rounds.first`, `rounds.next` | Who starts. `random`, `lastWinner` or `nextSeat` |

## References

Inside ops, these strings point at players, zones and values.

**Players**

| Reference | Means |
|---|---|
| `self` | The active player, or the card's holder inside a card hook |
| `next`, `previous` | The next or previous player still in, in turn direction |
| `all` | Every player still in, including self |
| `others` | Every player still in, except self |
| `$name` | A player or list of players stored earlier with `as` |
| `$card` | Inside a card hook: the card itself (its uid) |

**Zones**: shared zone ids (`deck`, `setAside`, ...) or player zones `hand:<player>` and
`played:<player>`, for example `hand:self`, `hand:$t`, `hand:$group`.

**Values**: numbers, `$name`, or `{ "option": "<id>" }`.

Text in `log` ops can use `{$name}` and `{self}`, which become player or card names.

## Ops

Every op is an object with an `op` field. Ops that store something take `as` (the variable
name, without `$`). If an op has nothing to act on (no valid player, empty zone), the rest of
the current effect is skipped. The card still counts as played.

### Setup and cards

| Op | Params | Status |
|---|---|---|
| `buildDeck` | `to`, `only?`, `except?` (card ids) | M2. Puts every card of the merged pack into a zone, counts resolved for this round. M7: `only` or `except` pick some of them |
| `shuffle` | `zone` | M2. Also clears knowledge and renews uids of the cards in it |
| `move` | `from`, `to`, `count = 1` (or `all`), `faceUp?`, `at? = top / bottom / random / $var`, `card? = $var`, `match?` (card id), `secret?` | M2. Moves cards from the top of `from`, or one specific card. `from` may name several zones (`hand:$group`). M7: `match` moves the first card with that id. `secret` leaves only the mover knowing where the card went. A move into a hidden zone at a chosen or random position is always secret, and everyone else forgets the cards in that zone, since their places would tell where it went |
| `deal` | `from`, `to` (players), `count = 1` | M2. Deals one card at a time, round-robin |
| `draw` | `who`, `count = 1`, `fallback?` (zone) | M2. From `deck` into the hand. Uses `fallback` when the deck is empty. Fires `onDraw` |

### Turn flow

| Op | Params | Status |
|---|---|---|
| `play` | `min`, `max`, `repeat?`, `to? = played:self`, `pass?` (label) | M2. The active player plays cards from their hand. Fires `onDiscard`, then `onPlay`. M7: several cards must make a combo, `min: 0` lets the player pass (`pass` names that button, like "Draw a card"), `repeat` asks again until they pass, and with reaction cards in the deck each play waits out its reaction window first |
| `endRound` | `by: showdown` | M2 |
| `endTurn` | `all?` | M7. Ends the turn at once, skipping the rest of the turn's ops (Skip). `all` also drops extra turns owed |
| `addTurns` | `who`, `count` | M7. The players take `count` turns in a row when their turn comes (Attack). Does not add up |
| `reverse` | | Future (Reverse) |

### Choices (prompts)

| Op | Params | Status |
|---|---|---|
| `choosePlayer` | `as`, `from`, `except?`, `holding?` (card id), `withCards?`, `auto?`, `includeProtected?` | M2. `auto` skips the prompt when exactly one player fits. Untargetable players are skipped unless `includeProtected`. M7: `withCards` skips players with an empty hand. `except` leaves out players, like one chosen before (`"except": "$a"`) |
| `selectPlayers` | `as`, `from`, `except?`, `withCards?`, `includeProtected?` | M2. No prompt. Stores every fitting player |
| `guess` | `as`, `exclude?` (values) | M2. Pick a card value present in the merged deck. Logged for everyone |
| `choosePosition` | `zone`, `as`, `insert?`, `card?` ($var) | M2. 0 is the top. M7: `insert` adds the bottom, for a card going into the zone. `card` names the card being placed, so the question shows it (only to a player who knows it) |
| `confirm` | `as`, `text` | M2. Yes or no |
| `chooseCard` | `as`, `from` (zone), `by? = self`, `text?` | M7. `by` picks a card from the zone (Favor: the target picks from their own hand). Stores its uid. `text` replaces the prompt's "pick a card." and may use `{self}` |
| `nameCard` | `as` | M7. Names a card id from this round's deck. Logged for everyone |

### Effects

| Op | Params | Status |
|---|---|---|
| `peek` | `zone`, `count = 1`, `as?` | M2. Shows cards from the top to self only |
| `reveal` | `zone`, `to` (`all` or players) | M2 |
| `swap` | `a`, `b` (single-card zones) | M2. Each previous holder still knows the card they gave away |
| `passHands` | `who`, `direction? = next` (or `previous`) | Each of the players passes their hand to the next of them in turn order. Everyone still knows what they passed on |
| `discard` | `who` | M2. Forced: hand card goes face up in front of them. Fires `onDiscard`, not `onPlay` |
| `compareHands` | `a`, `b`, `as` | M2. Shows each hand to the other player. Stores the lower player, nothing on a tie |
| `eliminate` | `who` | M2. Out for the round. Hand goes face up into `played`, without hooks |
| `status` | `who`, `id`, `until` (`ownNextTurn`, `endOfTurn`, `endOfRound`, `permanent`) | M2 |
| `if` | `cond`, `then`, `else?` | M2 |
| `log` | `text`, `to? = all` | M2 |
| `flag` | `id`, `to? = true` (or `false`, `"toggle"`) | Turns a round flag from `rules.flags` on or off |
| `take` | `from`, `pick` (`random` or `$var`), `to? = hand:self` | M7. Moves one card: a random one, the uid from `chooseCard`, or the first card with the id from `nameCard`. A named card that is not there ends the effect. A random or chosen card from a hidden zone leaves everyone but the taker and the zone's owner forgetting that zone's cards |
| `cancel` | `what: stackTop` | M7. Only in `onReact`. Cancels the play in the reaction window, or brings it back if it was canceled |
| `reorder` | `zone`, `count` | Future (Alter the Future) |

## Conditions

| Condition | True when |
|---|---|
| `{ "players": "2" }` | Players in the round match the range (`"N"`, `"N-M"`, `"N+"`) |
| `{ "zoneEmpty": "deck" }` | The zone has no cards |
| `{ "set": "$name" }` | The variable has a value |
| `{ "is": "$name" }` | The variable is true |
| `{ "in": "$name" }` | The player is still in the round |
| `{ "handHasValue": ["$t", "$g"] }` | The player's hand holds a card with that value |
| `{ "handHas": ["$t", "card-id"] }` | M7. The player's hand holds that card (or the card id in a variable) |
| `{ "anyHandHas": "card-id" }` | Some player still in holds that card. Used at showdown |
| `{ "flag": "upsideDown" }` | That round flag is on |
| `{ "hasStatus": ["self", "lastCall"] }` | The player has that status |
| `{ "not": C }`, `{ "all": [C] }`, `{ "any": [C] }` | Logic |

## Addons

An addon is a JSON file listed in the pack's `addons`. The host toggles addons in the lobby.

```json
{
  "format": 1,
  "id": "big-litter",
  "name": "Big Litter",
  "description": "More cards for up to 10 players.",
  "image": "art/addon-big-litter.svg",
  "requires": [],
  "conflicts": [],
  "players": { "max": 10 },
  "cards": {
    "add": [],
    "remove": [],
    "modify": { "crystal-bowl": { "count": 8 } }
  },
  "rules": {},
  "options": {
    "add": [],
    "modify": { "tokensToWin": { "default": { "byPlayers": { "2-3": 3, "4-10": 2 } } } }
  }
}
```

An addon may also have an `icon` (a small square image). The cards it adds show it in a
corner, so players can tell them from the game's own cards.

Merge rules:

- Addons apply in the order of the pack's `addons` list, not the order they were toggled.
  The result is the same no matter who clicked what first.
- `cards.add` appends cards. Their ids must be new. `cards.remove` drops cards by id.
  `cards.modify` merges fields into an existing card. A hook given there replaces that hook's
  whole op list.
- `rules` is deep-merged: objects merge key by key, arrays and plain values replace.
- `options.add` appends options. `options.modify` merges fields into an existing option.
- `players` overrides `min` and `max`.
- `requires` and `conflicts` list other addon ids of the same pack. The lobby enforces them.

## Addon zips

An addon for an existing game, uploaded on its own. The zip holds `addon.json` and its images,
nothing else is needed from the game:

```
my-addon/
  addon.json
  art/
    addon.svg
    new-card.svg
```

`addon.json` is an addon file as above, plus:

| Field | Type | Notes |
|---|---|---|
| `extends` | string | The pack id of the game it is for, like `"power-hungry-pets"` |
| `author` | string | Optional. Shown to players before they download it |

- Image paths are relative to the zip. The addon's `image` and `icon` and every image its cards
  name must be in the zip.
- It is merged after the game's own addons, in the order addons were uploaded. `requires` and
  `conflicts` may name the game's addons and other uploaded ones.
- Its id must be new for that game.
- Errors name it by its name, like `Second Litter/addon.json: cards.penguin-parade.onPlay[1]:
  unknown op "passhands"`.

Example: [examples/my-first-addon](../examples/my-first-addon), the addon built in
[TUTORIAL.md](TUTORIAL.md).

## Validation

The merged pack is validated before a game starts. Errors name the file and the path, for
example `addons/big-litter.json: cards.modify.crystal-bwol: no card with this id`.

Checked:

- Every op is known to this engine version, and its required params are present. Unknown params
  are errors too, so a typo like `form` for `from` is caught.
- `roundSetup` never asks a player anything.
- Every `$variable` is set by an earlier op (`as`) in the same effect.
- Card ids are unique. Every referenced card id, zone, status, option and variable exists.
- Every count resolves for every player count the merged pack allows.
- The deck is big enough: cards dealt and set aside in setup, plus at least one draw per
  player, for every player count the pack allows. Setup really runs to check this.
- Image paths exist and use an allowed type.
