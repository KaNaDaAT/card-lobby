/**
 * Power Hungry Pets, card by card, as described in docs/rules/power-hungry-pets.md.
 * `order` is [active player, next, next after that].
 */
import { describe, expect, it } from 'vitest';
import { apply } from './index';
import { petsPack, Table } from './testing';

const pets = petsPack();
const table = (players = 3, seed = 1, options = {}) => new Table(pets, players, seed, options);
const PROTECTED = { id: 'protected', until: 'ownNextTurn' } as const;

describe('round setup', () => {
  it('deals one card each and sets one aside, with two more face up for 2 players', () => {
    const t = table(2);
    const [me, other] = t.order;
    expect(t.s.zones.setAside!.cards).toHaveLength(1);
    expect(t.s.zones.setAsideOpen!.cards).toHaveLength(2);
    expect(t.view(other!).zones.setAsideOpen!.known).toHaveLength(2);
    expect(t.s.zones[`hand:${me}`]!.cards).toHaveLength(2);
    expect(t.s.zones[`hand:${other}`]!.cards).toHaveLength(1);
    expect(t.s.zones.deck!.cards).toHaveLength(21 - 1 - 2 - 2 - 1);
    expect(t.prompt).toMatchObject({ kind: 'play', to: me });
  });

  it('uses no face-up cards with 3 or more players', () => {
    const t = table(3);
    expect(t.s.zones.setAsideOpen!.cards).toHaveLength(0);
    expect(t.s.zones.deck!.cards).toHaveLength(21 - 1 - 3 - 1);
  });

  it('fixes tokens to win by player count, unless the host picked a number', () => {
    expect(table(2).s.tokensToWin).toBe(3);
    expect(table(3).s.tokensToWin).toBe(3);
    expect(table(4).s.tokensToWin).toBe(2);
    expect(table(6).s.tokensToWin).toBe(2);
    expect(table(4, 1, { tokensToWin: 5 }).s.tokensToWin).toBe(5);
    expect(table(4, 1, { tokensToWin: 'auto' }).s.tokensToWin).toBe(2);
  });

  it('starts the first round with a random player, seeded', () => {
    const starters = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((seed) => table(4, seed).s.turn.seat));
    expect(starters.size).toBeGreaterThan(1);
    expect(table(4, 3).s.turn.seat).toBe(table(4, 3).s.turn.seat);
  });
});

describe('cards', () => {
  it('King Cat: playing it knocks you out', () => {
    const t = table();
    const [me, next] = t.order;
    t.rig(`hand:${me}`, ['king-cat', 'crystal-bowl']);
    t.play('king-cat');
    expect(t.s.players[me!]!.round).toBe('out');
    expect(t.cardIds(`played:${me}`)).toEqual(['king-cat', 'crystal-bowl']);
    expect(t.s.turn.seat).toBe(next);
  });

  it('Crystal Bowl: a right guess knocks the target out', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['crystal-bowl', 'mouse-trapper']);
    t.rig(`hand:${a}`, ['snake-sorcerer']);
    t.play('crystal-bowl');
    expect(t.prompt).toMatchObject({ kind: 'choosePlayer', to: me, choices: [a, b], source: 'crystal-bowl' });
    t.answer(a);
    expect(t.prompt).toMatchObject({ kind: 'guess', choices: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    t.answer(5);
    expect(t.s.players[a!]!.round).toBe('out');
    expect(t.log(b!)).toContain(`${t.name(me!)} guesses 5 (Snake Sorcerer).`);
  });

  it('Crystal Bowl: a wrong guess only says it was wrong, and 1 is not allowed', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['crystal-bowl', 'mouse-trapper']);
    t.rig(`hand:${a}`, ['snake-sorcerer']);
    t.play('crystal-bowl');
    t.answer(a);
    expect(t.try({ kind: 'answer', seat: me!, promptId: t.prompt!.id, value: 1 })).toBe('That answer is not allowed.');
    t.answer(6);
    expect(t.s.players[a!]!.round).toBe('in');
    expect(t.log(a!)).toContain(`${t.name(me!)} guessed wrong.`);
  });

  it('Crystal Bowl: with every other player shielded it does nothing', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['crystal-bowl', 'mouse-trapper']);
    t.s.players[a!]!.statuses.push({ ...PROTECTED });
    t.s.players[b!]!.statuses.push({ ...PROTECTED });
    t.play('crystal-bowl');
    expect(t.log()).toContain(`${t.name(me!)} has nobody to choose. Nothing happens.`);
    expect(t.cardIds(`played:${me}`)).toEqual(['crystal-bowl']);
    expect(t.s.turn.seat).toBe(a);
  });

  it('Mouse Trapper: you see the top card and only you know where it went', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['mouse-trapper', 'crystal-bowl']);
    t.rig('deck', ['king-cat']);
    t.play('mouse-trapper');
    expect(t.log(me!)).toContain('You see King Cat.');
    expect(t.log(a!)).not.toContain('You see King Cat.');
    expect(t.prompt).toMatchObject({ kind: 'choosePosition', choices: 16 });
    t.answer(3);
    // The next player has drawn the top card since, so the King Cat sits at index 2 now.
    expect(t.cardIds('deck')[2]).toBe('king-cat');
    expect(t.view(me!).zones.deck!.known.map((k) => [k.index, k.card.cardId])).toEqual([[2, 'king-cat']]);
    expect(t.view(a!).zones.deck!.known).toEqual([]);
    expect(t.log(a!)).toContain(`${t.name(me!)} puts it back somewhere in the draw pile.`);
  });

  it('Mouse Trapper: a card put back in secret makes the others forget where their known cards are', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['mouse-trapper', 'crystal-bowl']);
    t.rig('deck', ['king-cat']);
    t.play('mouse-trapper');
    t.answer(2);
    expect(t.view(me!).zones.deck!.known.map((k) => [k.index, k.card.cardId])).toEqual([[1, 'king-cat']]);
    t.rig(`hand:${a}`, ['mouse-trapper', 'crystal-bowl']);
    t.play('mouse-trapper');
    t.answer(t.s.zones.deck!.cards.length - 1);
    // The King Cat moved up and the next player drew it. Neither may show.
    expect(t.cardIds(`hand:${b}`)).toContain('king-cat');
    expect(t.view(me!).zones.deck!.known).toEqual([]);
    expect(t.seenInHand(me!, b!)).toEqual([]);
    expect(t.view(a!).zones.deck!.known.map((k) => k.index)).toEqual([t.s.zones.deck!.cards.length - 1]);
  });

  it('tells you who knows your card, but not a Mouse Trapper who put it back in secret', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['battle-bunny', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['crystal-bowl']);
    t.play('battle-bunny');
    t.answer(a);
    expect(t.view(me!).hand.map((c) => c.seenBy)).toEqual([[a]]);

    const put = table();
    const [mover, next] = put.order;
    put.rig(`hand:${mover}`, ['mouse-trapper', 'crystal-bowl']);
    put.rig('deck', ['king-cat']);
    put.play('mouse-trapper');
    put.answer(0);
    const drawn = put.view(next!).hand.find((c) => c.cardId === 'king-cat')!;
    expect(put.s.cards[drawn.uid]!.knownBy).toContain(mover);
    expect(drawn.seenBy).toEqual([]);
  });

  it('Mouse Trapper: an empty draw pile means nothing happens', () => {
    const t = table();
    const [me] = t.order;
    t.rig(`hand:${me}`, ['mouse-trapper', 'crystal-bowl']);
    t.drain('deck', 'setAsideOpen');
    t.play('mouse-trapper');
    expect(t.log()).toContain(`${t.name(me!)} has nothing to look at. Nothing happens.`);
  });

  it('Battle Bunny: the lower card is out and only the two players see both cards', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['battle-bunny', 'hermit-home-swap']);
    t.rig(`hand:${a}`, ['crystal-bowl']);
    t.play('battle-bunny');
    t.answer(a);
    expect(t.s.players[a!]!.round).toBe('out');
    expect(t.seenInHand(a!, me!)).toEqual(['hermit-home-swap']);
    expect(t.seenInHand(b!, me!)).toEqual([]);
    expect(t.seenInHand(null, me!)).toEqual([]);
    expect(t.log(me!)).toContain(`${t.name(a!)} has Crystal Bowl.`);
  });

  it('Battle Bunny: a tie does nothing, and you can lose', () => {
    const tie = table();
    const [me, a] = tie.order;
    tie.rig(`hand:${me}`, ['battle-bunny', 'crystal-bowl']);
    tie.rig(`hand:${a}`, ['crystal-bowl']);
    tie.play('battle-bunny');
    tie.answer(a);
    expect(tie.s.players.filter((p) => p.round === 'out')).toHaveLength(0);

    const lose = table();
    const [me2, a2] = lose.order;
    lose.rig(`hand:${me2}`, ['battle-bunny', 'crystal-bowl']);
    lose.rig(`hand:${a2}`, ['king-cat']);
    lose.play('battle-bunny');
    lose.answer(a2);
    expect(lose.s.players[me2!]!.round).toBe('out');
  });

  it('Shell Shield: others cannot pick you until your next turn', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['shell-shield', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['crystal-bowl']);
    t.rig(`hand:${b}`, ['mouse-trapper']);
    t.rig('deck', ['battle-bunny', 'mouse-trapper', 'snake-sorcerer']);
    t.play('shell-shield');
    expect(t.view(a!).players[me!]!.statuses).toEqual(['protected']);
    t.play('crystal-bowl');
    expect(t.prompt).toMatchObject({ kind: 'choosePlayer', choices: [b] });
    t.answer(b);
    t.answer(7);
    t.play('mouse-trapper');
    t.answer(0);
    expect(t.s.turn.seat).toBe(me);
    expect(t.s.players[me!]!.statuses).toEqual([]);
  });

  it('Snake Sorcerer: the target shows their card without its action and draws', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['snake-sorcerer', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['battle-bunny']);
    t.rig('deck', ['hermit-home-swap', 'mouse-trapper']);
    t.play('snake-sorcerer');
    expect(t.prompt).toMatchObject({ kind: 'choosePlayer', choices: [me, a, b] });
    t.answer(a);
    expect(t.cardIds(`played:${a}`)).toEqual(['battle-bunny']);
    // Their new card, then the draw for their own turn.
    expect(t.cardIds(`hand:${a}`)).toEqual(['hermit-home-swap', 'mouse-trapper']);
    expect(t.s.prompt).toMatchObject({ kind: 'play', to: a });
  });

  it('Snake Sorcerer: forcing out the King Cat knocks its holder out, who does not draw', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['snake-sorcerer', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['king-cat']);
    t.play('snake-sorcerer');
    t.answer(a);
    expect(t.s.players[a!]!.round).toBe('out');
    expect(t.cardIds(`hand:${a}`)).toEqual([]);
    expect(t.cardIds(`played:${a}`)).toEqual(['king-cat']);
  });

  it('Snake Sorcerer: you may pick yourself', () => {
    const t = table();
    const [me] = t.order;
    t.rig(`hand:${me}`, ['snake-sorcerer', 'crystal-bowl']);
    t.rig('deck', ['jittery-juggler']);
    t.play('snake-sorcerer');
    t.answer(me);
    expect(t.cardIds(`played:${me}`)).toEqual(['snake-sorcerer', 'crystal-bowl']);
    expect(t.cardIds(`hand:${me}`)).toEqual(['jittery-juggler']);
  });

  it('Snake Sorcerer: with an empty draw pile the target takes the face-down set-aside card', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['snake-sorcerer', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['battle-bunny']);
    t.rig('setAside', ['doggy-grave-digger']);
    t.drain('deck', 'setAsideOpen');
    t.play('snake-sorcerer');
    t.answer(a);
    expect(t.cardIds(`hand:${a}`)).toEqual(['doggy-grave-digger']);
    expect(t.log()).toContain(`${t.name(a!)} takes the face-down set-aside card.`);
  });

  it('Doggy Grave Digger: look at the set-aside card and swap if you like', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['doggy-grave-digger', 'crystal-bowl']);
    t.rig('setAside', ['king-cat']);
    t.play('doggy-grave-digger');
    expect(t.log(me!)).toContain('You see King Cat.');
    expect(t.prompt).toMatchObject({ kind: 'confirm', text: 'Swap your card with the set-aside card?' });
    // The question shows the card you may swap for.
    expect(t.s.cards[t.view(me!).prompt!.card!]!.cardId).toBe('king-cat');
    t.answer(true);
    expect(t.cardIds(`hand:${me}`)).toEqual(['king-cat']);
    expect(t.cardIds('setAside')).toEqual(['crystal-bowl']);
    expect(t.view(me!).zones.setAside!.known.map((k) => k.card.cardId)).toEqual(['crystal-bowl']);
    expect(t.view(a!).zones.setAside!.known).toEqual([]);
  });

  it('Doggy Grave Digger: declining keeps your card, and a taken set-aside card means nothing happens', () => {
    const t = table();
    const [me] = t.order;
    t.rig(`hand:${me}`, ['doggy-grave-digger', 'crystal-bowl']);
    t.play('doggy-grave-digger');
    t.answer(false);
    expect(t.cardIds(`hand:${me}`)).toEqual(['crystal-bowl']);

    const empty = table();
    const [me2] = empty.order;
    empty.rig(`hand:${me2}`, ['doggy-grave-digger', 'crystal-bowl']);
    empty.drain('setAside', 'setAsideOpen');
    empty.play('doggy-grave-digger');
    expect(empty.prompt?.kind).toBe('play');
    expect(empty.s.turn.seat).not.toBe(me2);
  });

  it('Jittery Juggler: everyone not shielded shuffles their card in and gets a new one', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['jittery-juggler', 'crystal-bowl']);
    t.rig(`hand:${b}`, ['king-cat']);
    t.s.players[b!]!.statuses.push({ ...PROTECTED });
    const deckBefore = new Set(t.s.zones.deck!.cards);
    t.s.cards[t.s.zones.deck!.cards[0]!]!.knownBy.push(a!);
    t.play('jittery-juggler');
    expect(t.cardIds(`hand:${b}`)).toEqual(['king-cat']);
    expect(t.s.zones[`hand:${me}`]!.cards).toHaveLength(1);
    // One new card from the juggle, one from the draw that starts their turn.
    expect(t.s.zones[`hand:${a}`]!.cards).toHaveLength(2);
    expect(t.s.zones.deck!.cards).toHaveLength(15);
    const deck = t.s.zones.deck!.cards;
    expect(deck.some((uid) => deckBefore.has(uid))).toBe(false);
    expect(deck.every((uid) => t.s.cards[uid]!.knownBy.length === 0)).toBe(true);
  });

  it('Hermit Home Swap: trade cards, and each side knows what they gave away', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['hermit-home-swap', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['king-cat']);
    t.play('hermit-home-swap');
    expect(t.prompt).toMatchObject({ kind: 'choosePlayer', choices: [a, b] });
    t.answer(a);
    expect(t.cardIds(`hand:${me}`)).toEqual(['king-cat']);
    expect(t.cardIds(`hand:${a}`)[0]).toBe('crystal-bowl');
    expect(t.seenInHand(me!, a!)).toEqual(['crystal-bowl']);
    expect(t.seenInHand(a!, me!)).toEqual(['king-cat']);
    expect(t.seenInHand(b!, me!)).toEqual([]);
    expect(t.seenInHand(b!, a!)).toEqual([]);
  });

  it('Not A Pet!: the King Cat holder trades it for your card, in public', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['not-a-pet', 'crystal-bowl']);
    t.rig(`hand:${b}`, ['king-cat']);
    t.play('not-a-pet');
    expect(t.cardIds(`hand:${me}`)).toEqual(['king-cat']);
    expect(t.cardIds(`hand:${b}`)).toEqual(['crystal-bowl']);
    expect(t.seenInHand(a!, me!)).toEqual(['king-cat']);
    expect(t.seenInHand(null, me!)).toEqual(['king-cat']);
    expect(t.seenInHand(a!, b!)).toEqual([]);
    expect(t.log(a!)).toContain(`${t.name(b!)}'s card: King Cat.`);
  });

  it('Not A Pet!: nothing happens when nobody else holds the King Cat or its holder is shielded', () => {
    const t = table();
    const [me] = t.order;
    t.rig(`hand:${me}`, ['not-a-pet', 'crystal-bowl']);
    t.rig('deck', ['king-cat']);
    t.play('not-a-pet');
    expect(t.log()).toContain(`${t.name(me!)} has nobody to choose. Nothing happens.`);

    const shielded = table();
    const [me2, a2] = shielded.order;
    shielded.rig(`hand:${me2}`, ['not-a-pet', 'crystal-bowl']);
    shielded.rig(`hand:${a2}`, ['king-cat']);
    shielded.s.players[a2!]!.statuses.push({ ...PROTECTED });
    shielded.play('not-a-pet');
    expect(shielded.cardIds(`hand:${a2}`)[0]).toBe('king-cat');
  });
});

/** Stages a showdown: the active player plays Shell Shield, then the next turn finds the pile empty. */
function showdown(hands: string[][], played: string[][] = [], options = {}) {
  const t = table(3, 1, options);
  const order = t.order;
  t.rig(`hand:${order[0]}`, ['shell-shield', ...hands[0]!]);
  order.slice(1).forEach((seat, i) => t.rig(`hand:${seat}`, hands[i + 1]!));
  played.forEach((cards, i) => cards.forEach((c) => t.place(`played:${order[i]}`, c)));
  t.drain('deck', 'setAsideOpen');
  t.play('shell-shield');
  return { t, order };
}

describe('showdown', () => {
  it('ends the round when the draw pile is empty and the highest card wins', () => {
    const { t, order } = showdown([['crystal-bowl'], ['hermit-home-swap'], ['battle-bunny']]);
    expect(t.s.phase).toBe('roundOver');
    expect(t.s.result).toMatchObject({ by: 'showdown', winners: [order[1]] });
    expect(t.s.players[order[1]!]!.tokens).toBe(1);
  });

  it('Royal Robovac counts highest when the King Cat is in a final hand', () => {
    const { t, order } = showdown([['royal-robovac'], ['king-cat'], ['battle-bunny']]);
    expect(t.s.result?.winners).toEqual([order[0]]);
    expect(t.s.result?.showdown?.find((e) => e.seat === order[0])?.value).toBe('highest');
  });

  it('Royal Robovac is a 0 otherwise', () => {
    const { t, order } = showdown([['royal-robovac'], ['crystal-bowl'], ['battle-bunny']]);
    expect(t.s.result?.winners).toEqual([order[2]]);
  });

  it('breaks ties by the highest played card, or by the total', () => {
    // Order 0 holds Crystal Bowl. Orders 1 and 2 tie with Battle Bunny.
    const played = [[], ['snake-sorcerer'], ['mouse-trapper', 'shell-shield']];
    const high = showdown([['crystal-bowl'], ['battle-bunny'], ['battle-bunny']], played);
    expect(high.t.s.result?.winners).toEqual([high.order[1]]);
    expect(high.t.s.result?.tieBreak?.rule).toBe('highestPlayed');

    const sum = showdown([['crystal-bowl'], ['battle-bunny'], ['battle-bunny']], played, { tieBreak: 'sumPlayed' });
    expect(sum.t.s.result?.winners).toEqual([sum.order[2]]);
  });

  it('lets every player still tied win the round', () => {
    const played = [[], ['mouse-trapper'], ['mouse-trapper']];
    const { t, order } = showdown([['crystal-bowl'], ['battle-bunny'], ['battle-bunny']], played);
    expect(t.s.result?.winners).toEqual([order[1], order[2]].sort());
    expect(t.s.players.map((p) => p.tokens).sort()).toEqual([0, 1, 1]);
  });

  it('shows the final hands and the set-aside card to everyone', () => {
    const { t, order } = showdown([['crystal-bowl'], ['hermit-home-swap'], ['battle-bunny']]);
    expect(t.seenInHand(order[2]!, order[1]!)).toEqual(['hermit-home-swap']);
    expect(t.seenInHand(null, order[0]!)).toEqual(['crystal-bowl']);
    expect(t.view(order[2]!).zones.setAside!.known).toHaveLength(1);
  });
});

describe('rounds and the game', () => {
  it('ends the round as soon as one player is left', () => {
    const t = table(2);
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['crystal-bowl', 'mouse-trapper']);
    t.rig(`hand:${a}`, ['battle-bunny']);
    t.play('crystal-bowl');
    t.answer(a);
    t.answer(3);
    expect(t.s.phase).toBe('roundOver');
    expect(t.s.result).toMatchObject({ by: 'lastStanding', winners: [me] });
    expect(t.s.players[me!]!.tokens).toBe(1);
  });

  it('lets the last winner start the next round', () => {
    const t = table(3);
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['king-cat', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['battle-bunny']);
    t.rig(`hand:${b}`, ['crystal-bowl']);
    t.play('king-cat');
    t.play('battle-bunny');
    t.answer(b);
    expect(t.s.result?.winners).toEqual([a]);
    t.input({ kind: 'nextRound' });
    expect(t.s.round).toBe(2);
    expect(t.s.turn.seat).toBe(a);
    expect(t.s.players.every((p) => p.round === 'in')).toBe(true);
  });

  it('ends the game when someone reaches the target', () => {
    const t = table(2);
    const [me, a] = t.order;
    t.s.players[me!]!.tokens = 2;
    t.rig(`hand:${me}`, ['crystal-bowl', 'mouse-trapper']);
    t.rig(`hand:${a}`, ['battle-bunny']);
    t.play('crystal-bowl');
    t.answer(a);
    t.answer(3);
    expect(t.s.phase).toBe('gameOver');
    expect(t.s.winners).toEqual([me]);
    expect(t.try({ kind: 'nextRound' })).toBe('The round is not over.');
  });

  it('plays a deciding round when several players reach the target together', () => {
    const played = [[], ['mouse-trapper'], ['mouse-trapper']];
    const { t, order } = showdown([['crystal-bowl'], ['battle-bunny'], ['battle-bunny']], played);
    // Rewind the tokens to just before the shared win, then score again.
    expect(t.s.phase).toBe('roundOver');
    const s = t.s;
    s.players[order[1]!]!.tokens = 3;
    s.players[order[2]!]!.tokens = 3;
    s.deciding = [order[1]!, order[2]!].sort();
    t.input({ kind: 'nextRound' });
    expect(t.s.players[order[0]!]!.round).toBe('sittingOut');
    expect(t.s.zones.setAsideOpen!.cards).toHaveLength(2);
    expect(t.log()).toContain(`Deciding round: ${[order[1]!, order[2]!].sort().map((x) => t.name(x)).join(' and ')}.`);
  });

  it('detects a tie at the target and sets up the deciding round', () => {
    const played = [[], ['mouse-trapper'], ['mouse-trapper']];
    const t = table(3);
    const order = t.order;
    t.s.players[order[1]!]!.tokens = 2;
    t.s.players[order[2]!]!.tokens = 2;
    t.rig(`hand:${order[0]}`, ['shell-shield', 'crystal-bowl']);
    t.rig(`hand:${order[1]}`, ['battle-bunny']);
    t.rig(`hand:${order[2]}`, ['battle-bunny']);
    played.forEach((cards, i) => cards.forEach((c) => t.place(`played:${order[i]}`, c)));
    t.drain('deck', 'setAsideOpen');
    t.play('shell-shield');
    expect(t.s.phase).toBe('roundOver');
    expect(t.s.deciding).toEqual([order[1], order[2]].sort());
  });

  it('lets the host take a player out for the round, even mid-turn', () => {
    const t = table(3);
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['crystal-bowl', 'mouse-trapper']);
    t.play('crystal-bowl');
    expect(t.prompt?.kind).toBe('choosePlayer');
    t.input({ kind: 'kickForRound', seat: me! });
    expect(t.s.players[me!]!.round).toBe('out');
    expect(t.cardIds(`played:${me}`)).toEqual(['crystal-bowl', 'mouse-trapper']);
    expect(t.prompt).toMatchObject({ kind: 'play', to: a });
    expect(t.log()).toContain(`The host took ${t.name(me!)} out of this round.`);
  });

  it('sits out players who are away when a round starts', () => {
    const t = table(3);
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['king-cat', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['battle-bunny']);
    t.rig(`hand:${b}`, ['crystal-bowl']);
    t.play('king-cat');
    t.play('battle-bunny');
    t.answer(b);
    t.input({ kind: 'connection', seat: b!, connected: false });
    t.input({ kind: 'connection', seat: me!, connected: false });
    expect(t.try({ kind: 'nextRound' })).toBe(`Waiting for ${[me!, b!].sort().map((x) => t.name(x)).join(' and ')} to come back.`);
    t.input({ kind: 'connection', seat: me!, connected: true });
    t.input({ kind: 'nextRound' });
    expect(t.s.players[b!]!.round).toBe('sittingOut');
    expect(t.s.zones.setAsideOpen!.cards).toHaveLength(2);
    expect(t.log()).toContain(`${t.name(b!)} sits out this round.`);
  });
});

describe('inputs and views', () => {
  it('refuses answers from the wrong seat, for old prompts, or with bad values', () => {
    const t = table(3);
    const [me, a] = t.order;
    const p = t.prompt!;
    expect(t.try({ kind: 'answer', seat: a!, promptId: p.id, value: [] })).toBe('It is not your turn to answer.');
    expect(t.try({ kind: 'answer', seat: me!, promptId: 'p0', value: [] })).toBe('That question is no longer open.');
    expect(t.try({ kind: 'answer', seat: me!, promptId: p.id, value: ['nope'] })).toBe('That answer is not allowed.');
    expect(t.try({ kind: 'answer', seat: me!, promptId: p.id, value: [] })).toBe('That answer is not allowed.');
    expect(t.try({ kind: 'timeout', now: 0 })).toBe('No reaction window is open.');
    expect(t.try({ kind: 'react', seat: me!, uid: p.kind === 'play' ? p.choices[0]! : '', now: 0 })).toBe('There is nothing to react to.');
  });

  it('never changes the state it was given', () => {
    const t = table(3);
    const before = JSON.stringify(t.s);
    const p = t.prompt!;
    if (p.kind !== 'play') throw new Error('expected a play prompt');
    apply(pets, t.s, { kind: 'answer', seat: p.to, promptId: p.id, value: [p.choices[0]] });
    expect(JSON.stringify(t.s)).toBe(before);
  });

  it('sends the prompt only to its player and tells everyone who the game waits on', () => {
    const t = table(3);
    const [me, a] = t.order;
    expect(t.view(me!).prompt?.kind).toBe('play');
    expect(t.view(a!).prompt).toBeNull();
    expect(t.view(a!).waiting).toEqual({ seat: me, kind: 'play' });
    expect(t.view(null).hand).toEqual([]);
    expect(t.view(null).you).toBeNull();
  });

  it('keeps private log lines private', () => {
    const t = table(3);
    const [me, a] = t.order;
    const mine = t.view(me!).log.filter((e) => e.private).map((e) => e.text);
    expect(mine.some((text) => text.startsWith('You drew'))).toBe(true);
    expect(t.view(a!).log.some((e) => e.text.startsWith('You drew'))).toBe(false);
    expect(t.view(null).log.every((e) => !e.private)).toBe(true);
  });

  it('resumes mid-effect from a saved copy with the same result', () => {
    const t = table(3);
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['crystal-bowl', 'mouse-trapper']);
    t.rig(`hand:${a}`, ['snake-sorcerer']);
    t.play('crystal-bowl');
    t.answer(a);
    const saved = JSON.parse(JSON.stringify(t.s));
    const p = t.prompt!;
    const live = apply(pets, t.s, { kind: 'answer', seat: me!, promptId: p.id, value: 5 });
    const resumed = apply(pets, saved, { kind: 'answer', seat: me!, promptId: p.id, value: 5 });
    expect(JSON.stringify(resumed.state)).toBe(JSON.stringify(live.state));
    expect(resumed.state.players[a!]!.round).toBe('out');
  });
});
