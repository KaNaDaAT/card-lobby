/**
 * The engine's public face. Pure functions: no DOM, no network, no clock. Only the host runs
 * them. Every call returns a new state and leaves the old one untouched.
 */
import type { Pack } from '../packs/types';
import { abortEffect, run } from './interpreter';
import { checkRoundEnd, createGame, knockOut, nextRoundPool, startRound, type NewGame } from './round';
import { EngineError, isIn, makeRt, names, topFrame } from './runtime';
import type { GameState, Input, Json, Prompt } from './types';

export { viewFor } from './view';
export type { NewGame } from './round';

export interface Result {
  state: GameState;
  /** Why the input was refused. The returned state is then the one passed in. */
  error?: string;
}

/** Creates a game and plays until the first question. */
export function startGame(pack: Pack, game: NewGame): GameState {
  const state = createGame(pack, game);
  const rt = makeRt(pack, state);
  startRound(rt);
  run(rt);
  return state;
}

/**
 * Runs only the round setup for `players` players and reports a problem, or null. Validation
 * uses it to check that the deck covers setup plus one draw per player.
 */
export function checkSetup(pack: Pack, players: number): string | null {
  try {
    const seats = Array.from({ length: players }, (_, i) => ({ playerId: `v${i}`, name: `Player ${i + 1}`, color: '#000000' }));
    const state = createGame(pack, { packId: pack.id, players: seats, options: {}, seed: 1 });
    const rt = makeRt(pack, state);
    startRound(rt);
    run(rt, true);
    if (rt.aborts) return 'round setup runs out of cards';
    const left = state.zones.deck?.cards.length ?? 0;
    if (left < players) return `the draw pile is down to ${left} after setup, but every player needs at least one draw`;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function apply(pack: Pack, state: GameState, input: Input): Result {
  // State is plain JSON by design. A JSON round trip copies it faster than structuredClone.
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const rt = makeRt(pack, s);
  const refuse = (error: string): Result => ({ state, error });
  try {
    switch (input.kind) {
      case 'answer': {
        const prompt = s.prompt;
        if (s.phase !== 'round' || !prompt || prompt.id !== input.promptId) return refuse('That question is no longer open.');
        if (prompt.to !== input.seat) return refuse('It is not your turn to answer.');
        const value = checkAnswer(prompt, input.value);
        if (value === undefined) return refuse('That answer is not allowed.');
        topFrame(rt)!.answer = value;
        s.prompt = null;
        run(rt);
        break;
      }
      case 'kickForRound': {
        if (s.phase !== 'round') return refuse('No round is running.');
        if (!isIn(rt, input.seat)) return refuse('That player is not in this round.');
        knockOut(rt, input.seat, 'kicked');
        if (s.turn.seat === input.seat) {
          // Their turn ends where it stands.
          s.program = [];
          s.prompt = null;
        } else if (s.prompt?.to === input.seat) {
          s.prompt = null;
          abortEffect(rt);
        }
        checkRoundEnd(rt);
        run(rt);
        break;
      }
      case 'connection': {
        const player = s.players[input.seat];
        if (!player) return refuse('No such seat.');
        player.connected = input.connected;
        break;
      }
      case 'nextRound': {
        if (s.phase !== 'roundOver') return refuse('The round is not over.');
        const pool = nextRoundPool(s);
        const away = pool.filter((seat) => !s.players[seat]!.connected);
        // A deciding round waits for every contender. Others go ahead without whoever is away.
        if ((s.deciding && away.length) || pool.length - away.length < 2) {
          return refuse(`Waiting for ${names(rt, away)} to come back.`);
        }
        startRound(rt);
        run(rt);
        break;
      }
      case 'timeout':
        return refuse('Time limits are not supported yet.');
    }
  } catch (err) {
    if (err instanceof EngineError) return refuse(`Engine error: ${err.message}`);
    throw err;
  }
  return { state: s };
}

/** The answer in its stored form, or undefined when it does not fit the prompt. */
export function checkAnswer(prompt: Prompt, value: unknown): Json | undefined {
  switch (prompt.kind) {
    case 'play': {
      const list = typeof value === 'string' ? [value] : value;
      if (!Array.isArray(list) || list.length < prompt.min || list.length > prompt.max) return undefined;
      if (new Set(list).size !== list.length) return undefined;
      return list.every((uid) => typeof uid === 'string' && prompt.choices.includes(uid)) ? (list as string[]) : undefined;
    }
    case 'choosePlayer':
    case 'guess':
      return typeof value === 'number' && (prompt.choices as number[]).includes(value) ? value : undefined;
    case 'choosePosition':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < prompt.choices ? value : undefined;
    case 'confirm':
      return typeof value === 'boolean' ? value : undefined;
  }
}
