/** Lobby rules shared by the host session (which enforces them) and the lobby screen. */
import { addonProblems, mergeAddons } from '../packs/merge';
import type { LoadedPack, OptionDef, OptionValue, Pack } from '../packs/types';

/** Option value meaning "use the pack's default for the player count at start". */
export const AUTO = 'auto';

export interface Selection {
  /** The pack with the selected addons applied, or null when merging failed. */
  pack: Pack | null;
  problems: string[];
}

export function mergeSelection(lp: LoadedPack, addons: readonly string[]): Selection {
  const problems = addonProblems(lp.addons, addons);
  try {
    return { pack: mergeAddons(lp.pack, lp.addons, addons), problems };
  } catch (err) {
    return { pack: null, problems: [err instanceof Error ? err.message : String(err), ...problems] };
  }
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
