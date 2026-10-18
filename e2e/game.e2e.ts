import { expect, test } from '@playwright/test';
import { createLobby, joinTab, playToTheEnd, watchErrors } from './helpers';

test('three players play a whole game in the browser', async ({ context, page }) => {
  const errors: string[] = [];
  watchErrors(page, errors, 'host');
  const hash = await createLobby(page, 'Hana');
  const tom = await joinTab(context, hash, '2', 'Tom', errors);
  const mia = await joinTab(context, hash, '3', 'Mia', errors);
  await expect(page.locator('.player-list .conn.on')).toHaveCount(3);

  await page.click('button:has-text("Start game")');
  for (const p of [page, tom, mia]) await expect(p.locator('.table')).toBeVisible();

  // Clicking a card that cannot be played shows it large with its text.
  await page.locator('.card-inspect').first().click();
  await expect(page.locator('dialog.card-dialog')).toBeVisible();
  await page.click('dialog.card-dialog button:has-text("Close")');
  await expect(page.locator('dialog.card-dialog')).toHaveCount(0);

  const moves = await playToTheEnd(page, [page, tom, mia]);
  expect(moves).toBeGreaterThan(5);
  const headline = page.locator('.result-game h2');
  await expect(headline).toContainText('the game!');
  await expect(tom.locator('.result-game h2')).toHaveText((await headline.textContent())!);

  await page.click('button:has-text("Rematch")');
  for (const p of [page, tom, mia]) await expect(p.locator('.table-info')).toContainText('Round 1');
  await page.click('.player .btn:has-text("Take out") >> nth=0');
  await expect(page.locator('.seat .pill-out, .you .pill-out').first()).toBeVisible();
  expect(errors).toEqual([]);
});
