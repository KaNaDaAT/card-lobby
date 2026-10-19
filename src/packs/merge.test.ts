import { describe, expect, it } from 'vitest';
import petsJson from '../../public/packs/power-hungry-pets/pack.json';
import bigLitterJson from '../../public/packs/power-hungry-pets/addons/big-litter.json';
import secondLitterJson from '../../public/packs/power-hungry-pets/addons/second-litter.json';
import { resolveCount } from './count';
import { addonProblems, cardOrigins, MergeError, mergeAddons } from './merge';
import type { Addon, Pack } from './types';

const pets = petsJson as unknown as Pack;
const bigLitter = bigLitterJson as unknown as Addon;

const deckSize = (pack: Pack, players: number) =>
  pack.cards.reduce((sum, c) => sum + resolveCount(c.count, players), 0);

describe('Power Hungry Pets data', () => {
  it('has the 21-card base deck', () => {
    expect(deckSize(pets, 4)).toBe(21);
  });

  it('Big Litter grows the deck to 32 and allows 10 players', () => {
    const merged = mergeAddons(pets, [bigLitter], ['big-litter']);
    expect(deckSize(merged, 8)).toBe(32);
    expect(merged.players).toEqual({ min: 2, max: 10 });
    const tokens = merged.options?.find((o) => o.id === 'tokensToWin');
    expect(tokens?.type === 'number' && resolveCount(tokens.default, 9)).toBe(2);
  });

  it('leaves the base pack untouched', () => {
    mergeAddons(pets, [bigLitter], ['big-litter']);
    expect(deckSize(pets, 4)).toBe(21);
    expect(pets.players.max).toBe(6);
  });

  it('knows which game or addon each card comes from, for its icon', () => {
    const addons = [bigLitter, secondLitterJson as unknown as Addon];
    const origins = cardOrigins(pets, addons, ['big-litter', 'second-litter']);
    expect(origins.get('king-cat')).toEqual({ name: 'Power Hungry Pets', icon: 'art/icon.svg' });
    expect(origins.get('crystal-bowl')).toEqual({ name: 'Power Hungry Pets', icon: 'art/icon.svg' });
    expect(origins.get('nosy-ferret')).toEqual({ name: 'Second Litter', icon: 'art/icon-second-litter.svg' });
    expect(cardOrigins(pets, addons, []).has('nosy-ferret')).toBe(false);
  });
});

const base: Pack = {
  format: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  description: '',
  engine: '0.1',
  players: { min: 2, max: 4 },
  art: { cover: 'c.svg', back: 'b.svg' },
  rules: {
    zones: { deck: { visibility: 'hidden' } },
    playerZones: { hand: { visibility: 'owner' } },
    roundSetup: [{ op: 'shuffle', zone: 'deck' }],
    turn: [{ op: 'draw', who: 'self' }],
    scoring: { roundWin: 1, toWin: 3 },
  },
  cards: [
    { id: 'a', name: 'A', count: 2, text: '' },
    { id: 'b', name: 'B', count: 1, text: '' },
  ],
};

const addon = (id: string, rest: Partial<Addon> = {}): Addon => ({
  format: 1,
  id,
  name: id.toUpperCase(),
  description: '',
  ...rest,
});

describe('mergeAddons', () => {
  it('skips addons that are not enabled', () => {
    const merged = mergeAddons(base, [addon('x', { cards: { remove: ['a'] } })], []);
    expect(merged.cards.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('adds, removes and modifies cards', () => {
    const x = addon('x', {
      cards: {
        add: [{ id: 'c', name: 'C', count: 1, text: '' }],
        remove: ['b'],
        modify: { a: { count: 5 } },
      },
    });
    const merged = mergeAddons(base, [x], ['x']);
    expect(merged.cards.map((c) => [c.id, c.count])).toEqual([
      ['a', 5],
      ['c', 1],
    ]);
  });

  it('applies addons in pack order, not toggle order', () => {
    const x = addon('x', { cards: { modify: { a: { count: 3 } } } });
    const y = addon('y', { cards: { modify: { a: { count: 7 } } } });
    expect(mergeAddons(base, [x, y], ['y', 'x']).cards[0]!.count).toBe(7);
  });

  it('deep-merges rules and replaces arrays', () => {
    const x = addon('x', {
      rules: {
        scoring: { toWin: 5 } as Pack['rules']['scoring'],
        turn: [{ op: 'draw', who: 'self', count: 2 }],
      },
    });
    const merged = mergeAddons(base, [x], ['x']);
    expect(merged.rules.scoring).toEqual({ roundWin: 1, toWin: 5 });
    expect(merged.rules.turn).toEqual([{ op: 'draw', who: 'self', count: 2 }]);
  });

  it('names the addon and path in errors', () => {
    const x = addon('x', { cards: { modify: { nope: { count: 1 } } } });
    expect(() => mergeAddons(base, [x], ['x'])).toThrow(MergeError);
    expect(() => mergeAddons(base, [x], ['x'])).toThrow('x: cards.modify.nope: no card with this id');
    const dup = addon('d', { cards: { add: [{ id: 'a', name: 'A', count: 1, text: '' }] } });
    expect(() => mergeAddons(base, [dup], ['d'])).toThrow('already exists');
  });
});

describe('addonProblems', () => {
  const x = addon('x', { requires: ['y'] });
  const y = addon('y');
  const z = addon('z', { conflicts: ['y'] });

  it('reports missing requirements and conflicts', () => {
    expect(addonProblems([x, y, z], ['x'])).toEqual(['X needs Y']);
    expect(addonProblems([x, y, z], ['y', 'z'])).toEqual(['Z conflicts with Y']);
    expect(addonProblems([x, y, z], ['x', 'y'])).toEqual([]);
  });

  it('reports unknown ids', () => {
    expect(addonProblems([x], ['q'])).toEqual(['Unknown addon "q"']);
  });
});
