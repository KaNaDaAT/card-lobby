/**
 * Game and round lifecycle: creating a game, starting rounds, moving between turns, knocking
 * players out, the showdown, tokens, and the end of the game.
 */
import { resolveCount } from '../packs/count';
import type { OptionValue, Pack } from '../packs/types';
import { evalCond } from './conditions';
import { randInt, seedRng } from './rng';
import {
  allSeats,
  cardName,
  cardOf,
  defOf,
  handOf,
  inRound,
  isIn,
  know,
  log,
  moveCard,
  nameOf,
  names,
  nextIn,
  playedOf,
  seatVal,
  type Rt,
} from './runtime';
import type { GameState, RoundResult, Seat, ShowdownValue, TieBreak } from './types';

export interface NewGame {
  packId: string;
  /** In seat order. */
  players: { playerId: string; name: string; color: string }[];
  /** Host choices. Missing or invalid values fall back to the pack's defaults. */
  options: Record<string, OptionValue>;
  seed: number;
}

/** A fresh game before its first round. */
export function createGame(pack: Pack, game: NewGame): GameState {
  const n = game.players.length;
  const options = resolveOptions(pack, game.options, n);
  const toWin = pack.rules.scoring.toWin;
  const tokensToWin =
    typeof toWin === 'object' && 'option' in toWin ? Number(options[toWin.option]) : resolveCount(toWin, n);
  return {
    packId: game.packId,
    options,
    tokensToWin,
    round: 0,
    phase: 'roundOver',
    players: game.players.map((p, seat) => ({
      seat,
      playerId: p.playerId,
      name: p.name,
      color: p.color,
      round: 'in',
      tokens: 0,
      statuses: [],
      connected: true,
    })),
    turn: { seat: 0, direction: 1, owed: 0, count: 0 },
    starter: 0,
    cards: {},
    zones: {},
    program: [],
    prompt: null,
    stack: [],
    lastWinners: [],
    deciding: null,
    result: null,
    winners: [],
    nextId: 0,
    rng: seedRng(game.seed),
    log: [],
  };
}

/** Every option gets a concrete value. Number options with a Count default resolve for `players`. */
export function resolveOptions(pack: Pack, values: Record<string, OptionValue>, players: number): Record<string, OptionValue> {
  const out: Record<string, OptionValue> = {};
  for (const def of pack.options ?? []) {
    const v = values[def.id];
    switch (def.type) {
      case 'select':
        out[def.id] = typeof v === 'string' && def.choices.some((c) => c.value === v) ? v : def.default;
        break;
      case 'number': {
        const ok = typeof v === 'number' && Number.isInteger(v) && v >= (def.min ?? 1) && v <= (def.max ?? 10);
        out[def.id] = ok ? v : resolveCount(def.default, players);
        break;
      }
      case 'toggle':
        out[def.id] = typeof v === 'boolean' ? v : def.default;
        break;
    }
  }
  return out;
}

/** Seats that would play the next round: contenders of a deciding round, or everyone. */
export function nextRoundPool(s: GameState): Seat[] {
  return s.deciding ?? s.players.map((p) => p.seat);
}

export function startRound(rt: Rt): void {
  const s = rt.s;
  const pool = nextRoundPool(s);
  const seats = pool.filter((seat) => s.players[seat]!.connected);
  s.round++;
  s.phase = 'round';
  s.result = null;
  s.prompt = null;
  s.stack = [];
  s.cards = {};
  s.zones = {};
  for (const [id, z] of Object.entries(rt.pack.rules.zones)) s.zones[id] = { id, visibility: z.visibility, cards: [] };
  for (const p of s.players) {
    for (const [kind, z] of Object.entries(rt.pack.rules.playerZones)) {
      const id = `${kind}:${p.seat}`;
      s.zones[id] = { id, owner: p.seat, visibility: z.visibility, cards: [] };
    }
    p.round = seats.includes(p.seat) ? 'in' : 'sittingOut';
    p.statuses = [];
  }
  s.starter = pickStarter(rt, seats);
  s.turn = { seat: s.starter, direction: 1, owed: 0, count: 0 };

  log(rt, s.deciding ? `Deciding round: ${names(rt, seats)}.` : `Round ${s.round}.`);
  const sitting = s.players.filter((p) => p.round === 'sittingOut' && pool.includes(p.seat)).map((p) => p.seat);
  if (sitting.length) log(rt, `${names(rt, sitting)} ${sitting.length === 1 ? 'sits' : 'sit'} out this round.`);
  log(rt, `${nameOf(rt, s.starter)} starts.`);

  s.program = [{ kind: 'setup', ops: rt.pack.rules.roundSetup, pc: 0, ctx: { self: seatVal(s.starter) } }];
}

function pickStarter(rt: Rt, seats: Seat[]): Seat {
  const s = rt.s;
  const rules = rt.pack.rules.rounds ?? {};
  const mode = s.round === 1 ? (rules.first ?? 'random') : (rules.next ?? 'lastWinner');
  const random = (list: Seat[]) => list[randInt(s.rng, list.length)]!;
  const afterPrevious = () => seats.find((seat) => seat > s.starter) ?? seats[0]!;
  switch (mode) {
    case 'random':
      return random(seats);
    case 'nextSeat':
      return s.round === 1 ? seats[0]! : afterPrevious();
    case 'lastWinner': {
      const winners = s.lastWinners.filter((seat) => seats.includes(seat));
      return winners.length ? random(winners) : afterPrevious();
    }
  }
}

/** Called when the program runs empty: starts the first turn after setup, or the next one. */
export function nextTurn(rt: Rt): void {
  const s = rt.s;
  let seat: Seat | null;
  if (s.turn.count === 0) {
    seat = isIn(rt, s.starter) ? s.starter : nextIn(rt, s.starter);
  } else {
    for (const p of s.players) p.statuses = p.statuses.filter((st) => st.until !== 'endOfTurn');
    seat = nextIn(rt, s.turn.seat) ?? (isIn(rt, s.turn.seat) ? s.turn.seat : null);
  }
  if (seat === null) {
    endRound(rt, 'nobodyLeft', []);
    return;
  }
  s.turn.seat = seat;
  s.turn.count++;
  const player = s.players[seat]!;
  player.statuses = player.statuses.filter((st) => st.until !== 'ownNextTurn');
  s.program.push({ kind: 'turn', ops: rt.pack.rules.turn, pc: 0, ctx: { self: seatVal(seat) } });
}

/** Ends the round as soon as one player is left, if the pack says so. Runs after every op. */
export function checkRoundEnd(rt: Rt): void {
  if (rt.s.phase !== 'round' || !rt.pack.rules.roundEnd?.lastStanding) return;
  const left = inRound(rt);
  if (left.length <= 1) endRound(rt, left.length ? 'lastStanding' : 'nobodyLeft', left);
}

/** Out for the round: the hand goes face up in front of the player, without hooks. */
export function knockOut(rt: Rt, seat: Seat, how: 'out' | 'kicked' = 'out'): void {
  const player = rt.s.players[seat]!;
  if (player.round !== 'in') return;
  player.round = 'out';
  log(rt, how === 'kicked' ? `The host took ${player.name} out of this round.` : `${player.name} is out.`);
  const hand = handOf(rt, seat);
  const cards = [...hand.cards];
  for (const uid of cards) moveCard(rt, uid, hand, playedOf(rt, seat), 'bottom', true);
  if (cards.length) log(rt, `${player.name}'s card was ${cards.map((uid) => cardName(rt, uid)).join(' and ')}.`);
}

export function showdown(rt: Rt): void {
  const seats = inRound(rt);
  const entries = seats.map((seat) => {
    const uid = handOf(rt, seat).cards[0];
    return uid
      ? { seat, cardId: cardOf(rt, uid).cardId, value: showdownValueOf(rt, uid, seat) }
      : { seat, cardId: '', value: 'lowest' as const };
  });
  log(rt, 'The draw pile is empty. Showdown!');
  for (const e of entries) {
    if (e.cardId) log(rt, `${nameOf(rt, e.seat)} shows ${rt.defs.get(e.cardId)?.name ?? e.cardId}.`);
  }

  const best = Math.max(...entries.map((e) => rank(e.value)));
  let winners = entries.filter((e) => rank(e.value) === best).map((e) => e.seat);
  let tieBreak: RoundResult['tieBreak'];
  if (winners.length > 1) {
    const rule = tieBreakRule(rt);
    if (rule !== 'none') {
      const scores = winners.map((seat) => ({ seat, score: playedScore(rt, seat, rule) }));
      const top = Math.max(...scores.map((x) => x.score));
      winners = scores.filter((x) => x.score === top).map((x) => x.seat);
      tieBreak = { rule, scores };
      log(rt, rule === 'highestPlayed' ? 'Tie! The highest card played decides.' : 'Tie! The total of played cards decides.');
    }
  }
  endRound(rt, 'showdown', winners, { showdown: entries, ...(tieBreak ? { tieBreak } : {}) });
}

const rank = (v: ShowdownValue) => (v === 'highest' ? Infinity : v === 'lowest' ? -Infinity : v);

function showdownValueOf(rt: Rt, uid: string, seat: Seat): ShowdownValue {
  const def = defOf(rt, uid);
  // Conditions read `self` from the program, so give them a scope of their own.
  rt.s.program.push({ kind: 'block', ops: [], pc: 0, ctx: { self: seatVal(seat) } });
  try {
    for (const rule of def.showdownValue ?? []) if (evalCond(rt, rule.if)) return rule.value;
  } finally {
    rt.s.program.pop();
  }
  return def.value ?? 0;
}

function tieBreakRule(rt: Rt): TieBreak {
  const raw = rt.pack.rules.showdown?.tieBreak;
  const value = raw && typeof raw === 'object' ? rt.s.options[raw.option] : raw;
  return value === 'highestPlayed' || value === 'sumPlayed' ? value : 'none';
}

function playedScore(rt: Rt, seat: Seat, rule: 'highestPlayed' | 'sumPlayed'): number {
  const values = playedOf(rt, seat).cards.map((uid) => defOf(rt, uid).value ?? 0);
  if (rule === 'sumPlayed') return values.reduce((a, b) => a + b, 0);
  return values.length ? Math.max(...values) : -1;
}

export function endRound(
  rt: Rt,
  by: RoundResult['by'],
  winners: Seat[],
  extra: Pick<RoundResult, 'showdown' | 'tieBreak'> = {},
): void {
  const s = rt.s;
  s.phase = 'roundOver';
  s.program = [];
  s.prompt = null;
  for (const p of s.players) p.statuses = p.statuses.filter((st) => st.until === 'permanent');

  // Everyone sees the final hands and the set-aside cards. The draw pile stays hidden.
  const everyone = allSeats(rt);
  for (const zone of Object.values(s.zones)) {
    if (zone.visibility === 'public' || zone.id === 'deck') continue;
    for (const uid of zone.cards) know(rt, uid, everyone);
  }

  for (const seat of winners) s.players[seat]!.tokens += rt.pack.rules.scoring.roundWin;
  s.lastWinners = winners;
  s.result = { winners, by, ...extra };
  if (!winners.length) log(rt, 'Nobody wins this round.');
  else log(rt, `${names(rt, winners)} ${winners.length === 1 ? 'wins' : 'share'} the round.`);
  checkGameOver(rt);
}

function checkGameOver(rt: Rt): void {
  const s = rt.s;
  const reached = s.players.filter((p) => p.tokens >= s.tokensToWin);
  if (!reached.length) return;
  const best = Math.max(...reached.map((p) => p.tokens));
  const top = reached.filter((p) => p.tokens === best).map((p) => p.seat);
  if (top.length === 1 || rt.pack.rules.scoring.tiedAtTarget !== 'decidingRound') {
    s.phase = 'gameOver';
    s.winners = top;
    s.deciding = null;
    log(rt, `${names(rt, top)} ${top.length === 1 ? 'wins' : 'win'} the game!`);
  } else {
    s.deciding = top;
    log(rt, `${names(rt, top)} are tied with ${best} tokens and play a deciding round.`);
  }
}
