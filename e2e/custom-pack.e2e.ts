import { expect, test, type APIRequestContext } from '@playwright/test';
import { writeZip } from '../src/packs/zip';
import type { Addon, Pack } from '../src/packs/types';
import { createLobby, joinTab, watchErrors } from './helpers';

/** Power Hungry Pets from the running site, zipped under another name and id. */
async function zipOfPets(request: APIRequestContext, change: (pack: Pack) => void): Promise<Uint8Array> {
  const base = '/packs/power-hungry-pets/';
  const pack = (await (await request.get(`${base}pack.json`)).json()) as Pack;
  const files: Record<string, string> = {};
  const paths = new Set([pack.art.cover, pack.art.back, pack.art.icon, ...pack.cards.map((c) => c.image)].filter((p): p is string => Boolean(p)));
  for (const path of pack.addons ?? []) {
    const text = await (await request.get(base + path)).text();
    files[path] = text;
    const addon = JSON.parse(text) as Addon;
    for (const image of [addon.image, addon.icon, ...(addon.cards?.add ?? []).map((c) => c.image)]) if (image) paths.add(image);
  }
  for (const path of paths) files[path] = await (await request.get(base + path)).text();
  change(pack);
  files['pack.json'] = JSON.stringify(pack);
  return writeZip(files);
}

const upload = (name: string, bytes: Uint8Array) => ({ name, mimeType: 'application/zip', buffer: Buffer.from(bytes) });

test('a host uploads a pack and players accept or decline it before the game', async ({ context, page, request }) => {
  const errors: string[] = [];
  watchErrors(page, errors, 'host');
  const good = await zipOfPets(request, (p) => Object.assign(p, { id: 'house-pets', name: 'House Pets', author: 'A Friend' }));
  const bad = await zipOfPets(request, (p) => {
    p.cards[1]!.onPlay = [{ op: 'chooseplayer', as: 't', from: 'others' }];
  });

  const hash = await createLobby(page, 'Hana');
  await page.setInputFiles('.tile-custom input[type=file]', upload('bad.zip', bad));
  await expect(page.locator('.upload-problems')).toContainText('pack.json: cards.crystal-bowl.onPlay[0]: unknown op "chooseplayer"');
  await page.click('.upload-problems button:has-text("Dismiss")');

  await page.setInputFiles('.tile-custom input[type=file]', upload('good.zip', good));
  await expect(page.locator('.hero-text h2')).toHaveText('House Pets');
  await expect(page.locator('.hero-img')).toHaveAttribute('src', /^blob:/);

  const tom = await joinTab(context, hash, '2', 'Tom', errors);
  await expect(tom.locator('.pack-consent')).toContainText('A Friend');
  await expect(page.locator('.start-reason')).toHaveText('Waiting for Tom to get the pack.');
  await tom.click('text=Get the pack');
  await expect(tom.locator('.hero-text h2')).toHaveText('House Pets');

  const mia = await joinTab(context, hash, '3', 'Mia', errors);
  await mia.click('text=No thanks, I will watch');
  await expect(page.locator('.player-list')).toContainText('Declined pack');
  await expect(page.locator('.start-reason')).toHaveText('Everyone is ready.');

  await page.click('button:has-text("Start game")');
  await expect(tom.locator('.table')).toBeVisible();
  const sources = await tom.locator('.table img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src') ?? ''));
  expect(sources.length).toBeGreaterThan(0);
  expect(sources.every((s) => s.startsWith('blob:'))).toBe(true);

  // Mia changes her mind and watches.
  await mia.click('text=Get the pack');
  await expect(mia.locator('.spectating')).toBeVisible();

  // The host's reload brings the pack back from IndexedDB.
  await page.reload();
  await expect(page.locator('.table')).toBeVisible();
  expect(errors).toEqual([]);
});
