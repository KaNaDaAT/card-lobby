/**
 * Shared helpers for the interpreter and the ops: frames and variables, references to players,
 * zones and values (docs/PACK_FORMAT.md, "References"), card moves that keep knowledge
 * correct, and the log.
 */
import type { CardDef, Pack } from '../packs/types';
import type { CardInstance, Frame, GameState, Json, Seat, Zone } from './types';

export class EngineError extends Error {}

export interface Rt {
  pack: Pack;
  s: GameState;
  defs: Map<string, CardDef>;
  /** Effect aborts during this call. Setup checks use it to spot a deck that is too small. */
  aborts: number;
  /** Host clock in ms, passed in with the input. Only reaction windows use it. */
  now: number;
}

export function makeRt(pack: Pack, s: GameState, now = 0): Rt {
  return { pack, s, defs: new Map(pack.cards.map((c) => [c.id, c])), aborts: 0, now };
}

const LOG_LIMIT = 200;

// ---------- Frames and variables ----------

export function topFrame(rt: Rt): Frame | undefined {
  return rt.s.program.at(-1);
}

/** The variables visible to the running op: the nearest frame that has its own. */
export function scope(rt: Rt): Record<string, Json> {
  for (let i = rt.s.program.length - 1; i >= 0; i--) {
    const ctx = rt.s.program[i]!.ctx;
    if (ctx) return ctx;
  }
  throw new EngineError('no variable scope');
}

const varName = (ref: string) => (ref.startsWith('$') ? ref.slice(1) : ref);

export function getVar(rt: Rt, ref: string): Json | undefined {
  return scope(rt)[varName(ref)];
}

export function setVar(rt: Rt, name: string, value: Json | undefined): void {
  const ctx = scope(rt);
  if (value === undefined || value === null) delete ctx[varName(name)];
  else ctx[varName(name)] = value;
}

/** Players are stored as `{ seat }` in variables, so they never mix with plain numbers. */
export const seatVal = (seat: Seat): Json => ({ seat });

/** The seats a variable holds: one player, a list of players, or none. */
export function seatsIn(value: Json | undefined): Seat[] {
  const one = (v: Json): Seat | null =>
    v && typeof v === 'object' && !Array.isArray(v) && typeof v.seat === 'number' ? v.seat : null;
  if (Array.isArray(value)) return value.map(one).filter((s): s is Seat => s !== null);
  const seat = value === undefined ? null : one(value);
  return seat === null ? [] : [seat];
}

export function selfSeat(rt: Rt): Seat {
  const [self] = seatsIn(getVar(rt, 'self'));
  if (self === undefined) throw new EngineError('no self in scope');
  return self;
}

// ---------- Players ----------

export function nameOf(rt: Rt, seat: Seat): string {
  return rt.s.players[seat]?.name ?? `Seat ${seat + 1}`;
}

export function names(rt: Rt, seats: readonly Seat[]): string {
  const list = seats.map((s) => nameOf(rt, s));
  if (list.length <= 1) return list[0] ?? 'nobody';
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

export function isIn(rt: Rt, seat: Seat): boolean {
  return rt.s.players[seat]?.round === 'in';
}

/** Players still in this round, in seat order. */
export function inRound(rt: Rt): Seat[] {
  return rt.s.players.filter((p) => p.round === 'in').map((p) => p.seat);
}

/** Players dealt into this round (in or out, not sitting out). */
export function participants(rt: Rt): Seat[] {
  return rt.s.players.filter((p) => p.round !== 'sittingOut').map((p) => p.seat);
}

export function allSeats(rt: Rt): Seat[] {
  return rt.s.players.map((p) => p.seat);
}

export function isUntargetable(rt: Rt, seat: Seat): boolean {
  const defs = rt.pack.rules.statuses ?? {};
  return rt.s.players[seat]?.statuses.some((st) => defs[st.id]?.untargetable) ?? false;
}

/** The next player still in after `from`, going in `dir`. Null when nobody else is in. */
export function nextIn(rt: Rt, from: Seat, dir: 1 | -1 = rt.s.turn.direction): Seat | null {
  const n = rt.s.players.length;
  for (let step = 1; step < n; step++) {
    const seat = (((from + dir * step) % n) + n) % n;
    if (isIn(rt, seat)) return seat;
  }
  return null;
}

/** Players still in, starting at `from` (if in) and going around in turn direction. */
function aroundFrom(rt: Rt, from: Seat): Seat[] {
  const n = rt.s.players.length;
  const dir = rt.s.turn.direction;
  const out: Seat[] = [];
  for (let step = 0; step < n; step++) {
    const seat = (((from + dir * step) % n) + n) % n;
    if (isIn(rt, seat)) out.push(seat);
  }
  return out;
}

export function resolvePlayers(rt: Rt, ref: unknown): Seat[] {
  if (typeof ref !== 'string') return [];
  const self = selfSeat(rt);
  switch (ref) {
    case 'self':
      return [self];
    case 'next': {
      const seat = nextIn(rt, self);
      return seat === null ? [] : [seat];
    }
    case 'previous': {
      const seat = nextIn(rt, self, rt.s.turn.direction === 1 ? -1 : 1);
      return seat === null ? [] : [seat];
    }
    case 'all':
      return aroundFrom(rt, self);
    case 'others':
      return aroundFrom(rt, self).filter((s) => s !== self);
  }
  return ref.startsWith('$') ? seatsIn(getVar(rt, ref)) : [];
}

/** Exactly one player, or null. */
export function resolvePlayer(rt: Rt, ref: unknown): Seat | null {
  const seats = resolvePlayers(rt, ref);
  return seats.length === 1 ? seats[0]! : null;
}

// ---------- Zones ----------

export function zoneById(rt: Rt, id: string): Zone {
  const zone = rt.s.zones[id];
  if (!zone) throw new EngineError(`no zone "${id}"`);
  return zone;
}

export const handOf = (rt: Rt, seat: Seat) => zoneById(rt, `hand:${seat}`);
export const playedOf = (rt: Rt, seat: Seat) => zoneById(rt, `played:${seat}`);

/** `deck`, `hand:self`, `hand:$group` (several zones) and so on. */
export function resolveZones(rt: Rt, ref: unknown): Zone[] {
  if (typeof ref !== 'string') return [];
  const colon = ref.indexOf(':');
  if (colon < 0) return rt.s.zones[ref] ? [rt.s.zones[ref]] : [];
  const kind = ref.slice(0, colon);
  return resolvePlayers(rt, ref.slice(colon + 1))
    .map((seat) => rt.s.zones[`${kind}:${seat}`])
    .filter((z): z is Zone => Boolean(z));
}

export function resolveZone(rt: Rt, ref: unknown): Zone | null {
  const zones = resolveZones(rt, ref);
  return zones.length === 1 ? zones[0]! : null;
}

export function zoneLabel(rt: Rt, zone: Zone): string {
  if (zone.owner !== undefined) {
    const kind = zone.id.slice(0, zone.id.indexOf(':'));
    const label = rt.pack.rules.playerZones[kind]?.label ?? (kind === 'hand' ? 'card' : kind);
    return `${nameOf(rt, zone.owner)}'s ${label}`;
  }
  return rt.pack.rules.zones[zone.id]?.label ?? zone.id;
}

// ---------- Values ----------

/** Numbers, `$name` or `{ "option": id }`. */
export function resolveValue(rt: Rt, ref: unknown): Json | undefined {
  if (typeof ref === 'string' && ref.startsWith('$')) return getVar(rt, ref);
  if (ref && typeof ref === 'object' && 'option' in ref) return rt.s.options[String((ref as { option: unknown }).option)];
  return ref as Json;
}

// ---------- Cards ----------

export function cardOf(rt: Rt, uid: string): CardInstance {
  const card = rt.s.cards[uid];
  if (!card) throw new EngineError(`no card "${uid}"`);
  return card;
}

export function defOf(rt: Rt, uid: string): CardDef {
  const def = rt.defs.get(cardOf(rt, uid).cardId);
  if (!def) throw new EngineError(`no card definition for "${uid}"`);
  return def;
}

export const cardName = (rt: Rt, uid: string) => defOf(rt, uid).name;
export const cardValue = (rt: Rt, uid: string) => defOf(rt, uid).value ?? 0;

export function newId(rt: Rt, prefix: string): string {
  return `${prefix}${++rt.s.nextId}`;
}

export function createCard(rt: Rt, cardId: string): string {
  const uid = newId(rt, 'c');
  rt.s.cards[uid] = { uid, cardId, faceUp: false, knownBy: [] };
  return uid;
}

export function know(rt: Rt, uid: string, seats: readonly Seat[]): void {
  const card = cardOf(rt, uid);
  for (const seat of seats) if (!card.knownBy.includes(seat)) card.knownBy.push(seat);
  card.knownBy.sort((a, b) => a - b);
}

/**
 * Moves one card. Whoever held it in an owner zone keeps knowing it, and a card leaving a
 * public zone stays known to everyone, since everyone saw it there.
 */
export function moveCard(
  rt: Rt,
  uid: string,
  from: Zone,
  to: Zone,
  at: 'top' | 'bottom' | number = 'top',
  faceUp = false,
): void {
  const card = cardOf(rt, uid);
  const i = from.cards.indexOf(uid);
  if (i < 0) throw new EngineError(`card ${uid} is not in ${from.id}`);
  from.cards.splice(i, 1);
  if (from.visibility === 'owner' && from.owner !== undefined) know(rt, uid, [from.owner]);
  if (from.visibility === 'public' || card.faceUp) know(rt, uid, allSeats(rt));
  card.faceUp = to.visibility === 'public' || faceUp;
  const index = at === 'top' ? 0 : at === 'bottom' ? to.cards.length : Math.max(0, Math.min(at, to.cards.length));
  to.cards.splice(index, 0, uid);
}

// ---------- Log ----------

export function log(rt: Rt, text: string, to: 'all' | readonly Seat[] = 'all'): void {
  if (to !== 'all' && to.length === 0) return;
  rt.s.log.push({ text, to: to === 'all' ? 'all' : [...to] });
  if (rt.s.log.length > LOG_LIMIT) rt.s.log.splice(0, rt.s.log.length - LOG_LIMIT);
}

/** Fills `{self}` and `{$name}` in pack text with player names, card names or numbers. */
export function interpolate(rt: Rt, text: string): string {
  return text.replace(/\{(\$?\w+)\}/g, (whole, ref: string) => {
    if (ref === 'self') return nameOf(rt, selfSeat(rt));
    if (!ref.startsWith('$')) return whole;
    const value = getVar(rt, ref);
    const seats = seatsIn(value);
    if (seats.length) return names(rt, seats);
    if (typeof value === 'string' && rt.s.cards[value]) return cardName(rt, value);
    if (typeof value === 'string' && rt.defs.has(value)) return rt.defs.get(value)!.name;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return String(value);
    return whole;
  });
}
