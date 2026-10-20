/** Effects: peek, reveal, swap, passHands, discard, compareHands, eliminate, status, take. */
import { randInt } from '../rng';
import {
  allSeats,
  cardName,
  cardValue,
  forget,
  handOf,
  isIn,
  know,
  log,
  moveCard,
  nameOf,
  names,
  playedOf,
  resolvePlayer,
  resolvePlayers,
  resolveValue,
  resolveZone,
  resolveZones,
  seatVal,
  selfSeat,
  setVar,
  zoneLabel,
  type Rt,
} from '../runtime';
import { knockOut } from '../round';
import type { Status, Zone } from '../types';
import { hookFrames } from './flow';
import { num, type OpDef } from './types';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const cardList = (rt: Rt, uids: string[]) => uids.map((uid) => cardName(rt, uid)).join(' and ');

export const peek: OpDef = {
  status: 'ready',
  params: { zone: 'zone', count: 'int', as: 'as' },
  required: ['zone'],
  run(rt, op) {
    const self = selfSeat(rt);
    const zone = resolveZone(rt, op.zone);
    if (!zone || !zone.cards.length) {
      log(rt, `${nameOf(rt, self)} has nothing to look at. Nothing happens.`);
      return 'abort';
    }
    const uids = zone.cards.slice(0, num(op.count, 1));
    for (const uid of uids) know(rt, uid, [self]);
    if (op.as !== undefined) setVar(rt, String(op.as), uids.length === 1 ? uids[0]! : uids);
    const what =
      uids.length === zone.cards.length
        ? zoneLabel(rt, zone)
        : `the top ${uids.length === 1 ? 'card' : `${uids.length} cards`} of ${zoneLabel(rt, zone)}`;
    log(rt, `${nameOf(rt, self)} looks at ${what}.`);
    log(rt, uids.length > 1 ? `You see, from the top: ${uids.map((uid) => cardName(rt, uid)).join(', ')}.` : `You see ${cardList(rt, uids)}.`, [self]);
    return 'next';
  },
};

/** Shows the cards of a zone to some players. `as` stores what was shown, like peek. */
export const reveal: OpDef = {
  status: 'ready',
  params: { zone: 'zones', to: 'audience', as: 'as' },
  required: ['zone', 'to'],
  run(rt, op) {
    const seats = op.to === 'all' ? allSeats(rt) : resolvePlayers(rt, op.to);
    const zones = resolveZones(rt, op.zone).filter((z) => z.cards.length);
    if (!zones.length || !seats.length) return 'abort';
    for (const zone of zones) {
      for (const uid of zone.cards) know(rt, uid, seats);
      log(rt, `${capitalize(zoneLabel(rt, zone))}: ${cardList(rt, zone.cards)}.`, op.to === 'all' ? 'all' : seats);
    }
    const uids = zones.flatMap((z) => z.cards);
    if (op.as !== undefined) setVar(rt, String(op.as), uids.length === 1 ? uids[0]! : uids);
    return 'next';
  },
};

/** Exchanges the contents of two zones. Each previous holder still knows what they gave away. */
export const swap: OpDef = {
  status: 'ready',
  params: { a: 'zone', b: 'zone' },
  required: ['a', 'b'],
  run(rt, op) {
    const a = resolveZone(rt, op.a);
    const b = resolveZone(rt, op.b);
    if (!a || !b || a === b || !a.cards.length || !b.cards.length) return 'abort';
    const fromA = [...a.cards];
    const fromB = [...b.cards];
    for (const uid of fromA) moveCard(rt, uid, a, b, 'bottom');
    for (const uid of fromB) moveCard(rt, uid, b, a, 'bottom');
    log(rt, swapText(rt, a, b));
    if (a.owner !== undefined) log(rt, `You got ${cardList(rt, fromB)}.`, [a.owner]);
    if (b.owner !== undefined) log(rt, `You got ${cardList(rt, fromA)}.`, [b.owner]);
    return 'next';
  },
};

/**
 * Each of the players hands their whole hand to the next of them in turn order, or the previous
 * one. Everyone still knows the cards they passed on.
 */
export const passHands: OpDef = {
  status: 'ready',
  params: { who: 'players', direction: 'direction' },
  required: ['who'],
  run(rt, op) {
    const self = selfSeat(rt);
    const n = rt.s.players.length;
    const dir = rt.s.turn.direction;
    // Turn order from the active player, whatever order the variable holds.
    const seats = resolvePlayers(rt, op.who)
      .filter((seat) => isIn(rt, seat))
      .sort((a, b) => ((((a - self) * dir) % n) + n) % n - ((((b - self) * dir) % n) + n) % n);
    if (seats.length < 2) return 'abort';
    const step = op.direction === 'previous' ? -1 : 1;
    const hands = seats.map((seat) => [...handOf(rt, seat).cards]);
    seats.forEach((seat, i) => {
      const to = seats[(i + step + seats.length) % seats.length]!;
      for (const uid of hands[i]!) moveCard(rt, uid, handOf(rt, seat), handOf(rt, to), 'bottom');
    });
    log(rt, `${names(rt, seats)} pass their cards to the ${step === 1 ? 'next' : 'previous'} player.`);
    seats.forEach((seat, i) => {
      const got = hands[(i - step + seats.length) % seats.length]!;
      if (got.length) log(rt, `You got ${cardList(rt, got)}.`, [seat]);
    });
    return 'next';
  },
};

function swapText(rt: Rt, a: Zone, b: Zone): string {
  if (a.owner !== undefined && b.owner !== undefined) return `${nameOf(rt, a.owner)} and ${nameOf(rt, b.owner)} trade cards.`;
  if (a.owner !== undefined) return `${nameOf(rt, a.owner)} swaps their card with ${zoneLabel(rt, b)}.`;
  if (b.owner !== undefined) return `${nameOf(rt, b.owner)} swaps their card with ${zoneLabel(rt, a)}.`;
  return `${capitalize(zoneLabel(rt, a))} and ${zoneLabel(rt, b)} trade places.`;
}

/** Forced: the hand goes face up in front of the player. Fires onDiscard, not onPlay. */
export const discard: OpDef = {
  status: 'ready',
  params: { who: 'players' },
  required: ['who'],
  run(rt, op) {
    const seat = resolvePlayer(rt, op.who);
    if (seat === null) return 'abort';
    const hand = handOf(rt, seat);
    const uids = [...hand.cards];
    if (!uids.length) return 'abort';
    for (const uid of uids) moveCard(rt, uid, hand, playedOf(rt, seat), 'bottom', true);
    log(rt, `${nameOf(rt, seat)} puts ${cardList(rt, uids)} face up.`);
    const frames = [...uids].reverse().flatMap((uid) => hookFrames(rt, uid, seat, ['onDiscard']));
    return frames.length ? { push: frames } : 'next';
  },
};

/** Shows each hand to the other player. Stores the lower player, nothing on a tie. */
export const compareHands: OpDef = {
  status: 'ready',
  params: { a: 'players', b: 'players', as: 'as' },
  required: ['a', 'b', 'as'],
  run(rt, op) {
    const sa = resolvePlayer(rt, op.a);
    const sb = resolvePlayer(rt, op.b);
    if (sa === null || sb === null || sa === sb) return 'abort';
    const ca = handOf(rt, sa).cards[0];
    const cb = handOf(rt, sb).cards[0];
    if (!ca || !cb) return 'abort';
    know(rt, ca, [sb]);
    know(rt, cb, [sa]);
    log(rt, `${names(rt, [sa, sb])} compare cards in secret.`);
    log(rt, `${nameOf(rt, sb)} has ${cardName(rt, cb)}.`, [sa]);
    log(rt, `${nameOf(rt, sa)} has ${cardName(rt, ca)}.`, [sb]);
    const va = cardValue(rt, ca);
    const vb = cardValue(rt, cb);
    setVar(rt, String(op.as), va === vb ? undefined : seatVal(va < vb ? sa : sb));
    if (va === vb) log(rt, 'It is a tie. Nothing happens.');
    return 'next';
  },
};

export const eliminate: OpDef = {
  status: 'ready',
  params: { who: 'players' },
  required: ['who'],
  run(rt, op) {
    const seats = resolvePlayers(rt, op.who).filter((seat) => isIn(rt, seat));
    if (!seats.length) return 'abort';
    for (const seat of seats) knockOut(rt, seat);
    return 'next';
  },
};

const UNTIL_TEXT: Record<Status['until'], string> = {
  ownNextTurn: ' until their next turn',
  endOfTurn: ' until the end of this turn',
  endOfRound: ' for the rest of the round',
  permanent: '',
};

export const status: OpDef = {
  status: 'ready',
  params: { who: 'players', id: 'status', until: 'until' },
  required: ['who', 'id', 'until'],
  run(rt, op) {
    const seats = resolvePlayers(rt, op.who);
    if (!seats.length) return 'abort';
    const id = String(op.id);
    const until = op.until as Status['until'];
    for (const seat of seats) {
      const player = rt.s.players[seat]!;
      player.statuses = [...player.statuses.filter((st) => st.id !== id), { id, until }];
    }
    const label = (rt.pack.rules.statuses?.[id]?.label ?? id).toLowerCase();
    log(rt, `${names(rt, seats)} ${seats.length === 1 ? 'is' : 'are'} ${label}${UNTIL_TEXT[until]}.`);
    return 'next';
  },
};

/**
 * Moves one card from a zone to another, your hand by default. `pick` is `random`, or a variable
 * holding a card uid (from chooseCard) or a card id (from nameCard). A named card the zone does
 * not hold ends the effect. Everyone hears what was named, nobody else learns a random or
 * chosen card: from a hidden hand, others forget its cards, since they cannot tell which one left.
 */
export const take: OpDef = {
  status: 'ready',
  params: { from: 'zone', pick: 'pick', to: 'zone' },
  required: ['from', 'pick'],
  run(rt, op) {
    const self = selfSeat(rt);
    const from = resolveZone(rt, op.from);
    const to = resolveZone(rt, op.to ?? 'hand:self');
    if (!from || !to || from === to || !from.cards.length) return 'abort';
    let uid: string | undefined;
    let named = false;
    if (op.pick === 'random') {
      uid = from.cards[randInt(rt.s.rng, from.cards.length)];
    } else {
      const value = resolveValue(rt, op.pick);
      if (typeof value === 'string' && from.cards.includes(value)) {
        uid = value;
      } else if (typeof value === 'string' && rt.defs.has(value)) {
        named = true;
        uid = from.cards.find((u) => rt.s.cards[u]!.cardId === value);
        if (!uid) {
          const holder = from.owner !== undefined ? nameOf(rt, from.owner) : capitalize(zoneLabel(rt, from));
          log(rt, `${holder} has no ${rt.defs.get(value)!.name}. Nothing happens.`);
          return 'abort';
        }
      }
    }
    if (!uid) return 'abort';
    moveCard(rt, uid, from, to, 'bottom');
    const card = cardName(rt, uid);
    const taker = to.owner ?? self;
    if (!named && from.visibility !== 'public') {
      const keep = [self, taker, ...(from.owner !== undefined ? [from.owner] : [])];
      forget(rt, from, keep);
      rt.s.cards[uid]!.knownBy = rt.s.cards[uid]!.knownBy.filter((seat) => keep.includes(seat));
    }
    if (from.visibility === 'public') {
      log(rt, `${nameOf(rt, taker)} takes ${card} from ${zoneLabel(rt, from)}.`);
    } else if (from.owner !== undefined) {
      const giver = nameOf(rt, from.owner);
      log(rt, named ? `${giver} gives ${nameOf(rt, taker)} ${card}.` : `${nameOf(rt, taker)} takes a card from ${giver}.`);
      if (!named) {
        log(rt, `You got ${card}.`, [taker]);
        log(rt, `${nameOf(rt, taker)} took your ${card}.`, [from.owner]);
      }
    } else {
      log(rt, `${nameOf(rt, taker)} takes a card from ${zoneLabel(rt, from)}.`);
      log(rt, `You got ${card}.`, [taker]);
    }
    return 'next';
  },
};
