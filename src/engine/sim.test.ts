/**
 * Thousands of seeded random games (with `SIM_GAMES=5000`), see simulate.ts for the
 * invariants. The Big Litter games run in sim-litter.test.ts, in parallel.
 */
import { describe, expect, it } from 'vitest';
import { playRandomGame, SIM_GAMES as GAMES } from './simulate';
import { petsPack } from './testing';

describe('simulation', () => {
  const base = petsPack();

  it('plays random games without breaking an invariant', { timeout: 300_000 }, () => {
    let rounds = 0;
    for (let seed = 1; seed <= GAMES; seed++) {
      const players = 2 + (seed % 5);
      const out = playRandomGame(base, players, seed, seed % 3 === 0);
      rounds += out.rounds;
      const winners = out.final.winners;
      expect(winners.length).toBeGreaterThan(0);
      for (const w of winners) expect(out.final.players[w]!.tokens).toBeGreaterThanOrEqual(out.final.tokensToWin);
    }
    expect(rounds).toBeGreaterThan(GAMES);
  });

  it('replays exactly from the same seed', () => {
    const a = playRandomGame(base, 4, 42, true);
    const b = playRandomGame(base, 4, 42, true);
    expect(JSON.stringify(b.final)).toBe(JSON.stringify(a.final));
    const c = playRandomGame(base, 4, 43, true);
    expect(JSON.stringify(c.final)).not.toBe(JSON.stringify(a.final));
  });
});
