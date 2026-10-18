/**
 * Exploding Kittens, card by card, as described in docs/rules/exploding-kittens.md.
 * `order` is [active player, next, next after that]. Every play waits out its Nope window.
 */
import { describe, expect, it } from 'vitest';
import { apply } from './index';
import { kittens, Table } from './testing';

const table = (players = 3, seed = 1) => new Table(kittens, players, seed);
const FILLER = ['skip', 'attack', 'favor', 'shuffle', 'see-the-future', 'beard-cat', 'cattermelon'];
/** A hand of 8 that starts with `cards` and has no Nope or Defuse unless asked for. */
const hand = (...cards: string[]) => [...cards, ...FILLER].slice(0, 8);

describe('setup', () => {
  it('deals 7 cards and a Defuse to everyone, then shuffles in the rest and one kitten less than players', () => {
    const t = table(3);
    for (const p of t.s.players) {
      const cards = t.cardIds(`hand:${p.seat}`);
      expect(cards).toHaveLength(8);
      expect(cards.filter((c) => c === 'defuse')).toHaveLength(1);
      expect(cards).not.toContain('exploding-kitten');
    }
    const deck = t.cardIds('deck');
    expect(deck).toHaveLength(46 - 21 + 3 + 2);
    expect(deck.filter((c) => c === 'exploding-kitten')).toHaveLength(2);
    expect(t.s.zones.box!.cards).toEqual([]);
  });

  it('asks the active player to play cards or pass, with cat cards only in combos', () => {
    const t = table(3);
    const p = t.prompt!;
    if (p.kind !== 'play') throw new Error('expected a play prompt');
    expect(p).toMatchObject({ min: 0, max: 5, to: t.order[0] });
    expect(p.combos.map((c) => c.name)).toEqual(['Pair', 'Three of a kind', 'Five different']);
    for (const uid of p.alone) expect(['defuse', 'nope', 'tacocat', 'beard-cat']).not.toContain(t.s.cards[uid]!.cardId);
  });
});

describe('turns', () => {
  it('ends the turn by drawing a card when the player passes', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig('deck', ['tacocat']);
    t.pass();
    expect(t.cardIds(`hand:${me}`)).toHaveLength(9);
    expect(t.s.turn.seat).toBe(a);
  });

  it('Skip: ends the turn without drawing, after the Nope window', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, hand('skip'));
    t.play('skip');
    expect(t.view(b!).window).toMatchObject({ seat: me, remainingMs: 4000, canceled: false });
    expect(t.prompt).toBeNull();
    t.closeWindow();
    expect(t.s.turn.seat).toBe(a);
    expect(t.cardIds(`hand:${me}`)).toHaveLength(7);
    expect(t.cardIds('discard')).toEqual(['skip']);
  });

  it('Attack: the next player takes two turns, and an Attack on them passes two turns on', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, hand('attack'));
    t.rig(`hand:${a}`, hand('attack'));
    t.rig('deck', ['tacocat', 'beard-cat', 'shuffle', 'favor']);
    t.play('attack');
    t.closeWindow();
    expect(t.s.turn.seat).toBe(a);
    expect(t.s.turn.owed[a!]).toBe(1);
    t.pass();
    expect(t.s.turn.seat).toBe(a);
    expect(t.log()).toContain(`${t.name(a!)} takes another turn.`);
    t.play('attack');
    t.closeWindow();
    expect(t.s.turn.seat).toBe(b);
    expect(t.s.turn.owed).toEqual(t.s.players.map((p) => (p.seat === b ? 1 : 0)));
  });

  it('keeps asking until the player passes', () => {
    const t = table();
    const [me] = t.order;
    t.rig(`hand:${me}`, hand('shuffle', 'see-the-future'));
    t.play('shuffle');
    t.closeWindow();
    expect(t.prompt).toMatchObject({ kind: 'play', to: me });
    t.play('see-the-future');
    t.closeWindow();
    expect(t.prompt).toMatchObject({ kind: 'play', to: me });
  });
});

describe('Nope', () => {
  it('stops a play, and a second Nope brings it back', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, hand('skip'));
    t.rig(`hand:${a}`, hand('nope'));
    t.rig(`hand:${b}`, hand('nope'));
    t.play('skip');
    expect(t.view(a!).reactWith).toHaveLength(1);
    expect(t.view(me!).reactWith).toEqual([]);
    expect(t.view(null).reactWith).toEqual([]);

    t.now = 1000;
    t.react(a!, 'nope');
    expect(t.s.stack[0]).toMatchObject({ canceled: true, endsAt: 5000, reactions: 1 });
    expect(t.log()).toContain(`${t.name(me!)}'s Skip is stopped.`);
    t.now = 2000;
    t.react(b!, 'nope');
    expect(t.s.stack[0]).toMatchObject({ canceled: false, endsAt: 6000 });
    t.closeWindow();
    expect(t.s.turn.seat).toBe(a);
    expect(t.cardIds('discard')).toEqual(['skip', 'nope', 'nope']);
  });

  it('leaves the player on turn when their play was stopped', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, hand('skip'));
    t.rig(`hand:${a}`, hand('nope'));
    t.play('skip');
    t.react(a!, 'nope');
    t.closeWindow();
    expect(t.prompt).toMatchObject({ kind: 'play', to: me });
  });

  it('refuses late reactions and cards that cannot react', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, hand('skip'));
    t.rig(`hand:${a}`, hand('nope', 'shuffle'));
    t.play('skip');
    const shuffle = t.s.zones[`hand:${a}`]!.cards.find((u) => t.s.cards[u]!.cardId === 'shuffle')!;
    expect(t.try({ kind: 'react', seat: a!, uid: shuffle, now: 10 })).toBe('Shuffle cannot be played now.');
    const nope = t.s.zones[`hand:${a}`]!.cards.find((u) => t.s.cards[u]!.cardId === 'nope')!;
    expect(t.try({ kind: 'react', seat: a!, uid: nope, now: 4000 })).toBe('Too late.');
    expect(t.try({ kind: 'timeout', now: 3999 })).toBe('The reaction window is still open.');
  });
});

describe('Exploding Kitten', () => {
  it('is defused and put back anywhere, and only its player knows where', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig('deck', ['exploding-kitten']);
    t.pass();
    expect(t.log()).toEqual(expect.arrayContaining([`${t.name(me!)} drew an Exploding Kitten!`, `${t.name(me!)} defuses it.`]));
    expect(t.prompt).toMatchObject({ kind: 'choosePosition', to: me, choices: 30 });
    t.answer(2);
    expect(t.cardIds('deck')[2]).toBe('exploding-kitten');
    expect(t.view(me!).zones.deck!.known.map((k) => [k.index, k.card.cardId])).toEqual([[2, 'exploding-kitten']]);
    expect(t.view(a!).zones.deck!.known).toEqual([]);
    expect(t.view(null).zones.deck!.known).toEqual([]);
    expect(t.cardIds(`hand:${me}`)).not.toContain('defuse');
    expect(t.cardIds('discard')).toEqual(['defuse']);
    expect(t.s.turn.seat).toBe(a);
  });

  it('can go back to the very bottom', () => {
    const t = table();
    t.rig('deck', ['exploding-kitten']);
    t.pass();
    t.answer(29);
    expect(t.cardIds('deck').at(-1)).toBe('exploding-kitten');
  });

  it('knocks out a player without a Defuse, which ends a two-player game', () => {
    const t = table(2);
    const [me, a] = t.order;
    t.rig(`hand:${me}`, hand('skip', 'attack'));
    t.rig('deck', ['exploding-kitten']);
    t.pass();
    expect(t.log()).toContain(`${t.name(me!)} explodes!`);
    expect(t.s.phase).toBe('gameOver');
    expect(t.s.winners).toEqual([a]);
  });
});

describe('taking cards', () => {
  it('Favor: the target picks the card they give', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, hand('favor'));
    t.rig(`hand:${a}`, hand('beard-cat'));
    t.play('favor');
    t.closeWindow();
    t.answer(a);
    expect(t.prompt).toMatchObject({ kind: 'chooseCard', to: a, source: 'favor', text: `pick a card to give ${t.name(me!)}.` });
    const gift = t.s.zones[`hand:${a}`]!.cards.find((u) => t.s.cards[u]!.cardId === 'beard-cat')!;
    t.answer(gift);
    expect(t.s.zones[`hand:${me}`]!.cards).toContain(gift);
    expect(t.cardIds(`hand:${a}`)).toHaveLength(7);
    expect(t.log(me!)).toContain('You got Beard Cat.');
    expect(t.log(a!)).toContain(`${t.name(me!)} took your Beard Cat.`);
    expect(t.prompt).toMatchObject({ kind: 'play', to: me });
  });

  it('Pair: steals a random card', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, hand('tacocat', 'tacocat'));
    t.playCards(['tacocat', 'tacocat']);
    expect(t.log()).toContain(`${t.name(me!)} plays Tacocat and Tacocat (pair).`);
    t.closeWindow();
    expect(t.prompt).toMatchObject({ kind: 'choosePlayer', combo: 'Pair' });
    t.answer(a);
    expect(t.cardIds(`hand:${me}`)).toHaveLength(7);
    expect(t.cardIds(`hand:${a}`)).toHaveLength(7);
  });

  it('Three of a kind: names a card, which the target gives if they have it', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, hand('tacocat', 'tacocat', 'tacocat'));
    t.rig(`hand:${a}`, ['nope', 'skip', 'skip', 'attack', 'attack', 'shuffle', 'cattermelon', 'cattermelon']);
    t.playCards(['tacocat', 'tacocat', 'tacocat']);
    t.closeWindow();
    t.answer(a);
    expect(t.prompt).toMatchObject({ kind: 'nameCard' });
    t.answer('nope');
    expect(t.log()).toContain(`${t.name(a!)} gives ${t.name(me!)} Nope.`);
    expect(t.cardIds(`hand:${me}`)).toContain('nope');

    const miss = table();
    const [me2, a2] = miss.order;
    miss.rig(`hand:${me2}`, hand('tacocat', 'tacocat', 'tacocat'));
    miss.rig(`hand:${a2}`, ['nope', 'skip', 'skip', 'attack', 'attack', 'shuffle', 'cattermelon', 'cattermelon']);
    miss.playCards(['tacocat', 'tacocat', 'tacocat']);
    miss.closeWindow();
    miss.answer(a2);
    miss.answer('favor');
    expect(miss.log()).toContain(`${miss.name(a2!)} has no Favor. Nothing happens.`);
  });

  it('Five different: takes any card from the discard pile', () => {
    const t = table();
    const [me] = t.order;
    const five = ['tacocat', 'cattermelon', 'beard-cat', 'hairy-potato-cat', 'rainbow-ralphing-cat'];
    t.rig(`hand:${me}`, [...five, 'skip', 'attack', 'shuffle']);
    t.playCards(five);
    t.closeWindow();
    expect(t.prompt).toMatchObject({ kind: 'chooseCard', to: me });
    const pick = t.s.zones.discard!.cards.find((u) => t.s.cards[u]!.cardId === 'beard-cat')!;
    t.answer(pick);
    expect(t.cardIds(`hand:${me}`)).toContain('beard-cat');
    expect(t.cardIds('discard')).toHaveLength(4);
  });

  it('only allows plays that are a single card or a combo', () => {
    const t = table();
    const [me] = t.order;
    t.rig(`hand:${me}`, ['tacocat', 'tacocat', 'tacocat', 'tacocat', 'beard-cat', 'nope', 'nope', 'skip']);
    const tryPlay = (ids: string[]) => t.try({ kind: 'answer', seat: me!, promptId: t.prompt!.id, value: t.uidsFor(ids), now: 0 });
    expect(tryPlay(['tacocat'])).toBe('That answer is not allowed.');
    expect(tryPlay(['nope'])).toBe('That answer is not allowed.');
    expect(tryPlay(['tacocat', 'beard-cat'])).toBe('That answer is not allowed.');
    expect(tryPlay(['tacocat', 'tacocat', 'tacocat', 'tacocat'])).toBe('That answer is not allowed.');
    expect(tryPlay(['nope', 'nope'])).toBeUndefined();
  });
});

describe('other cards', () => {
  it('See the Future: shows the top three cards in order, to the player only', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, hand('see-the-future'));
    t.rig('deck', ['skip', 'nope', 'tacocat']);
    t.play('see-the-future');
    t.closeWindow();
    expect(t.log(me!)).toContain('You see, from the top: Skip, Nope, Tacocat.');
    expect(t.log(a!)).toContain(`${t.name(me!)} looks at the top 3 cards of the draw pile.`);
    expect(t.log(a!).some((l) => l.startsWith('You see'))).toBe(false);
  });

  it('Shuffle: renews every card in the draw pile', () => {
    const t = table();
    const [me] = t.order;
    t.rig(`hand:${me}`, hand('shuffle'));
    const before = new Set(t.s.zones.deck!.cards);
    t.play('shuffle');
    t.closeWindow();
    expect(t.s.zones.deck!.cards.some((u) => before.has(u))).toBe(false);
  });
});

describe('saving and kicking', () => {
  it('resumes in the middle of a Nope window', () => {
    const t = table();
    const [me] = t.order;
    t.rig(`hand:${me}`, hand('skip'));
    t.play('skip');
    const saved = JSON.parse(JSON.stringify(t.s));
    const live = apply(kittens, t.s, { kind: 'timeout', now: 4000 });
    const resumed = apply(kittens, saved, { kind: 'timeout', now: 4000 });
    expect(JSON.stringify(resumed.state)).toBe(JSON.stringify(live.state));
  });

  it('drops the open window when the host takes the active player out', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, hand('skip'));
    t.play('skip');
    t.input({ kind: 'kickForRound', seat: me! });
    expect(t.s.stack).toEqual([]);
    expect(t.prompt).toMatchObject({ kind: 'play', to: a });
  });
});
