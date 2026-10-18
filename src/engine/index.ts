/**
 * The engine's public face. Pure functions: no DOM, no network, no clock (the host passes its
 * clock in with inputs that need it). Only the host runs them. Every call returns a new state
 * and leaves the old one untouched.
 */
import type { Pack } from '../packs/types';
import { abortEffect, run, runNow } from './interpreter';
import { closeWindow, findCombo, reactionWindowMs } from './ops/flow';
import { checkRoundEnd, createGame, knockOut, nextRoundPool, startRound, type NewGame } from './round';
import { cardName, defOf, EngineError, handOf, isIn, log, makeRt, moveCard, nameOf, names, seatVal, topFrame, zoneById } from './runtime';
import type { GameState, Input, Json, Prompt } from './types';

export { viewFor } from './view';
export type { NewGame } from './round';

export interface Result {
  state: GameState;
  /** Why the input was refused. The returned state is then the one passed in. */
  error?: string;
}

/** Creates a game and plays until the first question. */
export function startGame(pack: Pack, game: NewGame, now = 0): GameState {
  const state = createGame(pack, game);
  const rt = makeRt(pack, state, now);
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
  const now = 'now' in input && typeof input.now === 'number' ? input.now : 0;
  const rt = makeRt(pack, s, now);
  const refuse = (error: string): Result => ({ state, error });
  try {
    switch (input.kind) {
      case 'answer': {
        const prompt = s.prompt;
        if (s.phase !== 'round' || !prompt || prompt.id !== input.promptId) return refuse('That question is no longer open.');
        if (prompt.to !== input.seat) return refuse('It is not your turn to answer.');
        const value = checkAnswer(prompt, input.value, s);
        if (value === undefined) return refuse('That answer is not allowed.');
        topFrame(rt)!.answer = value;
        s.prompt = null;
        run(rt);
        break;
      }
      case 'react': {
        const window = s.stack.at(-1);
        if (s.phase !== 'round' || !window) return refuse('There is nothing to react to.');
        if (now >= window.endsAt) return refuse('Too late.');
        if (!isIn(rt, input.seat)) return refuse('You are not in this round.');
        const hand = handOf(rt, input.seat);
        if (!hand.cards.includes(input.uid)) return refuse('That card is not in your hand.');
        const def = defOf(rt, input.uid);
        if (!def.onReact?.length) return refuse(`${def.name} cannot be played now.`);
        moveCard(rt, input.uid, hand, zoneById(rt, window.zone), 'bottom', true);
        log(rt, `${nameOf(rt, input.seat)} plays ${cardName(rt, input.uid)}!`);
        runNow(rt, { kind: 'effect', ops: def.onReact, pc: 0, ctx: { self: seatVal(input.seat), card: input.uid }, source: input.uid });
        // Every reaction restarts the window, so others can react to it in turn.
        window.endsAt = now + reactionWindowMs(rt);
        window.reactions++;
        break;
      }
      case 'timeout': {
        const window = s.stack.at(-1);
        if (!window) return refuse('No reaction window is open.');
        if (now < window.endsAt) return refuse('The reaction window is still open.');
        closeWindow(rt);
        run(rt);
        break;
      }
      case 'kickForRound': {
        if (s.phase !== 'round') return refuse('No round is running.');
        if (!isIn(rt, input.seat)) return refuse('That player is not in this round.');
        knockOut(rt, input.seat, 'kicked');
        if (s.turn.seat === input.seat) {
          // Their turn ends where it stands, along with a play waiting for reactions.
          s.program = [];
          s.prompt = null;
          s.stack = [];
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
    }
  } catch (err) {
    if (err instanceof EngineError) return refuse(`Engine error: ${err.message}`);
    throw err;
  }
  return { state: s };
}

/** The answer in its stored form, or undefined when it does not fit the prompt. */
export function checkAnswer(prompt: Prompt, value: unknown, state: GameState): Json | undefined {
  switch (prompt.kind) {
    case 'play': {
      const list = typeof value === 'string' ? [value] : value;
      if (!Array.isArray(list) || new Set(list).size !== list.length) return undefined;
      if (!list.every((uid) => typeof uid === 'string' && prompt.choices.includes(uid))) return undefined;
      const uids = list as string[];
      if (uids.length === 0) return prompt.min === 0 ? [] : undefined;
      if (uids.length < prompt.min || uids.length > prompt.max) return undefined;
      if (uids.length === 1) return prompt.alone.includes(uids[0]!) ? uids : undefined;
      // Several cards must make a combo.
      return findCombo(prompt.combos, uids.map((uid) => state.cards[uid]!.cardId)) ? uids : undefined;
    }
    case 'choosePlayer':
    case 'guess':
      return typeof value === 'number' && (prompt.choices as number[]).includes(value) ? value : undefined;
    case 'choosePosition':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < prompt.choices ? value : undefined;
    case 'confirm':
      return typeof value === 'boolean' ? value : undefined;
    case 'chooseCard':
    case 'nameCard':
      return typeof value === 'string' && prompt.choices.includes(value) ? value : undefined;
  }
}
