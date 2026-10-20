/** Lobby rules shared by the host session (which enforces them) and the lobby screen. */
import { checkSetup } from '../engine/index';
import { resolveCount } from '../packs/count';
import { addonProblems, mergeAddons } from '../packs/merge';
import type { Count, LoadedPack, OptionDef, OptionValue, Pack } from '../packs/types';

/** Option value meaning "use the pack's default for the player count at start". */
export const AUTO = 'auto';

/** Most copies of one card the host may put into the deck. */
export const MAX_CARD_COUNT = 20;

/** Most seats the host may give a table. */
export const MAX_SEATS = 12;

/** What the host changed about the game: copies by card id, and the seats (null keeps the game's own maximum). */
export interface Tweaks {
  counts: Readonly<Record<string, number>>;
  seats: number | null;
}

export const NO_TWEAKS: Tweaks = { counts: {}, seats: null };

/** The host's changes as a lobby view carries them. */
export const tweaksOf = (lobby: { counts: Record<string, number>; seats: number | null }): Tweaks => ({ counts: lobby.counts, seats: lobby.seats });

export interface Selection {
  /** The pack with the selected addons and the host's changes applied, or null when merging failed. */
  pack: Pack | null;
  problems: string[];
}

export function mergeSelection(lp: LoadedPack, addons: readonly string[], tweaks: Tweaks = NO_TWEAKS): Selection {
  const problems = addonProblems(lp.addons, addons);
  try {
    return { pack: withTweaks(mergeAddons(lp.pack, lp.addons, addons), tweaks), problems };
  } catch (err) {
    return { pack: null, problems: [err instanceof Error ? err.message : String(err), ...problems] };
  }
}

export function withTweaks(pack: Pack, tweaks: Tweaks): Pack {
  return withSeats(withCounts(pack, tweaks.counts), tweaks.seats);
}

/**
 * The pack with as many seats as the host picked. Above the game's own maximum, a count that
 * depends on the players by ranges keeps the value it has at that maximum.
 */
export function withSeats(pack: Pack, seats: number | null): Pack {
  const max = pack.players.max;
  if (seats === null || seats === max) return pack;
  const players = { ...pack.players, max: seats };
  if (seats < max) return { ...pack, players };
  const extend = (count: Count): Count => {
    if (typeof count !== 'object' || !('byPlayers' in count)) return count;
    return { byPlayers: { ...count.byPlayers, [`${max + 1}+`]: resolveCount(count, max) } };
  };
  const toWin = pack.rules.scoring.toWin;
  return {
    ...pack,
    players,
    cards: pack.cards.map((c) => ({ ...c, count: extend(c.count) })),
    options: pack.options?.map((o) => (o.type === 'number' ? { ...o, default: extend(o.default) } : o)),
    rules: {
      ...pack.rules,
      scoring: { ...pack.rules.scoring, toWin: typeof toWin === 'object' && 'option' in toWin ? toWin : extend(toWin) },
    },
  };
}

/**
 * The pack with the copies the host picked. Only cards with a plain number as their count can
 * change: a count that depends on the players (one kitten less than players) is part of the rules.
 */
export function withCounts(pack: Pack, counts: Readonly<Record<string, number>>): Pack {
  if (!Object.keys(counts).length) return pack;
  return {
    ...pack,
    cards: pack.cards.map((c) => (typeof c.count === 'number' && counts[c.id] !== undefined ? { ...c, count: counts[c.id]! } : c)),
  };
}

/**
 * Why the host's changes break round setup for a game of `players`, or null. Smaller rounds are
 * checked too, since players can sit out a round. `what` names the changes in the message.
 */
export function setupProblem(pack: Pack, players: number, what: string | null): string | null {
  for (let n = pack.players.min; n <= Math.min(pack.players.max, Math.max(pack.players.min, players)); n++) {
    const problem = checkSetup(pack, n);
    if (problem) return `With ${what ? `${what} and ` : ''}${n} players, ${problem}.`;
  }
  return null;
}

/** True when `value` is allowed for the option. */
export function optionValueOk(def: OptionDef, value: unknown): value is OptionValue {
  switch (def.type) {
    case 'select':
      return typeof value === 'string' && def.choices.some((c) => c.value === value);
    case 'number':
      if (value === AUTO) return typeof def.default !== 'number';
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= (def.min ?? 1) &&
        value <= (def.max ?? 10)
      );
    case 'toggle':
      return typeof value === 'boolean';
  }
}

export interface LobbyMember {
  playerId: string;
  name: string;
  connected: boolean;
  packReady: boolean;
}

/**
 * Why Start is disabled, or null when the game can start. `players` are the members who would
 * get a seat, in seat order.
 */
export function startBlocked(
  selection: Selection | null,
  players: readonly LobbyMember[],
  extraProblems: readonly string[] = [],
): string | null {
  if (!selection) return 'Pick a game first.';
  const { pack, problems } = selection;
  if (problems.length) return problems[0]!;
  if (!pack) return 'This game cannot be loaded.';
  if (extraProblems.length) return extraProblems[0]!;
  const n = players.length;
  if (n < pack.players.min) return `Needs at least ${pack.players.min} players, ${n} here.`;
  const away = players.find((p) => !p.connected);
  if (away) return `Waiting for ${away.name} to come back.`;
  const missing = players.find((p) => !p.packReady);
  if (missing) return `Waiting for ${missing.name} to get the pack.`;
  return null;
}
