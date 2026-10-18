import { expect, test } from '@playwright/test';
import { createLobby, joinTab, playToTheEnd, watchErrors } from './helpers';

test('the example pack uploads as a zip and plays with both house addons', async ({ context, page }) => {
  const errors: string[] = [];
  watchErrors(page, errors, 'host');
  const hash = await createLobby(page, 'Hana');
  // Built by e2e/global-setup.mjs with `npm run zip-pack`.
  await page.setInputFiles('.tile-custom input[type=file]', 'examples/packs/power-hungry-pets-wild.zip');
  await expect(page.locator('.hero-text h2')).toHaveText('Power Hungry Pets: Wild Cards');

  await page.check('.addon:has-text("Off the Scale") input');
  await page.check('.addon:has-text("Second Litter") input');
  await expect(page.locator('.card-value', { hasText: '∞' })).toBeVisible();
  await expect(page.locator('.card-value', { hasText: '-1' })).toBeVisible();

  const tom = await joinTab(context, hash, '2', 'Tom', errors);
  await tom.click('text=Get the pack');
  await expect(tom.locator('.hero-text h2')).toHaveText('Power Hungry Pets: Wild Cards');
  await expect(tom.locator('.addon.is-on')).toHaveCount(2);

  await page.click('button:has-text("Start game")');
  for (const p of [page, tom]) await expect(p.locator('.table')).toBeVisible();
  const moves = await playToTheEnd(page, [page, tom]);
  expect(moves).toBeGreaterThan(3);
  await expect(page.locator('.result-game h2')).toContainText('the game!');
  expect(errors).toEqual([]);
});
