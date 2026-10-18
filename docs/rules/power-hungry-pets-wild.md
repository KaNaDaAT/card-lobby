# Power Hungry Pets, Wild Cards: house addons

An example custom pack in `examples/packs/power-hungry-pets-wild`. It is Power Hungry Pets
(rules in [power-hungry-pets.md](power-hungry-pets.md), unchanged) plus two addons of our own
design. Keep this file and the pack in sync. Balance is untested: change it after playing.

To play it, zip the folder (`npm run zip-pack -- examples/packs/power-hungry-pets-wild`) and
pick the zip with the Custom pack tile in the lobby. Then turn the addons on.

## Off the Scale

Two cards beyond the usual 0 to 10. Both change how the round ends. Deck: 23 cards.

| Value | Card | Copies | Action |
|---|---|---|---|
| ∞ | Galaxy Goldfish | 1 | Higher than any number. If you play it, the showdown happens right now |
| -1 | Backflip Bat | 1 | When it is put face up in front of anyone, the round turns upside down: the lowest card wins the showdown |

- **Galaxy Goldfish**: the showdown runs at once, before anyone draws again, even with cards
  left in the draw pile. You show the card you kept. Held at a showdown, it beats every
  number. It counts as 100 where numbers are added up (the "total of played cards" tie-break)
  and in guesses, where it shows as ∞. Royal Robovac still beats it when someone holds the
  King Cat, because the Robovac then beats every card.
- **Backflip Bat**: works when played and when forced face up (Snake Sorcerer,
  Pillow-Fight Panda), like the King Cat. Not when its holder is knocked out. Once upside
  down, the round stays that way. The table shows "Upside down" while it lasts.
- **Upside down**: only the showdown turns around. Battle Bunny still knocks out the lower
  card, and the tie-break still looks for the highest played card or total. Royal Robovac's
  "highest card" still means it wins. A Galaxy Goldfish in hand is now the worst card to hold.
- With both: play the Bat while you hold something low, or play the Goldfish to end the round
  before anyone can turn it back.

## Second Litter

One new pet for each number from 1 to 8, one copy each. Deck: 29 cards (31 with Off the
Scale). Each new pet's action is about as strong and as risky as the pet it shares a number
with: low pets are cheap to give up, so their actions poke at others; high pets are worth
keeping for the showdown, so playing one has to be worth it.

| Value | Card | Action | Next to |
|---|---|---|---|
| 8 | Haggling Hamster | Choose another player and look at their card. You may trade cards with them | Hermit Home Swap: a trade, but you see first |
| 7 | Penguin Parade | Everyone still in, you included, passes their card to the next player | Jittery Juggler: everyone's card moves |
| 6 | Treasure Magpie | Look at the top card of the draw pile. You may swap it with your card | Doggy Grave Digger: a peek and a swap |
| 5 | Swapsie Squirrel | Choose two other players. They trade cards | Snake Sorcerer: messes with someone else's card |
| 4 | Tunnel Mole | Put your card face down at the bottom of the draw pile and draw a new one | Shell Shield: gets you out of trouble |
| 3 | Pillow-Fight Panda | Choose another player. You both put your card face up without its action and draw a new one | Battle Bunny: a duel that costs you too |
| 2 | Nosy Ferret | Choose another player and secretly look at their card | Mouse Trapper: information |
| 1 | Gossip Parrot | Choose another player. They show their card to everyone | Crystal Bowl: sets up a knockout instead of trying one |

Details:

- **Haggling Hamster**: only you see the card. Everyone knows you looked.
- **Penguin Parade**: in turn order. Shielded players keep their card and are skipped. You
  still know the card you passed on.
- **Treasure Magpie**: if you swap, your old card is on top of the draw pile, so the next
  player draws it. Only you know what it is.
- **Swapsie Squirrel**: you see neither card. The two players each learn the other's card.
  With only two players in, it does nothing.
- **Tunnel Mole**: nobody else learns what you buried, unless they already knew your card.
- **Pillow-Fight Panda**: you go first. If either card is the King Cat, its holder is out and
  does not draw. If the draw pile is empty, the face-down set-aside card is drawn, as with
  Snake Sorcerer.
- **Gossip Parrot**: everyone, spectators too, sees the card. Anyone can aim a Crystal Bowl at it.
- Crystal Bowl still cannot guess 1, Gossip Parrot included.
- Players: same as the base game (2 to 6, or up to 10 with Big Litter).
