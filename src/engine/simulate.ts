/**
 * Random game runner for the simulation tests. Plays seeded games with random legal inputs,
 * optionally with kicks and dropped connections, and checks invariants after every input:
 * the card count never changes within a round, no card is in two zones, the state stays plain
 * JSON, every game ends, no view leaks a card its seat does not know, and nobody can tell
 * where a card was put back in secret.
 */
import { resolveCount } from '../packs/count';
import type { Pack } from '../packs/types';
import { apply, viewFor } from './index';
import { randInt, seedRng } from './rng';
import { newGame } from './testing';
import type { GameState, Input, Prompt, Seat } from './types';
import { knows } from './view';

const MAX_INPUTS = 8000;

/** Base games per run. `SIM_GAMES=5000 npm test` for a deeper run. */
export const SIM_GAMES =
  Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SIM_GAMES) || 600;

/** Every play the prompt allows: passing, single cards, and one of each combo the hand makes. */
function playOptions(p: Extract<Prompt, { kind: 'play' }>, s: GameState): string[][] {
  const options: string[][] = p.min === 0 ? [[]] : [];
  for (const uid of p.alone) options.push([uid]);
  const byId = new Map<string, string[]>();
  for (const uid of p.choices) byId.set(s.cards[uid]!.cardId, [...(byId.get(s.cards[uid]!.cardId) ?? []), uid]);
  for (const combo of p.combos) {
    if (combo.size > p.max) continue;
    if (combo.match === 'same') {
      for (const uids of byId.values()) if (uids.length >= combo.size) options.push(uids.slice(0, combo.size));
    } else {
      const distinct = [...byId.values()].map((uids) => uids[0]!);
      if (distinct.length >= combo.size) options.push(distinct.slice(0, combo.size));
    }
  }
  return options;
}

function randomAnswer(rng: number[], p: Prompt, s: GameState): unknown {
  switch (p.kind) {
    case 'play': {
      const options = playOptions(p, s);
      return options[randInt(rng, options.length)];
    }
    case 'choosePlayer':
    case 'guess':
    case 'chooseCard':
    case 'nameCard':
      return p.choices[randInt(rng, p.choices.length)];
    case 'choosePosition':
      return randInt(rng, p.choices);
    case 'confirm':
      return randInt(rng, 2) === 1;
  }
}

function checkState(pack: Pack, s: GameState): void {
  const where = new Map<string, string>();
  for (const zone of Object.values(s.zones)) {
    for (const uid of zone.cards) {
      if (where.has(uid)) throw new Error(`${uid} is in ${where.get(uid)} and ${zone.id}`);
      where.set(uid, zone.id);
    }
  }
  for (const [uid, card] of Object.entries(s.cards)) {
    if (card.uid !== uid) throw new Error(`card key ${uid} holds uid ${card.uid}`);
    if (!where.has(uid)) throw new Error(`${uid} is in no zone`);
  }
  if (where.size !== Object.keys(s.cards).length) throw new Error('a zone holds an unknown uid');
  if (s.round > 0) {
    const n = s.players.filter((p) => p.round !== 'sittingOut').length;
    const deck = pack.cards.reduce((sum, c) => sum + resolveCount(c.count, n), 0);
    if (where.size !== deck) throw new Error(`round has ${where.size} cards, expected ${deck}`);
  }
}

function checkJson(s: GameState): void {
  const json = JSON.stringify(s);
  if (JSON.stringify(JSON.parse(json)) !== json || JSON.stringify(structuredClone(s)) !== json) {
    throw new Error('state is not plain JSON');
  }
}

/** No view may show a card its seat does not know, and no unknown uid may appear anywhere in it. */
function checkViews(s: GameState): void {
  const zoneOf = new Map<string, string>();
  for (const zone of Object.values(s.zones)) for (const uid of zone.cards) zoneOf.set(uid, zone.id);
  const seats: (Seat | null)[] = [null, ...s.players.map((p) => p.seat)];
  for (const seat of seats) {
    const view = viewFor(s, seat);
    for (const [, uid] of JSON.stringify(view).matchAll(/"(c\d+)"/g)) {
      const card = s.cards[uid!];
      if (!card) throw new Error(`seat ${seat} sees a uid that does not exist: ${uid}`);
      const zone = s.zones[zoneOf.get(uid!)!]!;
      if (!knows(s, seat, card, zone)) throw new Error(`seat ${seat} sees unknown card ${uid} in ${zone.id}`);
    }
    // Hidden cards must only ever be known by a seat that legitimately learned them.
    for (const p of view.players) {
      if (p.seat !== seat && s.zones[`hand:${p.seat}`]) {
        for (const k of p.hand.known) {
          const card = s.cards[k.card.uid]!;
          if (seat === null ? !s.players.every((q) => card.knownBy.includes(q.seat)) : !card.knownBy.includes(seat)) {
            throw new Error(`seat ${seat} sees ${p.seat}'s hand without knowing it`);
          }
        }
      }
    }
    if (view.prompt && view.prompt.to !== seat) throw new Error(`seat ${seat} got someone else's prompt`);
  }
}

/**
 * Where a card goes back in secret must not show in anyone else's view. Tries the top, the
 * bottom and the middle as answers and compares what every other seat sees of the shared zones
 * and of the other players' hands. Their own hand may differ: they may draw the card.
 */
function checkSecretPosition(pack: Pack, s: GameState, prompt: Extract<Prompt, { kind: 'choosePosition' }>, now: number): void {
  const answers = [...new Set([0, prompt.choices - 1, Math.floor(prompt.choices / 2)])];
  if (answers.length < 2) return;
  const others: (Seat | null)[] = [null, ...s.players.map((p) => p.seat).filter((seat) => seat !== prompt.to)];
  const after = answers.map((value) => apply(pack, s, { kind: 'answer', seat: prompt.to, promptId: prompt.id, value, now }).state);
  // The game may show it to everyone, like a next player with no cards drawing the kitten at once.
  const told = after.map((state) => JSON.stringify(viewFor(state, null).log));
  if (told.some((v) => v !== told[0])) return;
  for (const seat of others) {
    const seen = after.map((state) => {
      const view = viewFor(state, seat);
      return JSON.stringify({ zones: view.zones, hands: view.players.filter((p) => p.seat !== seat).map((p) => p.hand) });
    });
    if (seen.some((v) => v !== seen[0])) throw new Error(`seat ${seat} can tell where ${s.players[prompt.to]!.name} put a card`);
  }
}

export interface Outcome {
  inputs: number;
  rounds: number;
  final: GameState;
}

export function playRandomGame(pack: Pack, players: number, seed: number, chaos: boolean): Outcome {
  const rng = seedRng(seed * 7919 + 13);
  let s = newGame(pack, players, seed);
  let inputs = 0;
  // The host clock, for reaction windows. It only moves forward.
  let now = 0;
  const step = (input: Input, mayFail = false) => {
    const result = apply(pack, s, input);
    if (result.error && !mayFail) throw new Error(`seed ${seed}: ${result.error} for ${JSON.stringify(input)}`);
    if (result.error?.startsWith('Engine error')) throw new Error(`seed ${seed}: ${result.error}`);
    s = result.state;
    inputs++;
  };
  while (s.phase !== 'gameOver') {
    if (inputs > MAX_INPUTS) throw new Error(`seed ${seed}: game did not end`);
    checkState(pack, s);
    checkViews(s);
    if (inputs % 7 === 0) checkJson(s);
    if (s.phase === 'roundOver') {
      for (const p of s.players) if (!p.connected && randInt(rng, 2) === 0) step({ kind: 'connection', seat: p.seat, connected: true });
      const before = s;
      step({ kind: 'nextRound' }, true);
      if (s === before) {
        for (const p of s.players) if (!p.connected) step({ kind: 'connection', seat: p.seat, connected: true });
        step({ kind: 'nextRound' });
      }
      continue;
    }
    if (chaos && randInt(rng, 40) === 0) {
      const inSeats = s.players.filter((p) => p.round === 'in').map((p) => p.seat);
      step({ kind: 'kickForRound', seat: inSeats[randInt(rng, inSeats.length)]! });
      continue;
    }
    if (chaos && randInt(rng, 25) === 0) {
      const p = s.players[randInt(rng, s.players.length)]!;
      step({ kind: 'connection', seat: p.seat, connected: !p.connected });
      continue;
    }
    const window = s.stack.at(-1);
    if (window) {
      // Players holding a reaction card may use it while the window is open. Otherwise it runs out.
      const reactors = s.players
        .filter((p) => p.round === 'in')
        .flatMap((p) => viewFor(s, p.seat).reactWith.map((uid) => ({ seat: p.seat, uid })));
      const room = window.endsAt - now;
      if (reactors.length && room > 0 && randInt(rng, 3) === 0) {
        const r = reactors[randInt(rng, reactors.length)]!;
        now += randInt(rng, room);
        step({ kind: 'react', seat: r.seat, uid: r.uid, now });
      } else {
        now = Math.max(now, window.endsAt);
        step({ kind: 'timeout', now });
      }
      continue;
    }
    const prompt = s.prompt;
    if (!prompt) throw new Error(`seed ${seed}: round running without a prompt`);
    now += 500;
    if (prompt.kind === 'choosePosition') checkSecretPosition(pack, s, prompt, now);
    step({ kind: 'answer', seat: prompt.to, promptId: prompt.id, value: randomAnswer(rng, prompt, s), now });
  }
  checkState(pack, s);
  checkViews(s);
  checkJson(s);
  return { inputs, rounds: s.round, final: s };
}

