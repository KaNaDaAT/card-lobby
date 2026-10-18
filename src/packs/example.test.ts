/**
 * The example addons in examples/addons, each its own zip for Power Hungry Pets: they load
 * through the same import a host uses, fit the built-in game alone, together and with Big
 * Litter, and their images resolve through the addon they came with.
 */
import { describe, expect, it } from 'vitest';
import petsJson from '../../public/packs/power-hungry-pets/pack.json';
import bigLitterJson from '../../public/packs/power-hungry-pets/addons/big-litter.json';
import { importZip, uploadProblems, withUploads } from './custom';
import type { Addon, LoadedAddon, LoadedPack, Pack } from './types';
import { validateSelection } from './validate';
import { writeZip } from './zip';

const folder = (glob: Record<string, string>, prefix: string) =>
  Object.fromEntries(Object.entries(glob).map(([path, text]) => [path.replace(prefix, ''), text]));

const OFF_THE_SCALE = folder(
  import.meta.glob('../../examples/addons/off-the-scale/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  '../../examples/addons/off-the-scale/',
);
const SECOND_LITTER = folder(
  import.meta.glob('../../examples/addons/second-litter/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  '../../examples/addons/second-litter/',
);

const url = (blob: Blob) => `blob:test/${blob.size}`;
const pets: LoadedPack = {
  key: 'power-hungry-pets',
  pack: petsJson as unknown as Pack,
  addons: [bigLitterJson as unknown as Addon],
  asset: (p) => `/packs/power-hungry-pets/${p}`,
};

async function addonZip(files: Record<string, string>): Promise<LoadedAddon> {
  const item = await importZip(await writeZip(files), { url });
  if (item.kind !== 'addon') throw new Error('expected an addon zip');
  return item.addon;
}

describe('example addons', () => {
  it('are addon zips for Power Hungry Pets, with their images moved under their own folder', async () => {
    const scale = await addonZip(OFF_THE_SCALE);
    expect(scale.gameId).toBe('power-hungry-pets');
    expect(scale.custom.offer).toMatchObject({ kind: 'addon', extends: 'power-hungry-pets', name: 'Off the Scale' });
    const bat = scale.addon.cards!.add!.find((c) => c.id === 'backflip-bat')!;
    expect(bat.image).toBe(`${scale.prefix}art/backflip-bat.svg`);
    const lp = withUploads(pets, [scale]);
    expect(lp.asset(bat.image!)).toMatch(/^blob:test\//);
    expect(lp.asset('art/king-cat.svg')).toBe('/packs/power-hungry-pets/art/king-cat.svg');
  });

  it('fit the built-in game alone, together and with Big Litter', async () => {
    const scale = await addonZip(OFF_THE_SCALE);
    const litter = await addonZip(SECOND_LITTER);
    expect(uploadProblems(pets, scale, [])).toEqual([]);
    expect(uploadProblems(pets, litter, [scale])).toEqual([]);
    const lp = withUploads(pets, [scale, litter]);
    for (const enabled of [['off-the-scale'], ['second-litter'], ['off-the-scale', 'second-litter'], ['big-litter', 'off-the-scale', 'second-litter']]) {
      expect(validateSelection(lp, enabled)).toEqual([]);
    }
  });

  it('name their zip when they do not fit', async () => {
    const broken = { ...SECOND_LITTER, 'addon.json': SECOND_LITTER['addon.json']!.replace('"op": "passHands"', '"op": "passhands"') };
    expect((await addonZip(broken)).addon.id).toBe('second-litter');
    expect(uploadProblems(pets, await addonZip(broken), [])).toEqual([
      'Second Litter/addon.json: cards.penguin-parade.onPlay[1]: unknown op "passhands"',
    ]);
    const twice = await addonZip(OFF_THE_SCALE);
    expect(uploadProblems(pets, twice, [await addonZip(OFF_THE_SCALE)])).toEqual(['Power Hungry Pets already has an addon with the id "off-the-scale".']);
  });

  it('have no files they do not use', () => {
    for (const files of [OFF_THE_SCALE, SECOND_LITTER]) {
      const text = files['addon.json']!;
      expect(Object.keys(files).filter((p) => p.endsWith('.svg') && !text.includes(`"${p}"`))).toEqual([]);
    }
  });
});
