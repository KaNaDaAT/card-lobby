import type { Op } from '../../packs/types';
import type { Rt } from '../runtime';
import type { Frame, Prompt } from '../types';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A question an op asks. The interpreter adds id and source, and sends it to `self` unless `to` says otherwise. */
export type Ask = DistributiveOmit<Prompt, 'id' | 'to' | 'optional' | 'source' | 'combo'> & { to?: number };

/**
 * What an op tells the interpreter. `next` moves on, `abort` skips the rest of the effect,
 * `halt` means the round ended, `ask` waits for an answer (the op then runs again with
 * `frame.answer` set), `push` moves on and runs the given frames first (last one on top).
 * `wait` holds while a reaction window is open; the op runs again once it closes. `again`
 * runs the op afresh next time (a play that repeats). `push` with `stay` runs the frames, then
 * the op afresh. `endTurn` ends the whole turn now.
 */
export type Step = 'next' | 'abort' | 'halt' | 'wait' | 'again' | 'endTurn' | { ask: Ask } | { push: Frame[]; stay?: boolean };

/** How the validator checks a param. See src/packs/validate.ts. */
export type ParamKind =
  | 'players'
  | 'zone'
  | 'zones'
  | 'as'
  | 'var'
  | 'count'
  | 'int'
  | 'bool'
  | 'at'
  | 'cardId'
  | 'status'
  | 'until'
  | 'text'
  | 'values'
  | 'ops'
  | 'cond'
  | 'by'
  | 'audience'
  | 'cardIds'
  | 'pick'
  | 'what'
  | 'flag'
  | 'flagTo'
  | 'direction';

export interface OpDef {
  /** `future` ops are designed but not built. Packs that use them are rejected. */
  status: 'ready' | 'future';
  params: Record<string, ParamKind>;
  required: string[];
  /** Ops that ask a player. Not allowed in `roundSetup` or `onReact`. */
  asks?: boolean;
  /** Only allowed in `onReact`. */
  reactOnly?: boolean;
  run?(rt: Rt, op: Op, frame: Frame): Step;
}

/** Reads a numeric param with a default. Validation guarantees the type. */
export const num = (value: unknown, fallback: number): number => (typeof value === 'number' ? value : fallback);
