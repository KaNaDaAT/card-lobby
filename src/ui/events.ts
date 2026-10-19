/**
 * What just happened at the table, worked out by comparing the view a page had with the one it
 * got. Sounds and animations follow these events. Only uses what the views show, so nothing
 * here can tell a page more than its view does.
 */
import type { GameView, Seat } from '../engine/types';

export type TableEvent =
  /** A new turn of yours started. */
  | { kind: 'yourTurn' }
  /** The game asks you something while it is someone else's turn (Favor: pick a card to give). */
  | { kind: 'yourMove' }
  /** Cards landed face up: played, or forced face up. `seat` is whose row grew, null for a shared pile. */
  | { kind: 'played'; seat: Seat | null }
  /** Someone reacted in an open window (Nope). */
  | { kind: 'reaction' }
  | { kind: 'shuffle'; zone: string }
  | { kind: 'out'; seat: Seat }
  | { kind: 'roundOver'; won: boolean }
  | { kind: 'gameOver'; won: boolean };

/**
 * The events between two views of the same seat. Without an earlier view (a reload) there are
 * none, except at the very start of a game, which reads like the start of a round.
 */
export function tableEvents(prev: GameView | null, next: GameView): TableEvent[] {
  const start = !prev && next.phase === 'round' && next.round === 1 && next.turnNumber <= 1;
  if (!prev && !start) return [];
  const out: TableEvent[] = [];
  const you = next.you;
  const newRound = !prev || next.round !== prev.round;

  if (prev && next.phase !== prev.phase && next.phase !== 'round') {
    const won = you !== null && (next.phase === 'gameOver' ? next.winners : (next.result?.winners ?? [])).includes(you);
    out.push({ kind: next.phase === 'gameOver' ? 'gameOver' : 'roundOver', won });
  }

  for (const [id, zone] of Object.entries(next.zones)) {
    if (zone.shuffles > 0 && (newRound || zone.shuffles !== prev?.zones[id]?.shuffles)) out.push({ kind: 'shuffle', zone: id });
  }

  if (prev && !newRound) {
    for (const p of next.players) {
      const was = prev.players[p.seat];
      if (!was) continue;
      if (was.round === 'in' && p.round === 'out') out.push({ kind: 'out', seat: p.seat });
      else if (p.played.length > was.played.length) out.push({ kind: 'played', seat: p.seat });
    }
    for (const [id, zone] of Object.entries(next.zones)) {
      const before = prev.zones[id];
      // Only a pile that shows every card, like a discard pile.
      if (before && zone.count > before.count && zone.known.length === zone.count) out.push({ kind: 'played', seat: null });
    }
    if (next.window && prev.window && next.window.reactions > prev.window.reactions) out.push({ kind: 'reaction' });
  }

  if (next.phase === 'round' && you !== null && next.prompt && next.prompt.id !== prev?.prompt?.id) {
    const turnStart = next.turnSeat === you && (newRound || next.turnNumber !== prev?.turnNumber);
    if (turnStart && next.prompt.kind === 'play') out.push({ kind: 'yourTurn' });
    else if (next.turnSeat !== you) out.push({ kind: 'yourMove' });
  }
  return out;
}
