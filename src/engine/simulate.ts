/**
 * Random game runner for the simulation tests. Plays seeded games with random legal inputs,
 * optionally with kicks and dropped connections, and checks invariants after every input:
 * the card count never changes within a round, no card is in two zones, the state stays plain
 * JSON, every game ends, and no view leaks a card its seat does not know.
 */
import { resolveCount } from '../packs/count';
import type { Pack } from '../packs/types';
import { apply, viewFor } from './index';
import { randInt, seedRng } from './rng';
import { newGame } from './testing';
import type { GameState, Input, Prompt, Seat } from './types';
import { knows } from './view';

const MAX_INPUTS = 3000;

/** Base games per run. `SIM_GAMES=5000 npm test` for a deeper run. */
export const SIM_GAMES =
  Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SIM_GAMES) || 600;

function randomAnswer(rng: number[], p: Prompt): unknown {
  switch (p.kind) {
    case 'play':
      return [p.choices[randInt(rng, p.choices.length)]];
    case 'choosePlayer':
    case 'guess':
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

export interface Outcome {
  inputs: number;
  rounds: number;
  final: GameState;
}

export function playRandomGame(pack: Pack, players: number, seed: number, chaos: boolean): Outcome {
  const rng = seedRng(seed * 7919 + 13);
  let s = newGame(pack, players, seed);
  let inputs = 0;
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
    const prompt = s.prompt;
    if (!prompt) throw new Error(`seed ${seed}: round running without a prompt`);
    step({ kind: 'answer', seat: prompt.to, promptId: prompt.id, value: randomAnswer(rng, prompt) });
  }
  checkState(pack, s);
  checkViews(s);
  checkJson(s);
  return { inputs, rounds: s.round, final: s };
}

