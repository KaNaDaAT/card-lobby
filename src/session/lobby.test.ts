import { describe, expect, it } from 'vitest';
import { kittens, petsBase } from '../engine/testing';
import { resolveCount } from '../packs/count';
import { setupProblem, withSeats, withTweaks } from './lobby';

describe('what the host changes about a game', () => {
  it('gives more seats than the game has, and counts by player ranges keep their value at its maximum', () => {
    const pack = withSeats(petsBase, 8);
    expect(pack.players).toEqual({ min: 2, max: 8 });
    const tokens = pack.options!.find((o) => o.id === 'tokensToWin')!;
    expect(tokens.type === 'number' && resolveCount(tokens.default, 8)).toBe(2);
    expect(setupProblem(pack, 8, null)).toBeNull();
    expect(withSeats(petsBase, 4).players).toEqual({ min: 2, max: 4 });
  });

  it('says when extra seats run the deck short, until the host adds copies', () => {
    expect(setupProblem(withSeats(kittens, 7), 7, null)).toBe('With 7 players, round setup runs out of cards.');
    const more = withTweaks(kittens, { counts: { defuse: 8, cattermelon: 10 }, seats: 7 });
    expect(setupProblem(more, 7, 'these card counts')).toBeNull();
  });
});
