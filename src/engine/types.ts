/**
 * Engine state and inputs. Everything here is plain JSON so the host can save and resume at
 * any point, including mid-effect while a prompt is open. See docs/DESIGN.md, "Engine".
 */
import type { Op, OptionValue } from '../packs/types';

export const ENGINE_VERSION = '0.1';

export type Seat = number;

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
  ops: Op[];
  pc: number;
  /** Variables set by ops with `as`, plus `self` and the card being resolved. */
  ctx: Record<string, unknown>;
  /** Card uid whose effect this frame runs, if any. Used for logs and effect abort. */
  source?: string;
}

export type PromptKind = 'play' | 'choosePlayer' | 'guess' | 'choosePosition' | 'confirm';

export interface Prompt {
  id: string;
  to: Seat;
  kind: PromptKind;
  /** Valid answers. Shape depends on `kind`. */
  choices: unknown;
  optional: boolean;
  /** Host clock in ms. Absent means no time limit. */
  deadline?: number;
  text?: string;
}

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

export interface GameState {
  packId: string;
  packHash?: string;
  options: Record<string, OptionValue>;
  /** Fixed when the game starts. */
  tokensToWin: number;
  round: number;
  phase: GamePhase;
  players: PlayerState[];
  turn: { seat: Seat; direction: 1 | -1; owed: number };
  cards: Record<string, CardInstance>;
  zones: Record<string, Zone>;
  program: Frame[];
  prompt: Prompt | null;
  stack: PendingPlay[];
  /** Seats that won the last round. */
  lastWinners: Seat[];
  rng: number[];
  log: LogEntry[];
}

export type Input =
  | { kind: 'answer'; seat: Seat; promptId: string; value: unknown }
  | { kind: 'timeout'; promptId: string; now: number }
  | { kind: 'kickForRound'; seat: Seat }
  | { kind: 'connection'; seat: Seat; connected: boolean }
  | { kind: 'nextRound' };

/** What one seat may see. Built by `viewFor(state, seat)`. */
export interface GameView {
  you: Seat | null;
  round: number;
  phase: GamePhase;
  tokensToWin: number;
  turnSeat: Seat;
  players: {
    seat: Seat;
    name: string;
    color: string;
    round: RoundStatus;
    tokens: number;
    statuses: string[];
    connected: boolean;
    handCount: number;
    played: VisibleCard[];
  }[];
  /** Your own hand, empty for spectators. */
  hand: VisibleCard[];
  /** Shared zones: a count plus the cards this seat knows, with positions. */
  zones: Record<string, { count: number; known: { index: number; card: VisibleCard }[] }>;
  prompt: Prompt | null;
  log: string[];
}

export interface VisibleCard {
  uid: string;
  cardId: string;
}
