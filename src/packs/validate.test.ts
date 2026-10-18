import { describe, expect, it } from 'vitest';
import { bigLitter, petsBase } from '../engine/testing';
import type { Addon, LoadedPack, Pack } from './types';
import { validateAddon, validatePack, validateSelection, versionAtMost } from './validate';

const clone = <T>(v: T): T => structuredClone(v);
const lp = (pack: Pack, addons: Addon[] = []): LoadedPack => ({ pack, addons, asset: (p) => p });

/** A copy of Power Hungry Pets with one change applied. */
function petsWith(change: (p: Pack & Record<string, unknown>) => void): Pack {
  const p = clone(petsBase) as Pack & Record<string, unknown>;
  change(p);
  return p;
}

const card = (p: Pack, id: string) => p.cards.find((c) => c.id === id)!;

describe('validatePack', () => {
  it('accepts Power Hungry Pets, alone and with Big Litter', () => {
    expect(validatePack(petsBase)).toEqual([]);
    expect(validateSelection(lp(petsBase, [bigLitter]), [])).toEqual([]);
    expect(validateSelection(lp(petsBase, [bigLitter]), ['big-litter'])).toEqual([]);
  });

  it('rejects unknown and planned ops with the path', () => {
    const p = petsWith((p) => {
      card(p, 'crystal-bowl').onPlay![0] = { op: 'chooseplayer', as: 't', from: 'others' };
      card(p, 'mouse-trapper').onPlay = [{ op: 'reorder', zone: 'deck', count: 3 }];
      card(p, 'battle-bunny').onPlay = [{ op: 'constructor' }];
    });
    const errors = validatePack(p);
    expect(errors).toContain('pack.json: cards.crystal-bowl.onPlay[0]: unknown op "chooseplayer"');
    expect(errors).toContain('pack.json: cards.mouse-trapper.onPlay[0]: op "reorder" is planned but not supported by this engine yet');
    expect(errors).toContain('pack.json: cards.battle-bunny.onPlay[0]: unknown op "constructor"');
  });

  it('checks params, variables and references', () => {
    const p = petsWith((p) => {
      card(p, 'crystal-bowl').onPlay = [
        { op: 'choosePlayer', as: 't', form: 'others' },
        { op: 'eliminate', who: '$target' },
        { op: 'move', from: 'graveyard', to: 'deck' },
        { op: 'status', who: 'self', id: 'frozen', until: 'ownNextTurn' },
        { op: 'choosePlayer', as: 't', from: 'others', holding: 'queen-cat' },
        { op: 'log', text: 'Hello {$nobody}' },
      ];
    });
    const errors = validatePack(p);
    const at = 'pack.json: cards.crystal-bowl.onPlay';
    expect(errors).toEqual(
      expect.arrayContaining([
        `${at}[0]: "choosePlayer" needs "from"`,
        `${at}[0].form: "choosePlayer" has no param "form"`,
        `${at}[1].who: variable "$target" is not set by an earlier op`,
        `${at}[2].from: no zone "graveyard"`,
        `${at}[3].id: no status "frozen"`,
        `${at}[4].holding: no card "queen-cat"`,
        `${at}[5].text: variable "$nobody" is not set by an earlier op`,
      ]),
    );
  });

  it('does not let round setup ask players anything', () => {
    const p = petsWith((p) => p.rules.roundSetup.push({ op: 'confirm', as: 'x', text: 'Ready?' }));
    expect(validatePack(p)).toContain('pack.json: rules.roundSetup[5]: "confirm" asks a player, which roundSetup cannot do');
  });

  it('checks conditions', () => {
    const p = petsWith((p) => {
      card(p, 'royal-robovac').showdownValue = [{ if: { anyHandHas: 'kingcat' } as never, value: 'highest' }];
      p.rules.turn[0] = { op: 'if', cond: { zoneEmpty: 'deck', players: '2' }, then: [] };
    });
    const errors = validatePack(p);
    expect(errors).toContain('pack.json: cards.royal-robovac.showdownValue[0].if.anyHandHas: no card "kingcat"');
    expect(errors).toContain('pack.json: rules.turn[0].cond: expected a condition with exactly one key');
  });

  it('checks counts for every allowed player count', () => {
    const p = petsWith((p) => {
      p.players.max = 7;
    });
    expect(validatePack(p)).toContain('pack.json: options.tokensToWin.default: no byPlayers entry for 7 players');
  });

  it('checks the deck covers setup and a draw for everyone', () => {
    const p = petsWith((p) => {
      p.cards = p.cards.filter((c) => ['king-cat', 'crystal-bowl'].includes(c.id));
    });
    expect(validatePack(p)).toEqual([
      'pack.json: rules.roundSetup: with 2 players: the draw pile is down to 1 after setup, but every player needs at least one draw',
    ]);
  });

  it('checks images, engine version, ids and unknown fields', () => {
    const p = petsWith((p) => {
      p.engine = '9.0';
      p.art.cover = 'art/cover.gif';
      p.art.back = '../secret.svg';
      card(p, 'king-cat').image = 'https://example.com/x.png';
      (card(p, 'king-cat') as unknown as Record<string, unknown>).onplay = [];
      card(p, 'crystal-bowl').onDraw = [];
      p.cards.push(clone(card(p, 'king-cat')));
    });
    const errors = validatePack(p, { files: new Set(['art/back.svg']) });
    expect(errors).toEqual(
      expect.arrayContaining([
        'pack.json: engine: needs engine 9.0, this app runs 0.1',
        'pack.json: art.cover: image type must be one of png, jpg, jpeg, webp, svg',
        'pack.json: art.back: must be a relative path inside the pack',
        'pack.json: cards.king-cat.image: must be a relative path inside the pack',
        'pack.json: cards.king-cat.onplay: unknown field',
        'pack.json: cards.crystal-bowl.onDraw: onDraw is planned but not supported by this engine yet',
        'pack.json: cards.king-cat: duplicate card id',
      ]),
    );
    expect(validatePack(petsBase, { files: new Set() })).toContain('pack.json: art.cover: file "art/cover.svg" is missing');
  });

  it('survives garbage', () => {
    expect(validatePack(null)).toEqual(['pack.json: expected an object']);
    expect(validatePack({ format: 1 }).length).toBeGreaterThan(3);
    expect(validatePack({ ...clone(petsBase), rules: { zones: 3, turn: 'x' } }).length).toBeGreaterThan(3);
  });
});

describe('validateSelection', () => {
  it('names the addon file for errors it caused', () => {
    const bad: Addon = { ...clone(bigLitter), cards: { modify: { 'crystal-bowl': { count: { byPlayers: { '2-6': 5 } } } } } };
    expect(validateSelection(lp(petsBase, [bad]), ['big-litter'])).toContain(
      'addons/big-litter.json: cards.crystal-bowl.count: no byPlayers entry for 7 players',
    );
    const typo: Addon = { ...clone(bigLitter), cards: { modify: { 'crystal-bwol': { count: 8 } } } };
    expect(validateSelection(lp(petsBase, [typo]), ['big-litter'])).toEqual(['addons/big-litter.json: cards.modify.crystal-bwol: no card with this id']);
  });

  it('reports addon shape problems before merging', () => {
    expect(validateAddon({ format: 1, id: 'X', name: '', description: 'd', cards: { remove: 'king-cat' } }, 'addons/x.json')).toEqual([
      'addons/x.json: id: lowercase letters, digits and dashes',
      'addons/x.json: name: missing',
      'addons/x.json: cards.remove: expected a list of card ids',
    ]);
  });
});

describe('versionAtMost', () => {
  it('compares dotted versions numerically', () => {
    expect(versionAtMost('0.1', '0.1')).toBe(true);
    expect(versionAtMost('0.1', '0.10')).toBe(true);
    expect(versionAtMost('0.10', '0.9')).toBe(false);
    expect(versionAtMost('1', '0.9.9')).toBe(false);
  });
});
