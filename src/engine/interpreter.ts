/**
 * Runs the program stack until the game needs an answer or the round ends. Each frame is
 * `{ ops, pc, ctx }`. Because the stack is plain data, the host can save mid-effect and resume
 * after a reload. See docs/DESIGN.md, "Execution".
 */
import { getOp, type Step } from './ops';
import { checkRoundEnd, nextTurn } from './round';
import { EngineError, newId, selfSeat, topFrame, type Rt } from './runtime';
import type { Frame } from './types';

/** Guards against a pack that loops forever without asking anyone anything. */
const MAX_STEPS = 50_000;

/** Runs until a prompt or the round's end. With `setupOnly`, stops once round setup is done. */
export function run(rt: Rt, setupOnly = false): void {
  for (let steps = 0; rt.s.phase === 'round' && !rt.s.prompt; steps++) {
    if (steps > MAX_STEPS) throw new EngineError('the game ran too long without asking anyone');
    const frame = topFrame(rt);
    if (!frame) {
      if (setupOnly) return;
      nextTurn(rt);
      continue;
    }
    if (frame.pc >= frame.ops.length) {
      rt.s.program.pop();
      continue;
    }
    const op = frame.ops[frame.pc]!;
    const def = getOp(op.op);
    if (!def?.run) throw new EngineError(`unknown op "${String(op.op)}"`);
    apply(rt, frame, def.run(rt, op, frame));
    checkRoundEnd(rt);
  }
}

function apply(rt: Rt, frame: Frame, step: Step): void {
  if (step === 'next') {
    advance(frame);
  } else if (step === 'abort') {
    abortEffect(rt);
  } else if (step === 'halt') {
    // The round ended and cleared the program.
  } else if ('push' in step) {
    advance(frame);
    rt.s.program.push(...step.push);
  } else {
    rt.s.prompt = { ...step.ask, id: newId(rt, 'p'), to: selfSeat(rt), optional: false, source: sourceCard(rt) };
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

/** The card whose effect is running, for prompt titles. */
function sourceCard(rt: Rt): string | undefined {
  for (let i = rt.s.program.length - 1; i >= 0; i--) {
    const uid = rt.s.program[i]!.source;
    if (uid) return rt.s.cards[uid]?.cardId;
  }
  return undefined;
}
