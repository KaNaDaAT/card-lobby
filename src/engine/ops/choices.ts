/** Choices: choosePlayer, selectPlayers, guess, choosePosition, confirm, chooseCard, nameCard. */
import { resolveCount } from '../../packs/count';
import type { Op } from '../../packs/types';
import {
  cardName,
  cardOf,
  handOf,
  interpolate,
  isIn,
  isUntargetable,
  log,
  nameOf,
  participants,
  resolvePlayer,
  resolvePlayers,
  resolveValue,
  resolveZone,
  seatVal,
  selfSeat,
  setVar,
  type Rt,
} from '../runtime';
import type { Seat } from '../types';
import { knows } from '../view';
import type { OpDef } from './types';

/**
 * Players an op may pick: still in, not protected (you can always pick yourself), holding a
 * given card or any cards at all if asked, and not named in `except`.
 */
function candidates(rt: Rt, op: Op): Seat[] {
  const self = selfSeat(rt);
  const except = op.except === undefined ? [] : resolvePlayers(rt, op.except);
  return resolvePlayers(rt, op.from).filter(
    (seat) =>
      isIn(rt, seat) &&
      !except.includes(seat) &&
      (op.includeProtected === true || seat === self || !isUntargetable(rt, seat)) &&
      (op.holding === undefined || handOf(rt, seat).cards.some((uid) => rt.s.cards[uid]?.cardId === op.holding)) &&
      (op.withCards !== true || handOf(rt, seat).cards.length > 0),
  );
}

export const choosePlayer: OpDef = {
  status: 'ready',
  params: { as: 'as', from: 'players', except: 'players', holding: 'cardId', withCards: 'bool', auto: 'bool', includeProtected: 'bool' },
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
  params: { as: 'as', from: 'players', except: 'players', withCards: 'bool', includeProtected: 'bool' },
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
    const cards = rt.pack.cards.filter((c) => c.value === value);
    const shown = cards.find((c) => c.valueLabel)?.valueLabel ?? value;
    log(rt, `${nameOf(rt, selfSeat(rt))} guesses ${shown}${cards.length ? ` (${cards.map((c) => c.name).join(' or ')})` : ''}.`);
    return 'next';
  },
};

/**
 * The `card` param of a question, so the table can show the card it is about. Only a card the
 * answering seat (self) knows.
 */
function shownCard(rt: Rt, ref: unknown): { card?: string } {
  const uid = resolveValue(rt, ref);
  if (typeof uid !== 'string') return {};
  const home = Object.values(rt.s.zones).find((z) => z.cards.includes(uid));
  return home && knows(rt.s, selfSeat(rt), cardOf(rt, uid), home) ? { card: uid } : {};
}

/**
 * A position in a zone, 0 is the top. For a card already in the zone (Mouse Trapper) there are
 * as many positions as cards. With `insert`, for a card going in, there is one more: the bottom.
 * `card` names the card being placed, so the question can show it.
 */
export const choosePosition: OpDef = {
  status: 'ready',
  params: { zone: 'zone', as: 'as', insert: 'bool', card: 'var' },
  required: ['zone', 'as'],
  asks: true,
  run(rt, op, frame) {
    const zone = resolveZone(rt, op.zone);
    if (!zone || (!zone.cards.length && op.insert !== true)) return 'abort';
    const positions = zone.cards.length + (op.insert === true ? 1 : 0);
    if (frame.answer === undefined) return { ask: { kind: 'choosePosition', choices: positions, ...shownCard(rt, op.card) } };
    const pos = frame.answer as number;
    setVar(rt, String(op.as), pos);
    log(rt, `You chose position ${pos + 1} of ${positions} (1 is the top).`, [selfSeat(rt)]);
    return 'next';
  },
};

/**
 * One card from a zone, picked by `by` (yourself by default). Favor has the target pick a card
 * from their own hand. Stores the card's uid.
 */
export const chooseCard: OpDef = {
  status: 'ready',
  params: { as: 'as', from: 'zone', by: 'players', text: 'text' },
  required: ['as', 'from'],
  asks: true,
  run(rt, op, frame) {
    const zone = resolveZone(rt, op.from);
    const by = op.by === undefined ? selfSeat(rt) : resolvePlayer(rt, op.by);
    if (!zone || !zone.cards.length || by === null) return 'abort';
    if (frame.answer === undefined) {
      const text = typeof op.text === 'string' ? { text: interpolate(rt, op.text) } : {};
      return { ask: { kind: 'chooseCard', choices: [...zone.cards], to: by, ...text } };
    }
    setVar(rt, String(op.as), frame.answer as string);
    return 'next';
  },
};

/** Names a card that is in this round's deck. Stores its card id. Everyone hears the name. */
export const nameCard: OpDef = {
  status: 'ready',
  params: { as: 'as' },
  required: ['as'],
  asks: true,
  run(rt, op, frame) {
    if (frame.answer === undefined) {
      const players = participants(rt).length;
      const choices = rt.pack.cards.filter((c) => resolveCount(c.count, players) > 0).map((c) => c.id);
      return choices.length ? { ask: { kind: 'nameCard', choices } } : 'abort';
    }
    const id = frame.answer as string;
    setVar(rt, String(op.as), id);
    log(rt, `${nameOf(rt, selfSeat(rt))} names ${rt.defs.get(id)?.name ?? id}.`);
    return 'next';
  },
};

/** Yes or no. `card` names the card the question is about, like the one you may swap for. */
export const confirm: OpDef = {
  status: 'ready',
  params: { as: 'as', text: 'text', card: 'var' },
  required: ['as', 'text'],
  asks: true,
  run(rt, op, frame) {
    if (frame.answer === undefined) return { ask: { kind: 'confirm', text: interpolate(rt, String(op.text)), ...shownCard(rt, op.card) } };
    setVar(rt, String(op.as), frame.answer === true);
    return 'next';
  },
};
