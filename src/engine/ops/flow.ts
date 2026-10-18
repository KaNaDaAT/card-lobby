/** Turn flow and control: play, endRound, if, log. */
import type { CardDef, Condition, Op } from '../../packs/types';
import { evalCond } from '../conditions';
import { cardName, defOf, handOf, interpolate, log, moveCard, nameOf, playedOf, resolvePlayers, seatVal, selfSeat, type Rt } from '../runtime';
import { showdown } from '../round';
import type { Frame, Seat } from '../types';
import { num, type OpDef } from './types';

type Hook = 'onPlay' | 'onDiscard';

/** Frames for a card's hooks, in push order (the last one runs first). */
export function hookFrames(rt: Rt, uid: string, holder: Seat, hooks: Hook[]): Frame[] {
  const def: CardDef = defOf(rt, uid);
  return hooks
    .filter((hook) => def[hook]?.length)
    .map((hook) => ({ kind: 'effect', ops: def[hook]!, pc: 0, ctx: { self: seatVal(holder) }, source: uid }));
}

export const play: OpDef = {
  status: 'ready',
  params: { min: 'int', max: 'int' },
  required: [],
  asks: true,
  run(rt, op, frame) {
    const self = selfSeat(rt);
    const hand = handOf(rt, self);
    if (!hand.cards.length) return 'abort';
    if (frame.answer === undefined) {
      const max = Math.min(num(op.max, 1), hand.cards.length);
      return { ask: { kind: 'play', choices: [...hand.cards], min: Math.min(num(op.min, 1), max), max } };
    }
    const uids = frame.answer as string[];
    for (const uid of uids) {
      moveCard(rt, uid, hand, playedOf(rt, self), 'bottom', true);
      log(rt, `${nameOf(rt, self)} plays ${cardName(rt, uid)}.`);
    }
    // The first card resolves first. For each card, onDiscard runs before onPlay.
    return { push: [...uids].reverse().flatMap((uid) => hookFrames(rt, uid, self, ['onPlay', 'onDiscard'])) };
  },
};

export const endRound: OpDef = {
  status: 'ready',
  params: { by: 'by' },
  required: ['by'],
  run(rt) {
    showdown(rt);
    return 'halt';
  },
};

export const ifOp: OpDef = {
  status: 'ready',
  params: { cond: 'cond', then: 'ops', else: 'ops' },
  required: ['cond', 'then'],
  run(rt, op) {
    const branch = (evalCond(rt, op.cond as Condition) ? op.then : op.else) as Op[] | undefined;
    return branch?.length ? { push: [{ kind: 'block', ops: branch, pc: 0 }] } : 'next';
  },
};

export const logOp: OpDef = {
  status: 'ready',
  params: { text: 'text', to: 'audience' },
  required: ['text'],
  run(rt, op) {
    const to = op.to === undefined || op.to === 'all' ? 'all' : resolvePlayers(rt, op.to);
    log(rt, interpolate(rt, String(op.text)), to);
    return 'next';
  },
};
