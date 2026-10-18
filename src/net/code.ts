/**
 * Join codes: 8 characters without look-alikes (0, 1, I, O), shown as ABCD-EFGH.
 * The code is both the room id and the signaling password, see docs/DESIGN.md.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 8;

export function generateCode(
  fill: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => void crypto.getRandomValues(bytes),
): string {
  // 256 is a multiple of 32, so taking each byte modulo the alphabet length has no bias.
  const bytes = new Uint8Array(CODE_LENGTH);
  fill(bytes);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

/** Uppercases and strips spaces and dashes. Returns null when the result is not a valid code. */
export function parseCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
