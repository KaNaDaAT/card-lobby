/** Turn flow and control: play, endRound, endTurn, addTurns, cancel, if, log. */
import { resolveCount } from '../../packs/count';
import type { CardDef, ComboDef, Condition, Op } from '../../packs/types';
import { evalCond } from '../conditions';
import {
  cardName,
  defOf,
  handOf,
  interpolate,
  log,
  moveCard,
  nameOf,
  names,
  newId,
  participants,
  resolvePlayers,
  resolveZone,
  seatVal,
  selfSeat,
  type Rt,
} from '../runtime';
import { showdown } from '../round';
import type { ComboRule, Frame, Json, Seat } from '../types';
import { num, type OpDef, type Step } from './types';

type Hook = 'onPlay' | 'onDiscard' | 'onDraw';

/** Frames for a card's hooks, in push order (the last one runs first). `$card` is the card. */
export function hookFrames(rt: Rt, uid: string, holder: Seat, hooks: Hook[]): Frame[] {
  const def: CardDef = defOf(rt, uid);
  return hooks
    .filter((hook) => def[hook]?.length)
    .map((hook) => ({ kind: 'effect', ops: def[hook]!, pc: 0, ctx: { self: seatVal(holder), card: uid }, source: uid }));
}

const comboRules = (rt: Rt): ComboRule[] => (rt.pack.rules.combos ?? []).map(({ name, size, match }) => ({ name, size, match }));

/** The combo a set of cards makes, if any. */
export function findCombo(combos: readonly ComboRule[], cardIds: readonly string[]): ComboRule | undefined {
  return combos.find(
    (c) =>
      c.size === cardIds.length &&
      (c.match === 'same' ? cardIds.every((id) => id === cardIds[0]) : new Set(cardIds).size === cardIds.length),
  );
}

/** How long a reaction window stays open, or 0 when no card in this round's deck can react. */
export function reactionWindowMs(rt: Rt): number {
  const players = participants(rt).length;
  if (!rt.pack.cards.some((c) => c.onReact?.length && resolveCount(c.count, players) > 0)) return 0;
  const raw = rt.pack.rules.reactions?.seconds ?? 3;
  const seconds = typeof raw === 'object' ? Number(rt.s.options[raw.option]) : raw;
  return Math.max(1, Number.isFinite(seconds) ? seconds : 3) * 1000;
}

/** The effects of a play: each card's onDiscard first, then its onPlay, or the combo's ops. */
function effectFrames(rt: Rt, uids: string[], self: Seat): Frame[] {
  const discards = [...uids].reverse().flatMap((uid) => hookFrames(rt, uid, self, ['onDiscard']));
  if (uids.length === 1) return [...hookFrames(rt, uids[0]!, self, ['onPlay']), ...discards];
  const rule = findCombo(comboRules(rt), uids.map((uid) => defOf(rt, uid).id));
  const combo = rt.pack.rules.combos?.find((c: ComboDef) => c.name === rule?.name);
  const main: Frame[] = combo
    ? [{ kind: 'effect', ops: combo.ops, pc: 0, ctx: { self: seatVal(self) }, source: uids[0]!, combo: combo.name }]
    : [];
  return [...main, ...discards];
}

function resolvePlay(rt: Rt, uids: string[], self: Seat, canceled: boolean, repeat: boolean): Step {
  const frames = canceled ? [] : effectFrames(rt, uids, self);
  // A repeating play asks again once the effects are done.
  if (repeat) return { push: frames, stay: true };
  return frames.length ? { push: frames } : 'next';
}

/**
 * The active player plays cards from their hand: one card, or several that make a combo. With
 * `min: 0` they may pass. With `repeat`, they play until they pass. When the deck has cards
 * that react, each play first waits out its reaction window.
 */
export const play: OpDef = {
  status: 'ready',
  params: { min: 'int', max: 'int', repeat: 'bool', to: 'zone', pass: 'text' },
  required: [],
  asks: true,
  run(rt, op, frame) {
    const self = selfSeat(rt);
    const hand = handOf(rt, self);
    const repeat = op.repeat === true;
    const answer = frame.answer;
    if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
      // Set when the play's reaction window opened, then when it closed.
      if (answer.waiting) return 'wait';
      return resolvePlay(rt, answer.cards as string[], self, answer.canceled === true, repeat);
    }
    if (answer === undefined) {
      const min = num(op.min, 1);
      if (!hand.cards.length) return min === 0 ? 'next' : 'abort';
      const max = Math.min(num(op.max, 1), hand.cards.length);
      const alone = hand.cards.filter((uid) => !defOf(rt, uid).comboOnly);
      const pass = min === 0 && typeof op.pass === 'string' ? { pass: op.pass } : {};
      return { ask: { kind: 'play', choices: [...hand.cards], alone, combos: comboRules(rt), min: Math.min(min, max), max, ...pass } };
    }
    const uids = answer as string[];
    if (!uids.length) return 'next';
    const to = resolveZone(rt, op.to ?? 'played:self');
    if (!to) return 'abort';
    for (const uid of uids) moveCard(rt, uid, hand, to, 'bottom', true);
    const combo = uids.length > 1 ? findCombo(comboRules(rt), uids.map((uid) => defOf(rt, uid).id)) : undefined;
    const list = uids.map((uid) => cardName(rt, uid)).join(' and ');
    log(rt, `${nameOf(rt, self)} plays ${list}${combo ? ` (${combo.name.toLowerCase()})` : ''}.`);
    const windowMs = reactionWindowMs(rt);
    if (windowMs > 0) {
      rt.s.stack.push({ id: newId(rt, 'w'), seat: self, cards: [...uids], zone: to.id, endsAt: rt.now + windowMs, canceled: false, reactions: 0 });
      frame.answer = { cards: uids, waiting: true };
      return 'wait';
    }
    return resolvePlay(rt, uids, self, false, repeat);
  },
};

/** Called when a reaction window closes: the waiting play resolves, or not if it was canceled. */
export function closeWindow(rt: Rt): void {
  const window = rt.s.stack.pop();
  const frame = rt.s.program.at(-1);
  if (!window || !frame) return;
  const answer: Json = { cards: window.cards, canceled: window.canceled };
  frame.answer = answer;
}

export const endRound: OpDef = {
  status: 'ready',
  params: { by: 'by' },
  required: ['by'],
  run(rt) {
    showdown(rt);
    return 'halt';
  },
};

/** Ends the current turn at once, without the rest of the turn's ops (Skip). `all` also drops extra turns owed. */
export const endTurn: OpDef = {
  status: 'ready',
  params: { all: 'bool' },
  required: [],
  run(rt, op) {
    if (op.all === true) rt.s.turn.owed[rt.s.turn.seat] = 0;
    return 'endTurn';
  },
};

/** The players take `count` turns in a row when their turn comes (Attack). Owed turns do not add up. */
export const addTurns: OpDef = {
  status: 'ready',
  params: { who: 'players', count: 'int' },
  required: ['who', 'count'],
  run(rt, op) {
    const seats = resolvePlayers(rt, op.who);
    const count = Math.max(1, num(op.count, 1));
    if (!seats.length) return 'abort';
    for (const seat of seats) rt.s.turn.owed[seat] = count - 1;
    log(rt, `${names(rt, seats)} ${seats.length === 1 ? 'takes' : 'take'} ${count} turns in a row.`);
    return 'next';
  },
};

/** Cancels the play in the reaction window, or brings it back if it was canceled (a Nope on a Nope). */
export const cancel: OpDef = {
  status: 'ready',
  params: { what: 'what' },
  required: ['what'],
  reactOnly: true,
  run(rt) {
    const top = rt.s.stack.at(-1);
    if (!top) return 'abort';
    top.canceled = !top.canceled;
    const what = `${nameOf(rt, top.seat)}'s ${top.cards.map((uid) => cardName(rt, uid)).join(' and ')}`;
    log(rt, top.canceled ? `${what} is stopped.` : `${what} is back on.`);
    return 'next';
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
