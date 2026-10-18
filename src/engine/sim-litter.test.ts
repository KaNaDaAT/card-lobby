import { describe, it } from 'vitest';
import { playRandomGame, SIM_GAMES } from './simulate';
import { petsPack } from './testing';

const GAMES = Math.ceil(SIM_GAMES / 4);

describe('simulation with Big Litter', () => {
  it('plays games for 2 to 10 players without breaking an invariant', { timeout: 300_000 }, () => {
    const pack = petsPack(['big-litter']);
    for (let seed = 1; seed <= GAMES; seed++) playRandomGame(pack, 2 + (seed % 9), seed, seed % 2 === 0);
  });
});
