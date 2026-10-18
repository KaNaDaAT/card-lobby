import { describe, expect, it } from 'vitest';
import { crc32, readZip, writeZip, ZipError, type ZipLimits } from './zip';

const limits: ZipLimits = { maxEntries: 50, maxEntryBytes: () => 10_000, maxTotalBytes: 50_000 };
const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

describe('zip', () => {
  it('round-trips stored and deflated files, skipping folders', async () => {
    for (const store of [true, false]) {
      const zip = await writeZip({ 'pack.json': '{"a":1}', 'art/x.svg': '<svg/>'.repeat(50), 'art/': '' }, { store });
      const files = await readZip(zip, limits);
      expect([...files.keys()]).toEqual(['pack.json', 'art/x.svg']);
      expect(text(files.get('pack.json'))).toBe('{"a":1}');
      expect(text(files.get('art/x.svg'))).toBe('<svg/>'.repeat(50));
    }
  });

  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('rejects files that are not zips, damaged, or too big', async () => {
    await expect(readZip(new TextEncoder().encode('hello'), limits)).rejects.toThrow('this is not a zip file');

    const zip = await writeZip({ 'a.txt': 'some text here' }, { store: true });
    const damaged = zip.slice();
    const dataStart = 30 + 'a.txt'.length;
    damaged[dataStart + 1] = damaged[dataStart + 1]! ^ 0xff;
    await expect(readZip(damaged, limits)).rejects.toThrow('"a.txt" is damaged (checksum)');

    const big = await writeZip({ 'big.png': new Uint8Array(20_000) });
    await expect(readZip(big, limits)).rejects.toThrow('"big.png" is 20000 bytes, at most 10000 are allowed');

    const many = await writeZip(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}.txt`, 'x'])));
    await expect(readZip(many, limits)).rejects.toThrow('the zip has 60 entries, at most 50 are allowed');

    const total = await writeZip(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.bin`, new Uint8Array(9_000)])));
    await expect(readZip(total, limits)).rejects.toThrow('the files add up to more than 50000 bytes');
  });

  it('stops an entry that inflates past its declared size', async () => {
    const zip = await writeZip({ 'bomb.bin': new Uint8Array(9_000) });
    // Claim 100 bytes in both headers. The real data is 9000 zeros.
    const view = new DataView(zip.buffer);
    view.setUint32(22, 100, true);
    const central = zip.length - 22 - (46 + 'bomb.bin'.length);
    view.setUint32(central + 24, 100, true);
    await expect(readZip(zip, limits)).rejects.toThrow('"bomb.bin" inflates to more than its declared 100 bytes');
  });

  it('rejects unsafe paths', async () => {
    for (const bad of ['../evil.json', '/abs.json', 'a\\b.json', 'C:/x.json', 'a//b.json', './x.json']) {
      const zip = await writeZip({ [bad]: '{}' });
      await expect(readZip(zip, limits)).rejects.toThrow(ZipError);
    }
  });
});
