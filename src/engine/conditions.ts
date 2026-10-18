/** Conditions used by `if` and `showdownValue`. See docs/PACK_FORMAT.md, "Conditions". */
import { matchesPlayers } from '../packs/count';
import type { Condition } from '../packs/types';
import { EngineError, getVar, handOf, inRound, isIn, participants, resolvePlayer, resolvePlayers, resolveValue, resolveZones, type Rt } from './runtime';

export function evalCond(rt: Rt, cond: Condition): boolean {
  if ('players' in cond) return matchesPlayers(cond.players, participants(rt).length);
  if ('zoneEmpty' in cond) return resolveZones(rt, cond.zoneEmpty).every((z) => z.cards.length === 0);
  if ('set' in cond) return getVar(rt, cond.set) !== undefined;
  if ('is' in cond) return getVar(rt, cond.is) === true;
  if ('in' in cond) {
    const seats = resolvePlayers(rt, cond.in);
    return seats.length > 0 && seats.every((seat) => isIn(rt, seat));
  }
  if ('handHasValue' in cond) {
    const seat = resolvePlayer(rt, cond.handHasValue[0]);
    const value = resolveValue(rt, cond.handHasValue[1]);
    if (seat === null || typeof value !== 'number') return false;
    return handOf(rt, seat).cards.some((uid) => (rt.defs.get(rt.s.cards[uid]!.cardId)?.value ?? null) === value);
  }
  if ('anyHandHas' in cond) {
    return inRound(rt).some((seat) => handOf(rt, seat).cards.some((uid) => rt.s.cards[uid]?.cardId === cond.anyHandHas));
  }
  if ('not' in cond) return !evalCond(rt, cond.not);
  if ('all' in cond) return cond.all.every((c) => evalCond(rt, c));
  if ('any' in cond) return cond.any.some((c) => evalCond(rt, c));
  throw new EngineError(`unknown condition ${JSON.stringify(cond)}`);
}
