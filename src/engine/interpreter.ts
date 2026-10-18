/**
 * Runs the program stack until the game needs an answer, a reaction window is open, or the
 * round ends. Each frame is `{ ops, pc, ctx }`. Because the stack is plain data, the host can
 * save mid-effect and resume after a reload. See docs/DESIGN.md, "Execution".
 */
import { getOp, type Step } from './ops';
import { checkRoundEnd, nextTurn } from './round';
import { EngineError, newId, selfSeat, topFrame, type Rt } from './runtime';
import type { Frame } from './types';

/** Guards against a pack that loops forever without asking anyone anything. */
const MAX_STEPS = 50_000;

/** True while the game waits: for an answer, for a reaction window, or for the next round. */
export function blocked(rt: Rt): boolean {
  return rt.s.phase !== 'round' || rt.s.prompt !== null || rt.s.stack.length > 0;
}

/** Runs until something blocks. With `setupOnly`, stops once round setup is done. */
export function run(rt: Rt, setupOnly = false): void {
  for (let steps = 0; !blocked(rt); steps++) {
    if (steps > MAX_STEPS) throw new EngineError('the game ran too long without asking anyone');
    const frame = topFrame(rt);
    if (!frame) {
      if (setupOnly) return;
      nextTurn(rt);
      continue;
    }
    step(rt, frame);
  }
}

/** Runs one frame to its end at once, for reactions. Its ops may not ask anyone. */
export function runNow(rt: Rt, frame: Frame): void {
  const depth = rt.s.program.length;
  rt.s.program.push(frame);
  for (let steps = 0; rt.s.program.length > depth; steps++) {
    if (steps > MAX_STEPS) throw new EngineError('a reaction ran too long');
    if (rt.s.prompt) throw new EngineError('a reaction cannot ask anyone');
    step(rt, topFrame(rt)!);
  }
}

function step(rt: Rt, frame: Frame): void {
  if (frame.pc >= frame.ops.length) {
    rt.s.program.pop();
    return;
  }
  const op = frame.ops[frame.pc]!;
  const def = getOp(op.op);
  if (!def?.run) throw new EngineError(`unknown op "${String(op.op)}"`);
  apply(rt, frame, def.run(rt, op, frame));
  checkRoundEnd(rt);
}

function apply(rt: Rt, frame: Frame, step: Step): void {
  if (step === 'next') {
    advance(frame);
  } else if (step === 'abort') {
    abortEffect(rt);
  } else if (step === 'halt' || step === 'wait') {
    // The round ended, or a reaction window holds the game until it closes.
  } else if (step === 'again') {
    delete frame.answer;
  } else if (step === 'endTurn') {
    endTurnNow(rt);
  } else if ('push' in step) {
    if (step.stay) delete frame.answer;
    else advance(frame);
    rt.s.program.push(...step.push);
  } else {
    const { to, ...ask } = step.ask;
    const combo = sourceCombo(rt);
    rt.s.prompt = {
      ...ask,
      id: newId(rt, 'p'),
      to: to ?? selfSeat(rt),
      optional: false,
      source: sourceCard(rt),
      ...(combo ? { combo } : {}),
    };
  }
}

function advance(frame: Frame): void {
  frame.pc++;
  delete frame.answer;
}

/** Skips the rest of the current effect: pops blocks, then the effect, turn or setup frame. */
export function abortEffect(rt: Rt): void {
  rt.aborts++;
  let frame: Frame | undefined;
  do frame = rt.s.program.pop();
  while (frame?.kind === 'block');
}

/** Ends the current turn: pops every frame up to and including the turn frame. */
function endTurnNow(rt: Rt): void {
  let frame: Frame | undefined;
  do frame = rt.s.program.pop();
  while (frame && frame.kind !== 'turn');
}

/** The card whose effect is running, for prompt titles. */
function sourceCard(rt: Rt): string | undefined {
  for (let i = rt.s.program.length - 1; i >= 0; i--) {
    const uid = rt.s.program[i]!.source;
    if (uid) return rt.s.cards[uid]?.cardId;
  }
  return undefined;
}

function sourceCombo(rt: Rt): string | undefined {
  for (let i = rt.s.program.length - 1; i >= 0; i--) {
    const frame = rt.s.program[i]!;
    if (frame.combo) return frame.combo;
    if (frame.source) return undefined;
  }
  return undefined;
}
