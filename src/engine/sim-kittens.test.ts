import { describe, expect, it } from 'vitest';
import { playRandomGame, SIM_GAMES } from './simulate';
import { kittens } from './testing';

const GAMES = Math.ceil(SIM_GAMES / 3);

describe('simulation of Exploding Kittens', () => {
  it('plays games for 2 to 5 players, with combos and Nopes, without breaking an invariant', { timeout: 300_000 }, () => {
    let reactions = 0;
    for (let seed = 1; seed <= GAMES; seed++) {
      const out = playRandomGame(kittens, 2 + (seed % 4), seed, seed % 4 === 0);
      expect(out.final.winners).toHaveLength(1);
      reactions += out.final.log.filter((e) => e.text.endsWith('plays Nope!')).length;
    }
    expect(reactions).toBeGreaterThan(GAMES / 4);
  });
});
