/**
 * The example custom pack in examples/packs/power-hungry-pets-wild: it loads through the same zip
 * import a host uses, every addon combination is valid, and its copy of Power Hungry Pets
 * matches the built-in pack.
 */
import { describe, expect, it } from 'vitest';
import { importPackZip } from './custom';
import { validateSelection } from './validate';
import { writeZip } from './zip';

const files = (glob: Record<string, string>, prefix: string) =>
  Object.fromEntries(Object.entries(glob).map(([path, text]) => [path.replace(prefix, ''), text]));

const WILD = files(
  import.meta.glob('../../examples/packs/power-hungry-pets-wild/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  '../../examples/packs/power-hungry-pets-wild/',
);
const PETS = files(
  import.meta.glob('../../public/packs/power-hungry-pets/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  '../../public/packs/power-hungry-pets/',
);

const url = (blob: Blob) => `blob:test/${blob.size}`;

describe('example pack: Power Hungry Pets, Wild Cards', () => {
  it('imports from a zip with its three addons', async () => {
    const lp = await importPackZip(await writeZip(WILD), { url });
    expect(lp.pack.name).toBe('Power Hungry Pets: Wild Cards');
    expect(lp.addons.map((a) => a.id)).toEqual(['big-litter', 'off-the-scale', 'second-litter']);
    const images = new Set(Object.keys(WILD).filter((p) => p.endsWith('.svg')));
    for (const enabled of [['off-the-scale'], ['second-litter'], ['off-the-scale', 'second-litter'], ['big-litter', 'off-the-scale', 'second-litter']]) {
      expect(validateSelection(lp, enabled, images)).toEqual([]);
    }
  });

  it('has no files it does not use', () => {
    const text = Object.entries(WILD).filter(([p]) => p.endsWith('.json')).map(([, t]) => t).join('\n');
    const unused = Object.keys(WILD).filter((p) => p.endsWith('.svg') && !text.includes(`"${p}"`));
    expect(unused).toEqual([]);
  });

  it('keeps its copy of Power Hungry Pets in step with the built-in pack', () => {
    const wild = JSON.parse(WILD['pack.json']!);
    const pets = JSON.parse(PETS['pack.json']!);
    const own = ['id', 'name', 'description', 'addons'];
    for (const key of Object.keys(pets)) if (!own.includes(key) && key !== 'art') expect(wild[key], key).toEqual(pets[key]);
    expect({ ...wild.art, cover: pets.art.cover }).toEqual(pets.art);
    expect(WILD['addons/big-litter.json']).toBe(PETS['addons/big-litter.json']);
    for (const path of Object.keys(PETS)) if (path.startsWith('art/') && path !== 'art/cover.svg') expect(WILD[path], path).toBe(PETS[path]);
  });
});
