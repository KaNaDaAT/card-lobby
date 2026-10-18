import { expect, test } from '@playwright/test';
import { createLobby, joinTab, playToTheEnd, watchErrors } from './helpers';

test('addon zips join the built-in game, players accept them, and the game plays with them', async ({ context, page }) => {
  const errors: string[] = [];
  watchErrors(page, errors, 'host');
  const hash = await createLobby(page, 'Hana');
  await expect(page.locator('.hero-text h2')).toHaveText('Power Hungry Pets');

  // Built by e2e/global-setup.mjs with `npm run zip-pack`. Each upload turns its addon on.
  await page.setInputFiles('.tile-custom input[type=file]', 'examples/addons/off-the-scale.zip');
  await expect(page.locator('.addon.is-on:has-text("Off the Scale")')).toContainText('Uploaded');
  await page.setInputFiles('.tile-custom input[type=file]', 'examples/addons/second-litter.zip');
  await expect(page.locator('.addon.is-on')).toHaveCount(2);
  await expect(page.locator('.card-value', { hasText: '∞' })).toBeVisible();
  await expect(page.locator('.card-strip img').first()).toBeVisible();

  const tom = await joinTab(context, hash, '2', 'Tom', errors);
  await expect(tom.locator('.pack-consent h2')).toHaveText('The host added custom addons');
  await expect(tom.locator('.pack-consent')).toContainText('Addon for Power Hungry Pets');
  await tom.click('.pack-consent button:has-text("Get them")');
  await expect(tom.locator('.hero-text h2')).toHaveText('Power Hungry Pets');
  await expect(tom.locator('.addon.is-on')).toHaveCount(2);
  await expect(page.locator('.start-reason')).toHaveText('Everyone is ready.');

  // The host's browser keeps the addons for next time.
  await page.reload();
  await expect(page.locator('.addon.is-on')).toHaveCount(2);

  await page.click('button:has-text("Start game")');
  for (const p of [page, tom]) await expect(p.locator('.table')).toBeVisible();
  const moves = await playToTheEnd(page, [page, tom]);
  expect(moves).toBeGreaterThan(3);
  await expect(page.locator('.result-game h2')).toContainText('the game!');
  expect(errors).toEqual([]);
});
