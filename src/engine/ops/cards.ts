/** Setup and card movement: buildDeck, shuffle, move, deal, draw. */
import { resolveCount } from '../../packs/count';
import { randInt, shuffleInPlace } from '../rng';
import {
  cardName,
  createCard,
  handOf,
  log,
  moveCard,
  nameOf,
  newId,
  participants,
  resolvePlayers,
  resolveValue,
  resolveZone,
  resolveZones,
  zoneLabel,
  type Rt,
} from '../runtime';
import type { Zone } from '../types';
import { num, type OpDef } from './types';

export const buildDeck: OpDef = {
  status: 'ready',
  params: { to: 'zone' },
  required: ['to'],
  run(rt, op) {
    const to = resolveZone(rt, op.to);
    if (!to) return 'abort';
    const players = participants(rt).length;
    for (const def of rt.pack.cards) {
      for (let i = resolveCount(def.count, players); i > 0; i--) {
        const uid = createCard(rt, def.id);
        rt.s.cards[uid]!.faceUp = to.visibility === 'public';
        to.cards.push(uid);
      }
    }
    return 'next';
  },
};

/**
 * Shuffles and gives every card a new uid, assigned in the new order. Knowledge is cleared,
 * so nobody can follow a card through a shuffle.
 */
export function shuffleZone(rt: Rt, zone: Zone): void {
  shuffleInPlace(rt.s.rng, zone.cards);
  zone.cards = zone.cards.map((old) => {
    const card = rt.s.cards[old]!;
    delete rt.s.cards[old];
    const uid = newId(rt, 'c');
    rt.s.cards[uid] = { uid, cardId: card.cardId, faceUp: zone.visibility === 'public', knownBy: [] };
    return uid;
  });
}

export const shuffle: OpDef = {
  status: 'ready',
  params: { zone: 'zones' },
  required: ['zone'],
  run(rt, op) {
    for (const zone of resolveZones(rt, op.zone)) shuffleZone(rt, zone);
    return 'next';
  },
};

/** Where `at` puts a card: top, bottom, random, or a position stored in a variable. */
function position(rt: Rt, at: unknown, to: Zone): 'top' | 'bottom' | number {
  if (at === undefined || at === 'top') return 'top';
  if (at === 'bottom') return 'bottom';
  if (at === 'random') return randInt(rt.s.rng, to.cards.length + 1);
  const value = resolveValue(rt, at);
  return typeof value === 'number' ? value : 'top';
}

export const move: OpDef = {
  status: 'ready',
  params: { from: 'zones', to: 'zone', count: 'count', faceUp: 'bool', at: 'at', card: 'var' },
  required: ['from', 'to'],
  run(rt, op) {
    const to = resolveZone(rt, op.to);
    if (!to) return 'abort';
    const from = resolveZones(rt, op.from);
    const faceUp = op.faceUp === true;
    if (op.card !== undefined) {
      const uid = resolveValue(rt, op.card);
      const source = typeof uid === 'string' ? from.find((z) => z.cards.includes(uid)) : undefined;
      if (typeof uid !== 'string' || !source) return 'abort';
      moveCard(rt, uid, source, to, position(rt, op.at, to), faceUp);
      return 'next';
    }
    let moved = 0;
    for (const zone of from) {
      const n = op.count === 'all' ? zone.cards.length : Math.min(num(op.count, 1), zone.cards.length);
      for (const uid of zone.cards.slice(0, n)) {
        moveCard(rt, uid, zone, to, position(rt, op.at, to), faceUp);
        moved++;
      }
    }
    return moved === 0 && op.count !== 'all' ? 'abort' : 'next';
  },
};

export const deal: OpDef = {
  status: 'ready',
  params: { from: 'zone', to: 'players', count: 'int' },
  required: ['from', 'to'],
  run(rt, op) {
    const from = resolveZone(rt, op.from);
    if (!from) return 'abort';
    const seats = resolvePlayers(rt, op.to);
    for (let round = num(op.count, 1); round > 0; round--) {
      for (const seat of seats) {
        const uid = from.cards[0];
        if (uid === undefined) return 'abort';
        moveCard(rt, uid, from, handOf(rt, seat), 'bottom');
      }
    }
    return 'next';
  },
};

export const draw: OpDef = {
  status: 'ready',
  params: { who: 'players', count: 'int', fallback: 'zone' },
  required: ['who'],
  run(rt, op, frame) {
    const deck = rt.s.zones.deck;
    const fallback = op.fallback === undefined ? null : resolveZone(rt, op.fallback);
    const seats = resolvePlayers(rt, op.who);
    if (!seats.length) return 'abort';
    for (const seat of seats) {
      for (let i = num(op.count, 1); i > 0; i--) {
        const source = deck?.cards.length ? deck : fallback?.cards.length ? fallback : null;
        if (!source) return 'abort';
        const uid = source.cards[0]!;
        // Hands read oldest to newest.
        moveCard(rt, uid, source, handOf(rt, seat), 'bottom');
        if (source === deck) {
          // The draw at the start of every turn goes without saying.
          if (frame.kind !== 'turn') log(rt, `${nameOf(rt, seat)} draws a new card.`);
          log(rt, `You drew ${cardName(rt, uid)}.`, [seat]);
        } else {
          log(rt, `${nameOf(rt, seat)} takes ${zoneLabel(rt, source)}.`);
          log(rt, `You took ${cardName(rt, uid)}.`, [seat]);
        }
      }
    }
    return 'next';
  },
};
