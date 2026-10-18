import { describe, it } from 'vitest';
import { playRandomGame, SIM_GAMES } from './simulate';
import { petsPack } from './testing';

const GAMES = Math.ceil(SIM_GAMES / 4);

describe('simulation with Off the Scale and Second Litter', () => {
  it('plays games with both addons, with and without Big Litter', { timeout: 300_000 }, () => {
    const small = petsPack(['off-the-scale', 'second-litter']);
    const big = petsPack(['big-litter', 'off-the-scale', 'second-litter']);
    for (let seed = 1; seed <= GAMES; seed++) {
      if (seed % 2) playRandomGame(small, 2 + (seed % 5), seed, seed % 4 === 1);
      else playRandomGame(big, 2 + (seed % 9), seed, seed % 4 === 0);
    }
  });
});
