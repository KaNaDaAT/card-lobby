import { expect, type BrowserContext, type Page } from '@playwright/test';

/** Fails the test on any page error or console error. */
export function watchErrors(page: Page, errors: string[], label: string): void {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label}: ${m.text()}`);
  });
}

/** Opens the home page in local mode, creates a lobby and returns the room hash. */
export async function createLobby(page: Page, name: string): Promise<string> {
  await page.goto('/?transport=local');
  await page.fill('#name', name);
  await page.click('text=Create lobby');
  await expect(page.locator('.player-list .player')).toHaveCount(1);
  return new URL(page.url()).hash;
}

/** A new tab with its own identity slot that joins the room. */
export async function joinTab(context: BrowserContext, hash: string, slot: string, name: string, errors: string[]): Promise<Page> {
  const page = await context.newPage();
  watchErrors(page, errors, name);
  await page.goto(`/?transport=local&as=${slot}`);
  await page.fill('#name', name);
  await page.fill('.input-code', hash.replace('#/r/', ''));
  await page.click('button:has-text("Join")');
  await expect(page.locator('.player-list')).toContainText(name);
  return page;
}

/**
 * Plays until the game ends: whoever has a prompt answers with the first choice (a card opens
 * large first, then Play), and the host starts each next round. Returns how many moves were made.
 */
export async function playToTheEnd(host: Page, pages: Page[], maxMoves = 600): Promise<number> {
  let moves = 0;
  for (let i = 0; i < maxMoves * 2 && !(await host.locator('.result-game').count()); i++) {
    let acted = false;
    for (const page of pages) {
      if (!(await page.locator('.prompt-bar').count())) continue;
      const card = page.locator('.hand .card-button.is-active').first();
      if (await card.count()) {
        await card.click();
        await page.locator('dialog.card-dialog .card-play').click();
      } else {
        await page.locator('.prompt-bar .choice').first().click();
      }
      moves++;
      acted = true;
      break;
    }
    if (!acted) {
      const next = host.locator('.result-actions button.btn-primary:not([disabled])');
      if ((await next.count()) && !(await host.locator('.result-game').count())) await next.click();
    }
    await host.waitForTimeout(acted ? 40 : 100);
  }
  return moves;
}
