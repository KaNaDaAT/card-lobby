import type { Op } from '../../packs/types';
import type { Rt } from '../runtime';
import type { Frame, Prompt } from '../types';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A question an op asks the active player. The interpreter adds id, recipient and source. */
export type Ask = DistributiveOmit<Prompt, 'id' | 'to' | 'optional' | 'source'>;

/**
 * What an op tells the interpreter. `next` moves on, `abort` skips the rest of the effect,
 * `halt` means the round ended, `ask` waits for an answer (the op then runs again with
 * `frame.answer` set), `push` moves on and runs the given frames first (last one on top).
 */
export type Step = 'next' | 'abort' | 'halt' | { ask: Ask } | { push: Frame[] };

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
  | 'audience';

export interface OpDef {
  /** `future` ops are designed but not built. Packs that use them are rejected. */
  status: 'ready' | 'future';
  params: Record<string, ParamKind>;
  required: string[];
  /** Ops that ask a player. Not allowed in `roundSetup`. */
  asks?: boolean;
  run?(rt: Rt, op: Op, frame: Frame): Step;
}

/** Reads a numeric param with a default. Validation guarantees the type. */
export const num = (value: unknown, fallback: number): number => (typeof value === 'number' ? value : fallback);
