import { expect, test, type Page } from '@playwright/test';
import { createLobby, joinTab, watchErrors } from './helpers';

/** Picks hand cards one at a time until one can be played alone, and plays it. */
async function playOneCard(page: Page): Promise<boolean> {
  const cards = page.locator('.hand .card-button');
  const playButton = page.locator('.prompt-bar .btn-primary:not([disabled])');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    // Each click re-renders the hand, so the card is looked up again every time.
    await cards.nth(i).click();
    if (await playButton.count()) {
      await playButton.click();
      return true;
    }
    await cards.nth(i).click();
  }
  return false;
}

const yourTurn = '.prompt-title:has-text("Your turn")';

/** Whoever is asked answers: "Draw a card" on their turn, otherwise the first choice. */
async function answerAny(pages: Page[], draw = true): Promise<boolean> {
  for (const page of pages) {
    if (!(await page.locator('.prompt-bar').count())) continue;
    if (await page.locator(yourTurn).count()) {
      if (!draw) continue;
      await page.click('.prompt-bar button:has-text("Draw a card")');
    } else {
      await page.locator('.prompt-bar .choice, .prompt-bar .choice-cards .card-button').first().click();
    }
    return true;
  }
  return false;
}

/** Answers other questions (where a kitten goes, say) until it is someone's turn. */
async function nextTurn(pages: Page[]): Promise<Page | null> {
  for (let i = 0; i < 100; i++) {
    for (const page of pages) if (await page.locator(yourTurn).count()) return page;
    if (await pages[0]!.locator('.result-game').count()) return null;
    if (!(await answerAny(pages, false))) await pages[0]!.waitForTimeout(100);
  }
  throw new Error('nobody got a turn');
}

test('two players play Exploding Kittens with a Nope window', async ({ context, page }) => {
  const errors: string[] = [];
  watchErrors(page, errors, 'host');
  const hash = await createLobby(page, 'Hana');
  const tom = await joinTab(context, hash, '2', 'Tom', errors);
  await expect(page.locator('.player-list .conn.on')).toHaveCount(2);

  await page.click('.tile:has-text("Exploding Kittens")');
  await expect(page.locator('.hero-text h2')).toHaveText('Exploding Kittens');
  await page.locator('.option:has-text("Seconds to Nope") select').selectOption('2');
  await page.click('button:has-text("Start game")');
  for (const p of [page, tom]) await expect(p.locator('.table')).toBeVisible();
  await expect(page.locator('.table-info')).toContainText('One round decides the game');

  // Draw until someone can play a card on its own, then watch its window on both screens.
  let played = false;
  for (let turn = 0; turn < 20 && !played; turn++) {
    const active = await nextTurn([page, tom]);
    if (!active) break;
    played = await playOneCard(active);
    if (!played) {
      await active.click('.prompt-bar button:has-text("Draw a card")');
      continue;
    }
    const other = active === page ? tom : page;
    await expect(active.locator('.window')).toContainText('You played');
    await expect(other.locator('.window')).toContainText('played');
    const nope = other.locator('.window .btn-danger');
    if (await nope.count()) {
      await nope.click();
      for (const p of [page, tom]) await expect(p.locator('.window')).toContainText('is stopped');
    }
    for (const p of [page, tom]) await expect(p.locator('.window')).toHaveCount(0);
  }
  expect(played).toBe(true);

  // Then everyone only draws. Kittens put back on top come round fast, so the game ends.
  for (let i = 0; i < 400 && !(await page.locator('.result-game').count()); i++) {
    const acted = await answerAny([page, tom]);
    await page.waitForTimeout(acted ? 40 : 150);
  }
  const headline = page.locator('.result-game h2');
  await expect(headline).toContainText('wins the game!');
  await expect(tom.locator('.result-game h2')).toHaveText((await headline.textContent())!);
  await expect(page.locator('.log')).toContainText('explodes!');
  expect(errors).toEqual([]);
});
