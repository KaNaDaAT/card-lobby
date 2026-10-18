import { describe, expect, it } from 'vitest';
import { matchesPlayers, resolveCount } from './count';

describe('matchesPlayers', () => {
  it('handles single values, ranges and open ranges', () => {
    expect(matchesPlayers('2', 2)).toBe(true);
    expect(matchesPlayers('2', 3)).toBe(false);
    expect(matchesPlayers('4-6', 4)).toBe(true);
    expect(matchesPlayers('4-6', 6)).toBe(true);
    expect(matchesPlayers('4-6', 7)).toBe(false);
    expect(matchesPlayers('7+', 10)).toBe(true);
    expect(matchesPlayers('7+', 6)).toBe(false);
  });

  it('rejects malformed keys', () => {
    expect(() => matchesPlayers('two', 2)).toThrow();
  });
});

describe('resolveCount', () => {
  it('passes numbers through', () => {
    expect(resolveCount(5, 4)).toBe(5);
  });

  it('scales per player', () => {
    expect(resolveCount({ perPlayer: 1, offset: -1 }, 5)).toBe(4);
  });

  it('looks up byPlayers', () => {
    const tokens = { byPlayers: { '2-3': 3, '4-6': 2 } };
    expect(resolveCount(tokens, 2)).toBe(3);
    expect(resolveCount(tokens, 5)).toBe(2);
    expect(() => resolveCount(tokens, 7)).toThrow();
  });
});
