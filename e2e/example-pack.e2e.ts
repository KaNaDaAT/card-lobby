import { expect, test } from '@playwright/test';
import { createLobby, joinTab, playToTheEnd, watchErrors } from './helpers';

test('built-in addons and an uploaded addon zip play together, after players accept the upload', async ({ context, page }) => {
  const errors: string[] = [];
  watchErrors(page, errors, 'host');
  const hash = await createLobby(page, 'Hana');
  await expect(page.locator('.hero-text h2')).toHaveText('Power Hungry Pets');

  // The two house addons ship with the game.
  await page.check('.addon:has-text("Off the Scale") input');
  await page.check('.addon:has-text("Second Litter") input');
  await expect(page.locator('.card-value', { hasText: '∞' })).toBeVisible();

  // The tutorial's addon, zipped by e2e/global-setup.mjs. Uploading it turns it on.
  await page.setInputFiles('.tile-custom input[type=file]', 'examples/my-first-addon.zip');
  await expect(page.locator('.addon.is-on:has-text("Sleepy Ferrets")')).toContainText('Uploaded');
  await expect(page.locator('.addon.is-on')).toHaveCount(3);

  const tom = await joinTab(context, hash, '2', 'Tom', errors);
  await expect(tom.locator('.pack-consent h2')).toHaveText('The host added a custom addon');
  await expect(tom.locator('.pack-consent')).toContainText('Addon for Power Hungry Pets');
  await tom.click('.pack-consent button:has-text("Get the pack")');
  await expect(tom.locator('.addon.is-on')).toHaveCount(3);
  await expect(page.locator('.start-reason')).toHaveText('Everyone is ready.');

  // The host's browser keeps the upload for next time.
  await page.reload();
  await expect(page.locator('.addon.is-on')).toHaveCount(3);

  await page.click('button:has-text("Start game")');
  for (const p of [page, tom]) await expect(p.locator('.table')).toBeVisible();
  const moves = await playToTheEnd(page, [page, tom]);
  expect(moves).toBeGreaterThan(3);
  await expect(page.locator('.result-game h2')).toContainText('the game!');
  expect(errors).toEqual([]);
});
