# Exploding Kittens: rules as implemented

Exploding Kittens is a game by Exploding Kittens. This file describes how this project
implements the original base game, in our own words, including our decisions where the
rulebook is silent or editions differ. The pack is in `public/packs/exploding-kittens`. Keep the
two in sync.

Marked items:

- **House rule**: decided by us, differs from or adds to the rulebook.
- **Interpretation**: the rulebook does not say, or editions differ, this is our reading.

## Overview

2 to 5 players. On your turn you play as many cards as you like, one at a time or as combos,
then end your turn by drawing a card. Draw an Exploding Kitten and you are out, unless you have
a Defuse. The last player left wins. One game is one round. Rematch starts a new game.

## Deck (56 cards)

| Card | Copies | Action |
|---|---|---|
| Exploding Kitten | 1 fewer than players | You explode when you draw it, unless you Defuse it |
| Defuse | 6 | Saves you from an Exploding Kitten |
| Nope | 5 | Stops a play, any time, by anyone |
| Attack | 4 | End your turn without drawing. The next player takes 2 turns |
| Skip | 4 | End your turn without drawing |
| Favor | 4 | Another player gives you a card of their choice |
| Shuffle | 4 | Shuffle the draw pile |
| See the Future | 5 | Look at the top 3 cards of the draw pile, in secret |
| Tacocat, Cattermelon, Hairy Potato Cat, Beard Cat, Rainbow-Ralphing Cat | 4 each | No action alone, only in combos |

## Setup

1. Put the Exploding Kittens and Defuses aside and shuffle the rest.
2. Deal 7 cards to each player, then 1 Defuse each.
3. Shuffle the remaining Defuses and one Exploding Kitten fewer than there are players into the
   draw pile. With 2 players that is all 4 extra Defuses and 1 kitten. (**Interpretation.**
   Some editions put fewer Defuses back with 2 players.)
4. A random player starts.

## Turn

1. Play cards, as many as you like, one play at a time. Each play waits for its Nope window
   (see below). You may also play nothing.
2. End your turn by drawing the top card of the draw pile, unless a Skip or Attack ended it.

## Cards

- **Exploding Kitten**: when you draw it, everyone sees it. If you have a Defuse, it is played
  for you (**Interpretation**, you would always play it), and you put the kitten back anywhere
  in the draw pile. Position 1 is the top. Only you know where it went. Without a Defuse you
  explode: you are out, and your cards go face up in front of you.
- **After a kitten goes back**: everyone else forgets what they knew of the draw pile (from
  See the Future), since the cards below the kitten moved down by one and their places would
  tell where it went. What they saw stays in their game log. (**House rule.** At a real table
  you would only remember the order, not the places.)
- **Defuse**: only used against an Exploding Kitten. It cannot be played on its own.
- **Nope**: play it while a play's Nope window is open, on anyone's turn, yours included. The
  play does nothing, but its cards stay discarded. A Nope can be Noped, which brings the play
  back. Exploding Kittens and Defuses are not plays and cannot be Noped. Nope cannot be played
  on its own otherwise.
- **Attack**: your turn ends without drawing and the next player takes 2 turns in a row. If
  they Attack during either of those turns, their turns end and the player after them takes
  2 turns. Attacks do not add up. (**Interpretation.** That is the first edition's rule.
  Later editions stack them.)
- **Skip**: ends one turn without drawing. Under an Attack it ends one of the two turns.
- **Favor**: pick a player who has cards. They choose which card they give you. Nobody else
  learns which card it was: whoever knew a card in their hand forgets it.
- **Shuffle**: shuffles the draw pile. Nobody knows where any card is afterwards, including
  kittens someone put back.
- **See the Future**: you see the top 3 cards, top first. Others only see that you looked.
- **Cat cards**: cannot be played alone.

## Combos

Any matching cards count, not only cats (two Skips are a pair too). A combo's cards do not do
their own action.

- **Pair** (2 alike): pick a player with cards and take a random card from them. As with
  Favor, nobody else learns which card it was.
- **Three of a kind** (3 alike): pick a player with cards and name a card. If they have it, they
  give it to you and everyone hears what it was. If not, nothing happens.
- **Five different** (5 cards, all different): take any card from the discard pile, including
  one you just played. (**Interpretation.**)

## Nope window

- Every play opens a window of a few seconds. The host picks the length in the lobby (2 to 10,
  default 4).
- Each Nope restarts the window, so the others can answer it.
- The window always runs its full length, even if nobody holds a Nope, so its length tells
  nobody who has one. (**House rule**, needed for online play.)
- Only you see whether you could Nope right now.

## Winning

When only one player is left, they win the game. If the host takes a player out (they are
away), it counts as exploding without a Defuse.

## Not possible by the rules, handled anyway

- If the draw pile is ever empty, drawing does nothing and the turn ends.
