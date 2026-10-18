/**
 * What one seat may see. A card's identity is included only when its zone is public, it lies
 * face up, it sits in the seat's own `owner` zone, or the seat is in its `knownBy`. Spectators
 * see what every player knows. The simulation test checks that no view ever leaks.
 */
import type { CardInstance, GameState, GameView, Seat, VisibleCard, Zone, ZoneView } from './types';

/** How many log entries a view carries. */
const LOG_VIEW = 120;

export function knows(s: GameState, seat: Seat | null, card: CardInstance, zone: Zone): boolean {
  if (zone.visibility === 'public' || card.faceUp) return true;
  if (seat === null) return s.players.length > 0 && s.players.every((p) => card.knownBy.includes(p.seat));
  if (zone.visibility === 'owner' && zone.owner === seat) return true;
  return card.knownBy.includes(seat);
}

/** `now` is the host clock, for the time left in a reaction window. */
export function viewFor(s: GameState, seat: Seat | null, now = 0): GameView {
  const you = seat !== null && s.players[seat] ? seat : null;
  const window = s.stack.at(-1);
  const visible = (uid: string): VisibleCard => ({ uid, cardId: s.cards[uid]!.cardId });
  const zoneView = (zone: Zone | undefined): ZoneView => ({
    count: zone?.cards.length ?? 0,
    known: (zone?.cards ?? []).flatMap((uid, index) =>
      knows(s, you, s.cards[uid]!, zone!) ? [{ index, card: visible(uid) }] : [],
    ),
  });

  const zones: GameView['zones'] = {};
  for (const zone of Object.values(s.zones)) if (zone.owner === undefined) zones[zone.id] = zoneView(zone);

  return {
    you,
    round: s.round,
    phase: s.phase,
    tokensToWin: s.tokensToWin,
    turnSeat: s.turn.seat,
    deciding: s.deciding ? [...s.deciding] : null,
    players: s.players.map((p) => ({
      seat: p.seat,
      playerId: p.playerId,
      name: p.name,
      color: p.color,
      round: p.round,
      tokens: p.tokens,
      statuses: p.statuses.map((st) => st.id),
      connected: p.connected,
      hand: zoneView(s.zones[`hand:${p.seat}`]),
      played: zoneView(s.zones[`played:${p.seat}`]).known.map((k) => k.card),
    })),
    hand: you === null ? [] : (s.zones[`hand:${you}`]?.cards ?? []).map(visible),
    zones,
    prompt: s.prompt && s.prompt.to === you ? structuredClone(s.prompt) : null,
    waiting: s.prompt ? { seat: s.prompt.to, kind: s.prompt.kind } : null,
    window: window
      ? {
          seat: window.seat,
          cards: window.cards.map(visible),
          remainingMs: Math.max(0, window.endsAt - now),
          canceled: window.canceled,
          reactions: window.reactions,
        }
      : null,
    // Only about your own hand: others must not learn who could react.
    reactWith:
      window && you !== null && s.players[you]!.round === 'in'
        ? (s.zones[`hand:${you}`]?.cards ?? []).filter((uid) => s.reactCards.includes(s.cards[uid]!.cardId))
        : [],
    log: s.log
      .filter((e) => e.to === 'all' || (you !== null && e.to.includes(you)))
      .slice(-LOG_VIEW)
      .map((e) => ({ text: e.text, private: e.to !== 'all' })),
    result: s.result ? structuredClone(s.result) : null,
    winners: [...s.winners],
  };
}
