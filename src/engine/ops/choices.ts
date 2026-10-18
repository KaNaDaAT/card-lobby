/** Choices: choosePlayer, selectPlayers, guess, choosePosition, confirm. */
import { resolveCount } from '../../packs/count';
import type { Op } from '../../packs/types';
import {
  handOf,
  interpolate,
  isIn,
  isUntargetable,
  log,
  nameOf,
  participants,
  resolvePlayers,
  resolveZone,
  seatVal,
  selfSeat,
  setVar,
  type Rt,
} from '../runtime';
import type { Seat } from '../types';
import type { OpDef } from './types';

/** Players an op may pick: still in, not protected (you can always pick yourself), holding a card if asked. */
function candidates(rt: Rt, op: Op): Seat[] {
  const self = selfSeat(rt);
  return resolvePlayers(rt, op.from).filter(
    (seat) =>
      isIn(rt, seat) &&
      (op.includeProtected === true || seat === self || !isUntargetable(rt, seat)) &&
      (op.holding === undefined || handOf(rt, seat).cards.some((uid) => rt.s.cards[uid]?.cardId === op.holding)),
  );
}

export const choosePlayer: OpDef = {
  status: 'ready',
  params: { as: 'as', from: 'players', holding: 'cardId', auto: 'bool', includeProtected: 'bool' },
  required: ['as', 'from'],
  asks: true,
  run(rt, op, frame) {
    const self = selfSeat(rt);
    let seat: Seat;
    if (frame.answer !== undefined) {
      seat = frame.answer as Seat;
    } else {
      const choices = candidates(rt, op);
      if (!choices.length) {
        log(rt, `${nameOf(rt, self)} has nobody to choose. Nothing happens.`);
        return 'abort';
      }
      if (choices.length > 1 || op.auto !== true) return { ask: { kind: 'choosePlayer', choices } };
      seat = choices[0]!;
    }
    setVar(rt, String(op.as), seatVal(seat));
    log(rt, seat === self ? `${nameOf(rt, self)} chooses themselves.` : `${nameOf(rt, self)} chooses ${nameOf(rt, seat)}.`);
    return 'next';
  },
};

export const selectPlayers: OpDef = {
  status: 'ready',
  params: { as: 'as', from: 'players', includeProtected: 'bool' },
  required: ['as', 'from'],
  run(rt, op) {
    const seats = candidates(rt, op);
    if (!seats.length) return 'abort';
    setVar(rt, String(op.as), seats.map(seatVal));
    return 'next';
  },
};

/** Card values present in this round's deck. */
export function deckValues(rt: Rt): number[] {
  const players = participants(rt).length;
  const values = rt.pack.cards
    .filter((c) => c.value !== undefined && resolveCount(c.count, players) > 0)
    .map((c) => c.value!);
  return [...new Set(values)].sort((a, b) => a - b);
}

export const guess: OpDef = {
  status: 'ready',
  params: { as: 'as', exclude: 'values' },
  required: ['as'],
  asks: true,
  run(rt, op, frame) {
    if (frame.answer === undefined) {
      const exclude = Array.isArray(op.exclude) ? op.exclude : [];
      const choices = deckValues(rt).filter((v) => !exclude.includes(v));
      return choices.length ? { ask: { kind: 'guess', choices } } : 'abort';
    }
    const value = frame.answer as number;
    setVar(rt, String(op.as), value);
    const cards = rt.pack.cards.filter((c) => c.value === value).map((c) => c.name);
    log(rt, `${nameOf(rt, selfSeat(rt))} guesses ${value}${cards.length ? ` (${cards.join(' or ')})` : ''}.`);
    return 'next';
  },
};

export const choosePosition: OpDef = {
  status: 'ready',
  params: { zone: 'zone', as: 'as' },
  required: ['zone', 'as'],
  asks: true,
  run(rt, op, frame) {
    const zone = resolveZone(rt, op.zone);
    if (!zone || !zone.cards.length) return 'abort';
    if (frame.answer === undefined) return { ask: { kind: 'choosePosition', choices: zone.cards.length } };
    const pos = frame.answer as number;
    setVar(rt, String(op.as), pos);
    log(rt, `You chose position ${pos + 1} of ${zone.cards.length} (1 is the top).`, [selfSeat(rt)]);
    return 'next';
  },
};

export const confirm: OpDef = {
  status: 'ready',
  params: { as: 'as', text: 'text' },
  required: ['as', 'text'],
  asks: true,
  run(rt, op, frame) {
    if (frame.answer === undefined) return { ask: { kind: 'confirm', text: interpolate(rt, String(op.text)) } };
    setVar(rt, String(op.as), frame.answer === true);
    return 'next';
  },
};
