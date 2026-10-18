/**
 * Engine state and inputs. Everything here is plain JSON so the host can save and resume at
 * any point, including mid-effect while a prompt is open. See docs/DESIGN.md, "Engine".
 */
import type { Op, OptionValue } from '../packs/types';

export const ENGINE_VERSION = '0.1';

export type Seat = number;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface CardInstance {
  uid: string;
  cardId: string;
  faceUp: boolean;
  /** Seats that know this card's identity although its zone hides it. */
  knownBy: Seat[];
}

export interface Zone {
  id: string;
  owner?: Seat;
  visibility: 'public' | 'owner' | 'hidden';
  /** Card uids, index 0 is the top. */
  cards: string[];
}

export type RoundStatus = 'in' | 'out' | 'sittingOut';

export interface PlayerState {
  seat: Seat;
  playerId: string;
  name: string;
  color: string;
  round: RoundStatus;
  tokens: number;
  statuses: Status[];
  connected: boolean;
}

export interface Status {
  id: string;
  until: 'ownNextTurn' | 'endOfTurn' | 'endOfRound' | 'permanent';
}

/** One level of the interpreter's call stack. */
export interface Frame {
  /** `effect` frames run a card hook. An effect abort pops up to the nearest effect, turn or setup frame. */
  kind: 'setup' | 'turn' | 'effect' | 'block';
  ops: Op[];
  pc: number;
  /** Variables set by ops with `as`, plus `self`. `block` frames have none and use the frame below. */
  ctx?: Record<string, Json>;
  /** Card uid whose hook this frame runs. */
  source?: string;
  /** The answer to the prompt the op at `pc` asked. The op runs again and consumes it. */
  answer?: Json;
}

export type PromptKind = 'play' | 'choosePlayer' | 'guess' | 'choosePosition' | 'confirm';

interface PromptBase {
  id: string;
  to: Seat;
  optional: boolean;
  /** Host clock in ms. Absent means no time limit. */
  deadline?: number;
  /** Card id whose effect asks, for the prompt's title. */
  source?: string;
  text?: string;
}

/** The one question the game waits on. Answers: card uids, a seat, a value, a position, yes or no. */
export type Prompt =
  | (PromptBase & { kind: 'play'; choices: string[]; min: number; max: number })
  | (PromptBase & { kind: 'choosePlayer'; choices: Seat[] })
  | (PromptBase & { kind: 'guess'; choices: number[] })
  | (PromptBase & { kind: 'choosePosition'; choices: number })
  | (PromptBase & { kind: 'confirm' });

/** A play waiting for its reaction window to close. Always empty for Power Hungry Pets. */
export interface PendingPlay {
  seat: Seat;
  cards: string[];
  windowEndsAt?: number;
}

export interface LogEntry {
  text: string;
  to: 'all' | Seat[];
}

export type GamePhase = 'round' | 'roundOver' | 'gameOver';

export type ShowdownValue = number | 'highest' | 'lowest';

export interface RoundResult {
  winners: Seat[];
  by: 'lastStanding' | 'showdown' | 'nobodyLeft';
  /** Final hands at a showdown, with the value each counted as. */
  showdown?: { seat: Seat; cardId: string; value: ShowdownValue }[];
  /** Set when the showdown needed the tie-break. */
  tieBreak?: { rule: TieBreak; scores: { seat: Seat; score: number }[] };
}

export type TieBreak = 'highestPlayed' | 'sumPlayed' | 'none';

export interface GameState {
  packId: string;
  /** Every option resolved to a value. Fixed when the game starts. */
  options: Record<string, OptionValue>;
  /** Fixed when the game starts. */
  tokensToWin: number;
  round: number;
  phase: GamePhase;
  players: PlayerState[];
  /** `count` is the number of turns started this round, 0 during setup. */
  turn: { seat: Seat; direction: 1 | -1; owed: number; count: number };
  /** Who started the current round. */
  starter: Seat;
  cards: Record<string, CardInstance>;
  zones: Record<string, Zone>;
  program: Frame[];
  prompt: Prompt | null;
  stack: PendingPlay[];
  /** Seats that won the last round. */
  lastWinners: Seat[];
  /** Seats playing a deciding round because they reached the target together. */
  deciding: Seat[] | null;
  result: RoundResult | null;
  /** Set when the game is over. */
  winners: Seat[];
  /** Counter for card uids and prompt ids. */
  nextId: number;
  rng: number[];
  log: LogEntry[];
}

export type Input =
  | { kind: 'answer'; seat: Seat; promptId: string; value: unknown }
  | { kind: 'timeout'; promptId: string; now: number }
  | { kind: 'kickForRound'; seat: Seat }
  | { kind: 'connection'; seat: Seat; connected: boolean }
  | { kind: 'nextRound' };

export interface VisibleCard {
  uid: string;
  cardId: string;
}

/** A zone as one seat sees it: how many cards, and the ones this seat knows with their positions. */
export interface ZoneView {
  count: number;
  known: { index: number; card: VisibleCard }[];
}

export interface PlayerView {
  seat: Seat;
  playerId: string;
  name: string;
  color: string;
  round: RoundStatus;
  tokens: number;
  statuses: string[];
  connected: boolean;
  hand: ZoneView;
  played: VisibleCard[];
}

/** What one seat may see. Built by `viewFor(state, seat)`. */
export interface GameView {
  /** Your seat, or null for spectators. */
  you: Seat | null;
  round: number;
  phase: GamePhase;
  tokensToWin: number;
  turnSeat: Seat;
  deciding: Seat[] | null;
  players: PlayerView[];
  /** Your own hand, empty for spectators. */
  hand: VisibleCard[];
  /** Shared zones. */
  zones: Record<string, ZoneView>;
  /** The open question, only when it is yours to answer. */
  prompt: Prompt | null;
  /** Who the game waits on, for everyone. */
  waiting: { seat: Seat; kind: PromptKind } | null;
  log: { text: string; private: boolean }[];
  result: RoundResult | null;
  winners: Seat[];
}
