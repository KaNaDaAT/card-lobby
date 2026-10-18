import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, formatCode, generateCode, parseCode } from './code';

describe('join codes', () => {
  it('generates codes from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it('round-trips through format and parse', () => {
    const code = generateCode();
    expect(parseCode(formatCode(code))).toBe(code);
  });

  it('accepts lowercase, spaces and dashes', () => {
    expect(parseCode(' abcd-efgh ')).toBe('ABCDEFGH');
  });

  it('rejects look-alike characters and wrong lengths', () => {
    expect(parseCode('ABCD-EFG0')).toBeNull();
    expect(parseCode('ABCD-EFGI')).toBeNull();
    expect(parseCode('ABCDEFG')).toBeNull();
    expect(parseCode('ABCDEFGHJ')).toBeNull();
  });

  it('maps random bytes without bias', () => {
    const counts = new Map<string, number>();
    for (let b = 0; b < 256; b++) {
      const code = generateCode((arr) => arr.fill(b));
      counts.set(code[0]!, (counts.get(code[0]!) ?? 0) + 1);
    }
    expect(new Set(counts.values())).toEqual(new Set([256 / CODE_ALPHABET.length]));
  });
});
