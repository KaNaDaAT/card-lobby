/**
 * Small seeded PRNG (sfc32). Its state is four 32-bit numbers kept in the game state, so a
 * saved game continues with exactly the same random sequence.
 */

export function seedRng(seed: number): number[] {
  const state = [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0];
  for (let i = 0; i < 15; i++) nextU32(state);
  return state;
}

/** Advances `state` in place and returns a 32-bit unsigned integer. */
export function nextU32(state: number[]): number {
  let [a = 0, b = 0, c = 0, d = 0] = state;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = ((c << 21) | (c >>> 11)) >>> 0;
  c = (c + t) >>> 0;
  state[0] = a >>> 0;
  state[1] = b;
  state[2] = c;
  state[3] = d;
  return t;
}

/** A uniform integer in [0, n), without modulo bias. */
export function randInt(state: number[], n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`randInt needs a positive integer, got ${n}`);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  for (;;) {
    const x = nextU32(state);
    if (x < limit) return x % n;
  }
}

/** Fisher-Yates shuffle in place. */
export function shuffleInPlace<T>(state: number[], list: T[]): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
}
