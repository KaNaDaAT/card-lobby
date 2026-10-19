import { describe, expect, it } from 'vitest';
import { kittens, petsPack, Table } from '../engine/testing';
import { tableEvents } from './events';

const pets = petsPack();

describe('table events', () => {
  it('starts a game with a shuffle, and the starter gets their turn', () => {
    const t = new Table(pets, 3);
    const [me, a] = t.order;
    expect(tableEvents(null, t.view(me!))).toEqual([{ kind: 'shuffle', zone: 'deck' }, { kind: 'yourTurn' }]);
    expect(tableEvents(null, t.view(a!))).toEqual([{ kind: 'shuffle', zone: 'deck' }]);
  });

  it('says nothing after a reload in the middle of a game', () => {
    const t = new Table(pets, 3);
    const [me] = t.order;
    t.rig(`hand:${me}`, ['shell-shield', 'crystal-bowl']);
    t.play('shell-shield');
    expect(tableEvents(null, t.view(me!))).toEqual([]);
  });

  it('shows a play to everyone and hands the next player their turn', () => {
    const t = new Table(pets, 3);
    const [me, a, b] = t.order;
    const before = [me, a, b].map((s) => t.view(s!));
    t.rig(`hand:${me}`, ['shell-shield', 'crystal-bowl']);
    t.play('shell-shield');
    expect(tableEvents(before[0]!, t.view(me!))).toEqual([{ kind: 'played', seat: me }]);
    expect(tableEvents(before[1]!, t.view(a!))).toEqual([{ kind: 'played', seat: me }, { kind: 'yourTurn' }]);
    expect(tableEvents(before[2]!, t.view(b!))).toEqual([{ kind: 'played', seat: me }]);
  });

  it('marks a player who is knocked out, and the end of the round', () => {
    const t = new Table(pets, 2);
    const [me, a] = t.order;
    t.rig(`hand:${me}`, ['crystal-bowl', 'mouse-trapper']);
    t.rig(`hand:${a}`, ['snake-sorcerer']);
    t.play('crystal-bowl');
    t.answer(a);
    const before = [t.view(me!), t.view(a!)];
    t.answer(5);
    expect(tableEvents(before[1]!, t.view(a!))).toEqual([{ kind: 'roundOver', won: false }, { kind: 'out', seat: a }]);
    expect(tableEvents(before[0]!, t.view(me!))).toEqual([{ kind: 'roundOver', won: true }, { kind: 'out', seat: a }]);
  });

  it('hears a card on the discard pile and a Nope', () => {
    const t = new Table(kittens, 3);
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, hand('favor'));
    t.rig(`hand:${a}`, hand('nope'));
    const watching = t.view(b!);
    t.play('favor');
    expect(tableEvents(watching, t.view(b!))).toEqual([{ kind: 'played', seat: null }]);
    const before = t.view(b!);
    t.react(a!, 'nope');
    expect(tableEvents(before, t.view(b!))).toEqual([{ kind: 'played', seat: null }, { kind: 'reaction' }]);
  });

  it('asks a Favor target to pick a card outside their turn', () => {
    const t = new Table(kittens, 3);
    const [me, a] = t.order;
    t.rig(`hand:${me}`, hand('favor'));
    t.play('favor');
    t.closeWindow();
    const before = t.view(a!);
    t.answer(a);
    expect(tableEvents(before, t.view(a!))).toEqual([{ kind: 'yourMove' }]);
  });
});

/** A hand of 8 for Exploding Kittens that starts with `cards`. */
function hand(...cards: string[]): string[] {
  return [...cards, 'skip', 'attack', 'favor', 'shuffle', 'see-the-future', 'beard-cat', 'cattermelon'].slice(0, 8);
}
