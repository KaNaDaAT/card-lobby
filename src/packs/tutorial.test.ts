/**
 * docs/TUTORIAL.md and its example addon in examples/my-first-addon: the JSON in the tutorial
 * matches the files, the example zip uploads next to every Power Hungry Pets addon, and the
 * Sleepy Ferret does what its text says.
 */
import { describe, expect, it } from 'vitest';
import tutorial from '../../docs/TUTORIAL.md?raw';
import exampleJson from '../../examples/my-first-addon/addon.json';
import secondLitterJson from '../../public/packs/power-hungry-pets/addons/second-litter.json';
import { mergeAddons } from './merge';
import { petsAddons, petsBase, Table } from '../engine/testing';
import { importZip, uploadProblems, withUploads } from './custom';
import type { Addon, LoadedPack } from './types';
import { validateSelection } from './validate';
import { writeZip } from './zip';

const EXAMPLE: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../../examples/my-first-addon/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  ).map(([path, text]) => [path.replace('../../examples/my-first-addon/', ''), text]),
);

/** The JSON code blocks of the tutorial, in order. */
const blocks = [...tutorial.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);

const pets: LoadedPack = { key: 'power-hungry-pets', pack: petsBase, addons: petsAddons, asset: (p) => p };

describe('the tutorial', () => {
  it('shows Nosy Ferret as it is in Second Litter', () => {
    const ferret = (secondLitterJson as unknown as Addon).cards!.add!.find((c) => c.id === 'nosy-ferret');
    expect(JSON.parse(blocks[0]!)).toEqual(ferret);
  });

  it('shows the example addon exactly as it is in examples/my-first-addon', () => {
    const marker = tutorial.indexOf('<!-- tutorial example: examples/my-first-addon/addon.json -->');
    expect(marker).toBeGreaterThan(0);
    const block = /```json\n([\s\S]*?)```/.exec(tutorial.slice(marker))![1]!;
    expect(JSON.parse(block)).toEqual(exampleJson);
  });

  it('has an example that zips, uploads next to every built-in addon and validates with all of them', async () => {
    const item = await importZip(await writeZip(EXAMPLE), { url: () => 'blob:test' });
    if (item.kind !== 'addon') throw new Error('expected an addon zip');
    expect(item.addon.gameId).toBe('power-hungry-pets');
    expect(uploadProblems(pets, item.addon, [])).toEqual([]);
    const all = [...petsAddons.map((a) => a.id), 'sleepy-ferrets'];
    expect(validateSelection(withUploads(pets, [item.addon]), all)).toEqual([]);
    expect(Object.keys(EXAMPLE).sort()).toEqual(['addon.json', 'art/addon.svg', 'art/sleepy-ferret.svg']);
  });

  it('has a Sleepy Ferret that peeks at a card and then naps', () => {
    const pack = mergeAddons(petsBase, [...petsAddons, exampleJson as unknown as Addon], ['sleepy-ferrets']);
    const t = new Table(pack, 3);
    const [me, a, b] = t.order;
    t.rig(`hand:${me}`, ['sleepy-ferret', 'crystal-bowl']);
    t.rig(`hand:${a}`, ['king-cat']);
    t.play('sleepy-ferret');
    t.answer(a);
    expect(t.seenInHand(me!, a!)).toEqual(['king-cat']);
    expect(t.seenInHand(b!, a!)).toEqual([]);
    expect(t.s.players[me!]!.statuses.map((s) => s.id)).toEqual(['protected']);
  });
});
