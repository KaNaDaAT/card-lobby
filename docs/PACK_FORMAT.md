# Pack format

A pack is one game: its cards, its rules, its art, and its addons. Packs are data only. The
engine ships a fixed set of ops (building blocks), and packs combine them.

Reference pack: [public/packs/power-hungry-pets](../public/packs/power-hungry-pets).

Status markers in this document:

- **M2** means built in milestone 2 (the Power Hungry Pets engine).
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
| `art` | `{ cover, back, accent? }` | Image paths relative to the pack folder. `accent` is a CSS color for the lobby |
| `options` | Option[] | Settings the host picks in the lobby |
| `rules` | Rules | Zones, statuses, round setup, turn, showdown, scoring |
| `cards` | Card[] | The base deck |
| `addons` | string[] | Paths of addon files. This order is also the merge order |

Image sizes: cover and addon images 1280 x 800 (16:10), cards and back 500 x 700 (5:7). SVG,
PNG, JPG or WebP.

Card images are illustrations only. The app draws the value, name and text on top, so an
addon can change a card's value without new art. Keep the top-left corner and the bottom
third of card art calm.

## Cards

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique in the pack |
| `name` | string | |
| `value` | number | Optional. Used by guesses, comparisons and the showdown |
| `count` | Count | How many copies go into the deck |
| `text` | string | Rules text printed on the card. Plain text |
| `image` | string | Optional art path |
| `tags` | string[] | Optional, for filters and combos |
| `onPlay` | Op[] | Runs when the card is played as an action |
| `onDiscard` | Op[] | Runs when the card lands face up in front of a player, by playing it or being forced to. Not when revealed by elimination |
| `onDraw` | Op[] | **Future.** Runs when the card is drawn |
| `showdownValue` | ValueRule[] | Overrides `value` at round end. First matching rule wins |

`ValueRule`: `{ "if": Condition, "value": number | "highest" | "lowest" }`. Use `"highest"`
instead of a big number, so an addon that adds higher cards cannot silently beat it.

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
| `roundSetup` | Ops run at the start of every round, for the players in that round |
| `turn` | Ops run for each turn. `self` is the active player |
| `roundEnd.lastStanding` | End the round as soon as one player is left. Checked after every op |
| `showdown` | How the round is decided when `endRound` runs with `by: "showdown"`. Highest effective value wins. `tieBreak`: `highestPlayed`, `sumPlayed` or `none`. `stillTied`: `allWin` |
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
| `buildDeck` | `to` | M2. Puts every card of the merged pack into a zone, counts resolved for this round |
| `shuffle` | `zone` | M2. Also clears knowledge and renews uids of the cards in it |
| `move` | `from`, `to`, `count = 1` (or `all`), `faceUp?`, `at? = top / bottom / random / $var`, `card? = $var` | M2. Moves cards from the top of `from`, or one specific card. `from` may name several zones (`hand:$group`) |
| `deal` | `from`, `to` (players), `count = 1` | M2. Deals one card at a time, round-robin |
| `draw` | `who`, `count = 1`, `fallback?` (zone) | M2. From `deck` into the hand. Uses `fallback` when the deck is empty. Fires `onDraw` |

### Turn flow

| Op | Params | Status |
|---|---|---|
| `play` | `min`, `max` | M2. The active player plays cards from their hand. Fires `onDiscard`, then `onPlay` |
| `endRound` | `by: showdown` | M2 |
| `endTurn` | `draw?` | Future (Skip, Attack) |
| `addTurns` | `who`, `count` | Future (Attack) |
| `reverse` | | Future (Reverse) |

### Choices (prompts)

| Op | Params | Status |
|---|---|---|
| `choosePlayer` | `as`, `from`, `holding?` (card id), `auto?`, `includeProtected?` | M2. `auto` skips the prompt when exactly one player fits. Untargetable players are skipped unless `includeProtected` |
| `selectPlayers` | `as`, `from`, `includeProtected?` | M2. No prompt. Stores every fitting player |
| `guess` | `as`, `exclude?` (values) | M2. Pick a card value present in the merged deck. Logged for everyone |
| `choosePosition` | `zone`, `as` | M2. 0 is the top |
| `confirm` | `as`, `text` | M2. Yes or no |
| `chooseCard` | `as`, `from`, `by?` | Future (Favor: the target picks) |
| `nameCard` | `as` | Future (three of a kind) |

### Effects

| Op | Params | Status |
|---|---|---|
| `peek` | `zone`, `count = 1`, `as?` | M2. Shows cards from the top to self only |
| `reveal` | `zone`, `to` (`all` or players) | M2 |
| `swap` | `a`, `b` (single-card zones) | M2. Each previous holder still knows the card they gave away |
| `discard` | `who` | M2. Forced: hand card goes face up in front of them. Fires `onDiscard`, not `onPlay` |
| `compareHands` | `a`, `b`, `as` | M2. Shows each hand to the other player. Stores the lower player, nothing on a tie |
| `eliminate` | `who` | M2. Out for the round. Hand goes face up into `played`, without hooks |
| `status` | `who`, `id`, `until` (`ownNextTurn`, `endOfTurn`, `endOfRound`, `permanent`) | M2 |
| `if` | `cond`, `then`, `else?` | M2 |
| `log` | `text`, `to? = all` | M2 |
| `take` | `from`, `pick` (`random`, `giver`, `taker`, `$card`) | Future (Favor, cat pairs) |
| `cancel` | `what: stackTop` | Future (Nope) |
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
| `{ "anyHandHas": "card-id" }` | Some player still in holds that card. Used at showdown |
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
