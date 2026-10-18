import { describe, expect, it } from 'vitest';
import { customKey, importPackZip, MAX_PACK_BYTES, PackImportError, sha256Hex } from './custom';
import { writeZip } from './zip';

/** The Power Hungry Pets folder, as text, keyed by path inside the pack. */
const PETS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../public/packs/power-hungry-pets/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  ).map(([path, text]) => [path.replace('../../public/packs/power-hungry-pets/', ''), text]),
);

const url = (blob: Blob) => `blob:test/${blob.type}/${blob.size}`;

async function problems(files: Record<string, string | Uint8Array>): Promise<string[]> {
  try {
    await importPackZip(await writeZip(files), { url });
    return [];
  } catch (err) {
    if (err instanceof PackImportError) return err.problems;
    throw err;
  }
}

describe('importPackZip', () => {
  it('loads Power Hungry Pets from a zip, with blob URLs for its images', async () => {
    const zip = await writeZip(PETS);
    const lp = await importPackZip(zip, { url });
    const hash = await sha256Hex(zip);
    expect(lp.key).toBe(customKey(hash));
    expect(lp.pack.id).toBe('power-hungry-pets');
    expect(lp.addons.map((a) => a.id)).toEqual(['big-litter']);
    expect(lp.custom?.offer).toEqual({
      hash,
      kind: 'game',
      name: 'Power Hungry Pets',
      author: 'Card Lobby (rules adaptation, original game by Exploding Kittens)',
      bytes: zip.length,
      images: Object.keys(PETS).filter((p) => p.endsWith('.svg')).length,
    });
    expect(lp.asset('art/king-cat.svg')).toMatch(/^blob:test\/image\/svg\+xml\/\d+$/);
    expect(lp.asset('art/nope.svg')).toBe('');
    expect(lp.asset('pack.json')).toBe('');
  });

  it('accepts a zip whose files sit in one top folder, and skips files zip tools add', async () => {
    const nested = Object.fromEntries(Object.entries(PETS).map(([p, t]) => [`my-pack/${p}`, t]));
    expect(await problems({ ...nested, '__MACOSX/my-pack/._pack.json': 'x', 'my-pack/.DS_Store': 'x' })).toEqual([]);
  });

  it('rejects other file types, bad JSON and missing addons', async () => {
    expect(await problems({ ...PETS, 'run.exe': 'MZ' })).toEqual([
      'run.exe: only .json files and png, jpg, webp or svg images may be in a pack',
    ]);
    expect((await problems({ ...PETS, 'pack.json': '{ nope' }))[0]).toMatch(/^pack\.json: not valid JSON/);
    const { 'addons/big-litter.json': _gone, ...noAddon } = PETS;
    expect(await problems(noAddon)).toEqual(['addons/big-litter.json: missing from the zip']);
    expect(await problems({ 'readme.json': '{}' })).toEqual(['The zip has no pack.json (for a game) or addon.json (for an addon).']);
  });

  it('runs full validation, including missing images and addon problems', async () => {
    const { 'art/king-cat.svg': _gone, ...noArt } = PETS;
    expect(await problems(noArt)).toEqual(['pack.json: cards.king-cat.image: file "art/king-cat.svg" is missing']);

    const addon = JSON.parse(PETS['addons/big-litter.json']!);
    addon.cards.modify['crystal-bwol'] = { count: 3 };
    expect(await problems({ ...PETS, 'addons/big-litter.json': JSON.stringify(addon) })).toEqual([
      'addons/big-litter.json: cards.modify.crystal-bwol: no card with this id',
    ]);
  });

  it('enforces size limits and the expected hash', async () => {
    expect(await problems({ ...PETS, 'art/huge.png': new Uint8Array(2 * 1024 * 1024 + 1) })).toEqual([
      'Zip problem: "art/huge.png" is 2097153 bytes, at most 2097152 are allowed.',
    ]);
    await expect(importPackZip(new Uint8Array(MAX_PACK_BYTES + 1))).rejects.toThrow('The pack is bigger than the 25.0 MB limit.');
    const zip = await writeZip(PETS);
    await expect(importPackZip(zip, { url, expectHash: 'f'.repeat(64) })).rejects.toThrow('The pack arrived damaged');
  });
});
