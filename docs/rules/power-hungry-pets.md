# Power Hungry Pets: rules as implemented

Power Hungry Pets is a game by Exploding Kittens. This file describes how this project
implements it, in our own words, including our decisions where the rulebook is silent. The
pack is in `public/packs/power-hungry-pets`. Keep the two in sync.

Marked items:

- **House rule**: decided by us, differs from or adds to the rulebook.
- **Interpretation**: the rulebook does not say, this is our reading.

## Overview

2 to 6 players (up to 10 with the Big Litter addon). Each player holds one card. On your turn
you draw a second card and play one of the two. The round ends when one player is left or the
draw pile runs out. The round winner gets a token. The first to reach the token target wins.

## Deck (21 cards)

| Value | Card | Copies | Action |
|---|---|---|---|
| 10 | King Cat | 1 | If this card is ever put face up in front of you, you are out |
| 9 | Not A Pet! | 1 | Whoever holds the King Cat trades it for your card |
| 8 | Hermit Home Swap | 1 | Choose a player and trade cards with them |
| 7 | Jittery Juggler | 1 | Every player still in, including you, shuffles their card into the draw pile and gets a new one |
| 6 | Doggy Grave Digger | 1 | Look at the face-down set-aside card. You may swap it with your card |
| 5 | Snake Sorcerer | 2 | Choose a player. They put their card face up without its action and draw a new one |
| 4 | Shell Shield | 2 | Until your next turn, other cards cannot affect you |
| 3 | Battle Bunny | 3 | Choose a player and secretly compare cards. The lower card is out. A tie does nothing |
| 2 | Mouse Trapper | 3 | Look at the top card of the draw pile and put it back anywhere in the pile |
| 1 | Crystal Bowl | 5 | Choose a player and guess their card's number (not 1). If right, they are out |
| 0 | Royal Robovac | 1 | No action. Wins the showdown if the King Cat is in a final hand |

## Round setup

1. Shuffle all cards into the draw pile.
2. Set one card aside face down. With 2 players in the round, also set 2 more aside face up.
3. Deal one card to each player in the round.
4. Round 1: a random player starts. Later rounds: the last round's winner starts.
   (**House rule.** The rulebook does not say who starts later rounds.)

"Players in the round" excludes anyone sitting out, so the 2-player setup applies whenever
exactly two play that round.

## Turn

1. Your Shell Shield protection (if any) ends.
2. If the draw pile is empty, the round ends with a showdown.
3. Draw one card.
4. Play one of your two cards face up in front of you and do its action.

Played cards stay in front of their player for the whole round. There is no shared discard
pile.

## Card details

- **King Cat**: playing it yourself knocks you out. So does being forced to put it face up by
  Snake Sorcerer. The app warns before you play it.
- **Not A Pet!**: only swaps with a player who is still in and not protected. Nothing happens
  if nobody else holds the King Cat. The swap is public, so everyone learns who had it.
  If an addon ever adds a second King Cat, you choose which holder.
- **Hermit Home Swap**: you may only choose players who are still in and not protected.
- **Jittery Juggler**: protected players keep their card. After the cards go back, the draw
  pile is shuffled and each of those players gets one new card.
- **Doggy Grave Digger**: only the face-down set-aside card, never the face-up ones. If that
  card was already taken by Snake Sorcerer, the action does nothing.
- **Snake Sorcerer**: you may choose yourself. (**Interpretation.** The text says "a player
  still in" and does not exclude you.) If their card is the King Cat, they are out and do not
  draw. If the draw pile is empty, they take the face-down set-aside card.
- **Shell Shield**: blocks Crystal Bowl, Battle Bunny, Snake Sorcerer, Jittery Juggler,
  Hermit Home Swap and Not A Pet! against you.
- **Battle Bunny**: only you and the chosen player see both cards. The loser's card is then
  face up anyway.
- **Mouse Trapper**: you choose the position, top is position 1. Only you know where it went.
  Nothing happens if the draw pile is empty.
- **Crystal Bowl**: the guess is public. A wrong guess only tells everyone it was wrong.
  0 is a valid guess.
- **No valid target**: if a card needs a player and every other player is out or protected,
  the card is played with no effect. (**Interpretation.**)

## Knocked out

Your card goes face up in front of you. You take no more turns this round. If only one player
is left, they win the round at once.

## Showdown

When a player cannot draw because the pile is empty, everyone still in reveals their card.

1. The highest value wins.
2. **Royal Robovac**: if the King Cat is in any final hand, the Robovac counts as the highest
   card. Otherwise it is a 0. (**House rule.** The rulebook says it beats only the King Cat,
   which can loop with 3 or more players. Ours cannot.)
3. Tie-break, chosen by the host in the lobby:
   - **Highest played card** (default, matches the rulebook): the tied player with the highest
     single card in front of them wins.
   - **Total of played cards**: the tied player with the highest sum in front of them wins.
4. Still tied: every tied player wins the round. (**House rule.**)

## Tokens and winning

- Each round winner gets one token.
- Tokens to win: 3 with 2 to 3 players, 2 with 4 to 6 players. The host can change it in the
  lobby. It is fixed when the game starts and does not change if someone drops out.
- If several players reach the target in the same round, they play a deciding round among
  themselves. (**House rule.**)

## Disconnects (house rules)

- The game continues until the missing player has to act, then waits.
- The host can kick a player for the round. It works like being knocked out. They keep their
  seat, tokens and chat.
- Someone still away when a round starts sits out that round.

## Big Litter addon (house design)

For 7 to 10 players. Untested balance, adjust after playing.

- More copies: Crystal Bowl 8, Mouse Trapper 5, Battle Bunny 5, Shell Shield 3,
  Snake Sorcerer 3, Hermit Home Swap 2, Jittery Juggler 2. Deck becomes 32 cards.
- King Cat, Not A Pet!, Doggy Grave Digger and Royal Robovac stay unique.
- Tokens to win: 2 for 4 or more players.
