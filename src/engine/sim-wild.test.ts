import { describe, it } from 'vitest';
import { playRandomGame, SIM_GAMES } from './simulate';
import { wildPack } from './testing';

const GAMES = Math.ceil(SIM_GAMES / 4);

describe('simulation of the example pack', () => {
  it('plays games with Off the Scale and Second Litter, with and without Big Litter', { timeout: 300_000 }, () => {
    const small = wildPack(['off-the-scale', 'second-litter']);
    const big = wildPack(['big-litter', 'off-the-scale', 'second-litter']);
    for (let seed = 1; seed <= GAMES; seed++) {
      if (seed % 2) playRandomGame(small, 2 + (seed % 5), seed, seed % 4 === 1);
      else playRandomGame(big, 2 + (seed % 9), seed, seed % 4 === 0);
    }
  });
});
