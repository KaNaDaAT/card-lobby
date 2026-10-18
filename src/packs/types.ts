/** Types for pack.json and addon files. The format is documented in docs/PACK_FORMAT.md. */

export const PACK_FORMAT = 1;

/** A number that may depend on how many players are in the round. */
export type Count =
  | number
  | { perPlayer: number; offset?: number }
  | { byPlayers: Record<string, number> };

/** A reference to a host-chosen option, usable wherever a value is expected. */
export interface OptionRef {
  option: string;
}

export interface PackIndex {
  packs: string[];
}

export interface Pack {
  format: typeof PACK_FORMAT;
  id: string;
  name: string;
  version: string;
  author?: string;
  description: string;
  /** Lowest engine version this pack needs, like "0.1". */
  engine: string;
  players: PlayerRange;
  art: { cover: string; back: string; accent?: string };
  options?: OptionDef[];
  rules: Rules;
  cards: CardDef[];
  /** Addon file paths, relative to the pack folder. Also the merge order. */
  addons?: string[];
}

export interface PlayerRange {
  min: number;
  max: number;
}

export interface CardDef {
  id: string;
  name: string;
  value?: number;
  count: Count;
  text: string;
  image?: string;
  tags?: string[];
  onPlay?: Op[];
  onDiscard?: Op[];
  onDraw?: Op[];
  /** Runs when the card is played as a reaction while another play's window is open (Nope). */
  onReact?: Op[];
  /** Only playable as part of a combo, like the cat cards of Exploding Kittens. */
  comboOnly?: boolean;
  showdownValue?: ValueRule[];
}

/** A multi-card play. Its ops run instead of the cards' own onPlay. */
export interface ComboDef {
  name: string;
  size: number;
  /** `same`: every card has the same id. `distinct`: every card is different. */
  match: 'same' | 'distinct';
  ops: Op[];
}

export interface ValueRule {
  if: Condition;
  value: number | 'highest' | 'lowest';
}

export type OptionDef =
  | (OptionBase & { type: 'select'; choices: { value: string; label: string }[]; default: string })
  | (OptionBase & { type: 'number'; min?: number; max?: number; default: Count })
  | (OptionBase & { type: 'toggle'; default: boolean });

interface OptionBase {
  id: string;
  label: string;
}

export type OptionValue = string | number | boolean;

export type Visibility = 'public' | 'owner' | 'hidden';

export interface Rules {
  /** `label` names the zone in logs and on the table, like "the draw pile". */
  zones: Record<string, { visibility: 'public' | 'hidden'; label?: string }>;
  playerZones: Record<string, { visibility: 'public' | 'owner'; label?: string }>;
  statuses?: Record<string, { label: string; untargetable?: boolean }>;
  roundSetup: Op[];
  turn: Op[];
  roundEnd?: { lastStanding?: boolean };
  combos?: ComboDef[];
  /** How long a reaction window stays open, for packs with `onReact` cards. */
  reactions?: { seconds: number | OptionRef };
  showdown?: {
    tieBreak?: 'highestPlayed' | 'sumPlayed' | 'none' | OptionRef;
    stillTied?: 'allWin';
  };
  scoring: {
    roundWin: number;
    toWin: Count | OptionRef;
    tiedAtTarget?: 'decidingRound' | 'allWin';
  };
  rounds?: {
    first?: 'random' | 'nextSeat';
    next?: 'lastWinner' | 'nextSeat' | 'random';
  };
}

/**
 * One building block of a rule or card effect. Ops are validated against the engine's op
 * registry, so the shape here stays loose on purpose.
 */
export interface Op {
  op: string;
  [param: string]: unknown;
}

export type Condition =
  | { players: string }
  | { zoneEmpty: string }
  | { set: string }
  | { is: string }
  | { in: string }
  | { handHasValue: [string, string | number] }
  | { handHas: [string, string] }
  | { anyHandHas: string }
  | { not: Condition }
  | { all: Condition[] }
  | { any: Condition[] };

export interface Addon {
  format: typeof PACK_FORMAT;
  id: string;
  name: string;
  description: string;
  image?: string;
  requires?: string[];
  conflicts?: string[];
  players?: Partial<PlayerRange>;
  cards?: {
    add?: CardDef[];
    remove?: string[];
    modify?: Record<string, Partial<CardDef>>;
  };
  rules?: Partial<Rules>;
  options?: {
    add?: OptionDef[];
    modify?: Record<string, Partial<OptionDef>>;
  };
}

/** What players are shown before they accept a custom pack. */
export interface PackOffer {
  /** SHA-256 of the zip, hex. */
  hash: string;
  name: string;
  author?: string;
  bytes: number;
  images: number;
}

/** A pack as loaded by the app: data plus where its files live. */
export interface LoadedPack {
  /** How the lobby names the pack: its id when built in, `custom:<hash>` when uploaded. */
  key: string;
  pack: Pack;
  addons: Addon[];
  /** Turns a path from the pack files into a URL the page can load. */
  asset(path: string): string;
  /** Uploaded packs keep their zip, to send to other players. */
  custom?: { bytes: Uint8Array; offer: PackOffer };
}
