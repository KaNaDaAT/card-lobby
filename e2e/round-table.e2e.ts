import { expect, test } from '@playwright/test';
import { createLobby, joinTab, playToTheEnd, watchErrors } from './helpers';

test('the round table seats everyone, points at whose move it is, and is remembered', async ({ context, page }) => {
  const errors: string[] = [];
  watchErrors(page, errors, 'host');
  const hash = await createLobby(page, 'Hana');
  const tom = await joinTab(context, hash, '2', 'Tom', errors);
  const mia = await joinTab(context, hash, '3', 'Mia', errors);
  await expect(page.locator('.player-list .conn.on')).toHaveCount(3);
  await page.click('button:has-text("Start game")');
  for (const p of [page, tom, mia]) await expect(p.locator('.table')).toBeVisible();

  // Classic stays the default. The host switches, the others keep their own choice.
  await expect(page.locator('.rt-felt')).toHaveCount(0);
  await page.click('.layout-toggle .seg:has-text("Round table")');
  await expect(page.locator('.rt-seat')).toHaveCount(3);
  await expect(page.locator('.rt-seat.is-me')).toContainText('Hana (you)');
  await expect(page.locator('.rt-seat.is-focus')).toHaveCount(1);
  await expect(page.locator('.rt-turn')).toHaveText(/turn$/);
  await expect(tom.locator('.rt-felt')).toHaveCount(0);

  // The players list moves into a tab beside the log.
  await expect(page.locator('.col-main .player-list')).toHaveCount(0);
  await page.click('.side-tabs .seg:has-text("Players")');
  await expect(page.locator('.col-side .player-list')).toContainText('Tom');

  await page.reload();
  await expect(page.locator('.rt-felt')).toBeVisible();

  const moves = await playToTheEnd(page, [page, tom, mia]);
  expect(moves).toBeGreaterThan(5);
  await expect(page.locator('.result-game h2')).toContainText('the game!');
  expect(errors).toEqual([]);
});
