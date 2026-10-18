/**
 * The example addons for Power Hungry Pets in examples/addons, Off the Scale and Second
 * Litter, card by card, as described in docs/rules/power-hungry-pets-addons.md. `order` is
 * [active player, next, next after that].
 */
import { describe, expect, it } from 'vitest';
import { Table, wildPack } from './testing';

const wild = wildPack();
const table = (players = 3, seed = 1) => new Table(wild, players, seed);
const PROTECTED = { id: 'protected', until: 'ownNextTurn' } as const;

/** Stages a showdown on the next turn: the active player holds `mine` plus the card to play. */
function stage(t: Table, play: string, hands: string[][]) {
  const order = t.order;
  t.rig(`hand:${order[0]}`, [play, ...hands[0]!]);
  order.slice(1).forEach((seat, i) => t.rig(`hand:${seat}`, hands[i + 1]!));
  t.drain('deck', 'setAsideOpen');
  t.play(play);
  return order;
}

describe('Off the Scale', () => {
  it('Backflip Bat: playing it turns the round upside down, so the lowest card wins', () => {
    const t = table();
    const [me, a] = stage(t, 'backflip-bat', [['crystal-bowl'], ['hermit-home-swap'], ['battle-bunny']]);
    expect(t.s.result).toMatchObject({ by: 'showdown', winners: [me], lowestWins: true });
    expect(t.view(a!).flags).toEqual(['upsideDown']);
    expect(t.log()).toContain('The round turns upside down! The lowest card wins the showdown.');
    expect(t.log()).toContain('The lowest card wins.');
  });

  it('Backflip Bat: whoever plays it shows everyone the card they keep', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['backflip-bat', 'crystal-bowl']);
    t.play('backflip-bat');
    expect(t.seenInHand(a!, me!)).toEqual(['crystal-bowl']);
    expect(t.seenInHand(b!, me!)).toEqual(['crystal-bowl']);
  });

  it('Backflip Bat: the second one turns the round back', () => {
    const t = table();
    const [me] = t.order;
    t.s.flags = ['upsideDown'];
    t.rig(`hand:${me}`, ['backflip-bat', 'crystal-bowl']);
    t.play('backflip-bat');
    expect(t.s.flags).toEqual([]);
    expect(t.log()).toContain('The round flips back. The highest card wins the showdown again.');
  });

  it('Backflip Bat: put face up by Snake Sorcerer, it turns the round too', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['snake-sorcerer', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['backflip-bat']);
    t.play('snake-sorcerer');
    t.answer(a);
    expect(t.cardIds(`played:${a}`)).toEqual(['backflip-bat']);
    expect(t.s.flags).toEqual(['upsideDown']);
  });

  it('Backflip Bat: knocked out while holding it, nothing turns', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['crystal-bowl', 'mouse-trapper']);
    t.rig(`hand:${a}`, ['backflip-bat']);
    t.play('crystal-bowl');
    t.answer(a);
    expect(t.prompt).toMatchObject({ kind: 'guess' });
    const guesses = (t.prompt as { choices: number[] }).choices;
    expect(guesses).toContain(-1);
    expect(guesses).toContain(100);
    expect(guesses).not.toContain(1);
    t.answer(-1);
    expect(t.s.players[a!]!.round).toBe('out');
    expect(t.log()).toContain(`${t.name(me!)} guesses -1 (Backflip Bat).`);
    expect(t.s.flags).toEqual([]);
  });

  it('upside down, Royal Robovac still beats every card when someone holds the King Cat', () => {
    const t = table();
    t.s.flags = ['upsideDown'];
    const [me] = stage(t, 'shell-shield', [['royal-robovac'], ['king-cat'], ['crystal-bowl']]);
    expect(t.s.result).toMatchObject({ winners: [me], lowestWins: true });
  });

  it('Galaxy Goldfish: last call gives everyone else one more turn, then the showdown', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['galaxy-goldfish', 'hermit-home-swap']);
    t.rig(`hand:${a}`, ['battle-bunny']);
    t.rig(`hand:${b}`, ['crystal-bowl']);
    t.rig('deck', ['shell-shield', 'shell-shield', 'mouse-trapper']);
    t.play('galaxy-goldfish');
    expect(t.s.phase).toBe('round');
    expect(t.view(a!).players[me!]!.statuses).toEqual(['lastCall']);
    expect(t.log()).toContain('Last call! Everyone else takes one more turn, then the showdown.');
    t.play('shell-shield');
    t.play('shell-shield');
    // The showdown comes instead of the caller's turn: no draw.
    expect(t.s.phase).toBe('roundOver');
    expect(t.s.result).toMatchObject({ by: 'showdown', winners: [me] });
    expect(t.cardIds('deck')[0]).toBe('mouse-trapper');
    expect(t.log()).toContain('Last call is over.');
    expect(t.log()).not.toContain('The draw pile is empty. Showdown!');
  });

  it('Galaxy Goldfish: knocking out the caller stops last call', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['galaxy-goldfish', 'hermit-home-swap']);
    t.rig(`hand:${a}`, ['crystal-bowl']);
    t.rig(`hand:${b}`, ['battle-bunny']);
    t.rig('deck', ['shell-shield', 'shell-shield', 'mouse-trapper']);
    t.play('galaxy-goldfish');
    t.play('crystal-bowl');
    t.answer(me);
    t.answer(8);
    expect(t.s.players[me!]!.round).toBe('out');
    t.play('shell-shield');
    // The caller's turn is skipped, and the round goes on.
    expect(t.s.phase).toBe('round');
    expect(t.prompt).toMatchObject({ kind: 'play', to: a });
  });

  it('Galaxy Goldfish: held at the showdown, it beats every number', () => {
    const t = table();
    const order = stage(t, 'shell-shield', [['crystal-bowl'], ['king-cat'], ['galaxy-goldfish']]);
    expect(t.s.result).toMatchObject({ winners: [order[2]] });
    expect(t.s.result?.showdown?.find((e) => e.seat === order[2])?.value).toBe(100);
  });

  it('Galaxy Goldfish: upside down, it is the worst card to hold', () => {
    const t = table();
    t.s.flags = ['upsideDown'];
    const order = stage(t, 'shell-shield', [['king-cat'], ['galaxy-goldfish'], ['hermit-home-swap']]);
    expect(t.s.result).toMatchObject({ winners: [order[2]] });
  });

  it('Galaxy Goldfish: a guess names it as ∞', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['crystal-bowl', 'mouse-trapper']);
    t.rig(`hand:${a}`, ['galaxy-goldfish']);
    t.play('crystal-bowl');
    t.answer(a);
    t.answer(100);
    expect(t.s.players[a!]!.round).toBe('out');
    expect(t.log()).toContain(`${t.name(me!)} guesses ∞ (Galaxy Goldfish).`);
  });

  it('flags clear when the next round starts', () => {
    const t = table();
    stage(t, 'backflip-bat', [['crystal-bowl'], ['hermit-home-swap'], ['battle-bunny']]);
    t.input({ kind: 'nextRound' });
    expect(t.s.flags).toEqual([]);
    expect(t.view(0).flags).toEqual([]);
  });
});

describe('Second Litter', () => {
  it('Gossip Parrot: the target shows their card to everyone', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['gossip-parrot', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['king-cat']);
    t.play('gossip-parrot');
    t.answer(a);
    expect(t.seenInHand(b!, a!)).toEqual(['king-cat']);
    expect(t.seenInHand(me!, a!)).toEqual(['king-cat']);
    expect(t.seenInHand(null, a!)).toEqual(['king-cat']);
  });

  it('Nosy Ferret: only you see the card', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['nosy-ferret', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['king-cat']);
    t.play('nosy-ferret');
    t.answer(a);
    expect(t.seenInHand(me!, a!)).toEqual(['king-cat']);
    expect(t.seenInHand(b!, a!)).toEqual([]);
    expect(t.log(b!)).toContain(`${t.name(me!)} chooses ${t.name(a!)}.`);
  });

  it('Pillow-Fight Panda: you and the target both show your cards without their action and draw', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['pillow-fight-panda', 'battle-bunny']);
    t.rig(`hand:${a}`, ['hermit-home-swap']);
    t.rig('deck', ['mouse-trapper', 'shell-shield', 'crystal-bowl']);
    t.play('pillow-fight-panda');
    t.answer(a);
    expect(t.cardIds(`played:${me}`)).toEqual(['pillow-fight-panda', 'battle-bunny']);
    expect(t.cardIds(`played:${a}`)).toEqual(['hermit-home-swap']);
    expect(t.cardIds(`hand:${me}`)).toEqual(['mouse-trapper']);
    // Their new card, then the draw for their own turn.
    expect(t.cardIds(`hand:${a}`)).toEqual(['shell-shield', 'crystal-bowl']);
  });

  it('Pillow-Fight Panda: a King Cat put face up knocks out its holder', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['pillow-fight-panda', 'battle-bunny']);
    t.rig(`hand:${a}`, ['king-cat']);
    t.play('pillow-fight-panda');
    t.answer(a);
    expect(t.s.players[a!]!.round).toBe('out');
    expect(t.s.players[me!]!.round).toBe('in');
    expect(t.cardIds(`hand:${me}`)).toHaveLength(1);
  });

  it('Tunnel Mole: your card goes to the bottom of the draw pile and you draw', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['tunnel-mole', 'king-cat']);
    t.rig('deck', ['battle-bunny']);
    t.play('tunnel-mole');
    expect(t.cardIds(`hand:${me}`)).toEqual(['battle-bunny']);
    expect(t.cardIds('deck').at(-1)).toBe('king-cat');
    const bottom = t.s.zones.deck!.cards.length - 1;
    expect(t.view(me!).zones.deck!.known).toEqual([{ index: bottom, card: expect.objectContaining({ cardId: 'king-cat' }) }]);
    expect(t.view(a!).zones.deck!.known).toEqual([]);
  });

  it('Swapsie Squirrel: two other players trade cards, unseen by you', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['swapsie-squirrel', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['king-cat']);
    t.rig(`hand:${b}`, ['battle-bunny']);
    t.play('swapsie-squirrel');
    t.answer(a);
    expect(t.prompt).toMatchObject({ kind: 'choosePlayer', choices: [b] });
    t.answer(b);
    expect(t.cardIds(`hand:${b}`)).toEqual(['king-cat']);
    expect(t.cardIds(`hand:${a}`)[0]).toBe('battle-bunny');
    expect(t.log()).toContain(`${t.name(a!)} and ${t.name(b!)} trade cards.`);
    expect(t.seenInHand(me!, b!)).toEqual([]);
  });

  it('Swapsie Squirrel: with two players it does nothing', () => {
    const t = table(2);
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['swapsie-squirrel', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['king-cat']);
    t.play('swapsie-squirrel');
    t.answer(a);
    expect(t.cardIds(`hand:${a}`)[0]).toBe('king-cat');
    expect(t.log()).toContain(`${t.name(me!)} has nobody to choose. Nothing happens.`);
  });

  it('Treasure Magpie: you may swap your card with the top of the draw pile', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['treasure-magpie', 'crystal-bowl']);
    t.rig('deck', ['king-cat', 'battle-bunny']);
    t.play('treasure-magpie');
    expect(t.log()).toContain(`${t.name(me!)} looks at the top card of the draw pile.`);
    expect(t.view(me!).zones.deck!.known[0]?.card.cardId).toBe('king-cat');
    expect(t.prompt).toMatchObject({ kind: 'confirm' });
    t.answer(true);
    expect(t.cardIds(`hand:${me}`)).toEqual(['king-cat']);
    // The next player draws the card you put back, and you know it.
    expect(t.cardIds(`hand:${a}`).at(-1)).toBe('crystal-bowl');
    expect(t.log()).toContain(`${t.name(me!)} swaps their card with the top card of the draw pile.`);
  });

  it('Treasure Magpie: or leave the pile as it is', () => {
    const t = table();
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['treasure-magpie', 'crystal-bowl']);
    t.rig('deck', ['king-cat', 'battle-bunny']);
    t.play('treasure-magpie');
    t.answer(false);
    expect(t.cardIds(`hand:${me}`)).toEqual(['crystal-bowl']);
    expect(t.cardIds(`hand:${a}`).at(-1)).toBe('king-cat');
  });

  it('Penguin Parade: everyone passes their card to the next player', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['penguin-parade', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['battle-bunny']);
    t.rig(`hand:${b}`, ['king-cat']);
    t.play('penguin-parade');
    expect(t.cardIds(`hand:${me}`)).toEqual(['king-cat']);
    expect(t.cardIds(`hand:${a}`)[0]).toBe('crystal-bowl');
    expect(t.cardIds(`hand:${b}`)).toEqual(['battle-bunny']);
    expect(t.log(me!)).toContain('You got King Cat.');
    // You still know the card you passed on.
    expect(t.seenInHand(me!, a!)).toContain('crystal-bowl');
  });

  it('Penguin Parade: a shielded player keeps their card', () => {
    const t = table();
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['penguin-parade', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['battle-bunny']);
    t.rig(`hand:${b}`, ['king-cat']);
    t.s.players[b!]!.statuses.push({ ...PROTECTED });
    t.play('penguin-parade');
    expect(t.cardIds(`hand:${b}`)).toEqual(['king-cat']);
    expect(t.cardIds(`hand:${me}`)).toEqual(['battle-bunny']);
  });

  it('Haggling Hamster: look at a card, then trade or keep yours', () => {
    const trade = table();
    const [me, a] = trade.order;
    trade.rig(`hand:${me}`, ['haggling-hamster', 'crystal-bowl']);
    trade.rig(`hand:${a}`, ['king-cat']);
    trade.play('haggling-hamster');
    trade.answer(a);
    expect(trade.seenInHand(me!, a!)).toEqual(['king-cat']);
    expect(trade.prompt).toMatchObject({ kind: 'confirm', text: `Trade cards with ${trade.name(a!)}?` });
    trade.answer(true);
    expect(trade.cardIds(`hand:${me}`)).toEqual(['king-cat']);

    const keep = table();
    keep.rig(`hand:${me}`, ['haggling-hamster', 'crystal-bowl']);
    keep.rig(`hand:${a}`, ['king-cat']);
    keep.play('haggling-hamster');
    keep.answer(a);
    keep.answer(false);
    expect(keep.cardIds(`hand:${me}`)).toEqual(['crystal-bowl']);
    expect(keep.log()).toContain(`${keep.name(me!)} keeps their card.`);
  });
});
