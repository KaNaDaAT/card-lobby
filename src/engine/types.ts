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
  /**
   * Variables set by ops with `as`, plus `self`, and `card` (the card's uid) in card hooks.
   * `block` frames have none and use the frame below.
   */
  ctx?: Record<string, Json>;
  /** Card uid whose hook this frame runs. */
  source?: string;
  /** Name of the combo whose effect this frame runs. */
  combo?: string;
  /** The answer to the prompt the op at `pc` asked. The op runs again and consumes it. */
  answer?: Json;
}

export type PromptKind = 'play' | 'choosePlayer' | 'guess' | 'choosePosition' | 'confirm' | 'chooseCard' | 'nameCard';

/** A multi-card play the pack allows, like a pair. `same`: one card id. `distinct`: all different. */
export interface ComboRule {
  name: string;
  size: number;
  match: 'same' | 'distinct';
}

interface PromptBase {
  id: string;
  to: Seat;
  optional: boolean;
  /** Host clock in ms. Absent means no time limit. */
  deadline?: number;
  /** Card id whose effect asks, for the prompt's title. */
  source?: string;
  /** The combo whose effect asks, if any. */
  combo?: string;
  text?: string;
}

/**
 * The one question the game waits on. Answers: card uids, a seat, a value, a position, yes or
 * no, one card uid, a card id.
 */
export type Prompt =
  | (PromptBase & {
      kind: 'play';
      /** Every card in hand. */
      choices: string[];
      /** Cards that may be played on their own. The rest only go in combos. */
      alone: string[];
      combos: ComboRule[];
      min: number;
      max: number;
      /** Label for playing nothing, when `min` is 0, like "Draw a card". */
      pass?: string;
    })
  | (PromptBase & { kind: 'choosePlayer'; choices: Seat[] })
  | (PromptBase & { kind: 'guess'; choices: number[] })
  | (PromptBase & {
      kind: 'choosePosition';
      choices: number;
      /** The card going into the zone, when the answering seat knows it. */
      card?: string;
    })
  | (PromptBase & { kind: 'confirm' })
  | (PromptBase & { kind: 'chooseCard'; choices: string[] })
  | (PromptBase & { kind: 'nameCard'; choices: string[] });

/**
 * A play in its reaction window. Anyone may react (Nope) until `endsAt`, host clock in ms.
 * Each reaction restarts the window. Always empty for Power Hungry Pets.
 */
export interface PendingPlay {
  id: string;
  seat: Seat;
  cards: string[];
  /** Where reactions go, the zone the play went to. */
  zone: string;
  endsAt: number;
  canceled: boolean;
  reactions: number;
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
  /** Set when the lowest card won the showdown. */
  lowestWins?: true;
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
  /**
   * `count` is the number of turns started this round, 0 during setup. `owed[seat]` is how many
   * extra turns that player takes in a row when their turn comes (Attack).
   */
  turn: { seat: Seat; direction: 1 | -1; owed: number[]; count: number };
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
  /** Card ids that can react (have onReact), so views can tell players what they could react with. */
  reactCards: string[];
  /** Round flags that are on, in the order they were set. Cleared when a round starts. */
  flags: string[];
  /** Counter for card uids and prompt ids. */
  nextId: number;
  rng: number[];
  log: LogEntry[];
}

/** Inputs that may open or restart a reaction window read the host clock from `now`. */
export type Input =
  | { kind: 'answer'; seat: Seat; promptId: string; value: unknown; now?: number }
  | { kind: 'react'; seat: Seat; uid: string; now: number }
  | { kind: 'timeout'; now: number }
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
  /** A play in its reaction window. `remainingMs` counts from when the view was made. */
  window: { seat: Seat; cards: VisibleCard[]; remainingMs: number; canceled: boolean; reactions: number } | null;
  /** Cards in your hand you could react with now. Only ever about your own hand. */
  reactWith: string[];
  /** Round flags that are on. Public. */
  flags: string[];
  log: { text: string; private: boolean }[];
  result: RoundResult | null;
  winners: Seat[];
}
