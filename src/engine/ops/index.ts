/**
 * The fixed list of ops this engine knows. Packs combine these and nothing else. A pack that
 * names an op missing here, or marked `future`, is rejected by validation before it runs.
 */
import { buildDeck, deal, draw, move, shuffle } from './cards';
import { choosePlayer, choosePosition, confirm, guess, selectPlayers } from './choices';
import { compareHands, discard, eliminate, peek, reveal, status, swap } from './effects';
import { endRound, ifOp, logOp, play } from './flow';
import type { OpDef } from './types';

const future: OpDef = { status: 'future', params: {}, required: [] };

export const OPS: Record<string, OpDef> = {
  buildDeck,
  shuffle,
  move,
  deal,
  draw,
  play,
  endRound,
  choosePlayer,
  selectPlayers,
  guess,
  choosePosition,
  confirm,
  peek,
  reveal,
  swap,
  discard,
  compareHands,
  eliminate,
  status,
  if: ifOp,
  log: logOp,
  // Designed for Exploding Kittens (milestone 7), not built yet.
  endTurn: future,
  addTurns: future,
  reverse: future,
  chooseCard: future,
  nameCard: future,
  take: future,
  cancel: future,
  reorder: future,
};

export type { OpDef, ParamKind, Step } from './types';

/** Looks up an op by name. Own keys only, so names like "constructor" are unknown ops. */
export function getOp(name: unknown): OpDef | undefined {
  return typeof name === 'string' && Object.hasOwn(OPS, name) ? OPS[name] : undefined;
}
