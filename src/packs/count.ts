import type { Count } from './types';

/** Resolves a Count for a number of players. Throws when no `byPlayers` key matches. */
export function resolveCount(count: Count, players: number): number {
  if (typeof count === 'number') return count;
  if ('perPlayer' in count) return players * count.perPlayer + (count.offset ?? 0);
  for (const [key, value] of Object.entries(count.byPlayers)) {
    if (matchesPlayers(key, players)) return value;
  }
  throw new Error(`no byPlayers entry for ${players} players`);
}

/** True when `players` fits a range key: "N", "N-M" or "N+". */
export function matchesPlayers(key: string, players: number): boolean {
  const m = /^(\d+)(?:(\+)|-(\d+))?$/.exec(key.trim());
  if (!m) throw new Error(`bad player range "${key}"`);
  const lo = Number(m[1]);
  if (m[2]) return players >= lo;
  const hi = m[3] === undefined ? lo : Number(m[3]);
  return players >= lo && players <= hi;
}
