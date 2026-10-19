import { expect, test } from '@playwright/test';
import { createLobby, joinTab, watchErrors } from './helpers';

test('two tabs share a lobby and chat, and the room survives a host reload', async ({ context, page }) => {
  const errors: string[] = [];
  watchErrors(page, errors, 'host');
  const hash = await createLobby(page, 'Hana');
  const tom = await joinTab(context, hash, '2', 'Tom', errors);
  await expect(page.locator('.player-list .conn.on')).toHaveCount(2);

  await tom.fill('.chat-form input', 'hello from tom');
  await tom.press('.chat-form input', 'Enter');
  await expect(page.locator('.chat-log')).toContainText('hello from tom');

  await page.locator('.option select').first().selectOption('sumPlayed');
  await expect(tom.locator('.option select').first()).toHaveValue('sumPlayed');
  await expect(tom.locator('.option select').first()).toBeDisabled();

  await page.reload();
  await expect(page.locator('.player-list .conn.on')).toHaveCount(2, { timeout: 20_000 });
  await expect(tom.locator('.notice-warn')).toHaveCount(0, { timeout: 20_000 });
  await expect(tom.locator('.option select').first()).toHaveValue('sumPlayed');
  await expect(page.locator('.chat-log')).toContainText('hello from tom');
  expect(errors).toEqual([]);
});

test('the host sets card counts and slow mode, and clears the chat', async ({ context, page }) => {
  const errors: string[] = [];
  watchErrors(page, errors, 'host');
  const hash = await createLobby(page, 'Hana');
  const tom = await joinTab(context, hash, '2', 'Tom', errors);

  await page.click('[aria-label="One King Cat less"]');
  await page.click('[aria-label="One Crystal Bowl more"]');
  await expect(tom.locator('.count-note')).toHaveText('The host changed how many copies go into the deck.');
  await expect(tom.locator('.count-card.is-zero')).toHaveCount(1);
  await expect(tom.locator('.hero-pills')).toContainText('21 cards');
  await page.click('.count-note button:has-text("Reset")');
  await expect(tom.locator('.count-note')).toHaveCount(0);

  await tom.fill('.chat-form input', 'one');
  await tom.press('.chat-form input', 'Enter');
  await expect(tom.locator('.chat-form button')).toHaveText(/^Wait \ds$/);
  await expect(tom.locator('.chat-form button')).toHaveText('Send', { timeout: 5_000 });

  await page.locator('.chat-tools select').selectOption('0');
  await expect(tom.locator('.chat-log')).toContainText('Slow mode is off.');
  await tom.fill('.chat-form input', 'two');
  await tom.press('.chat-form input', 'Enter');
  await expect(tom.locator('.chat-form button')).toHaveText('Send');

  await page.click('.chat-tools button:has-text("Clear")');
  await page.click('dialog.confirm-dialog button:has-text("Clear chat")');
  await expect(tom.locator('.chat-log')).toHaveText('The host cleared the chat.');
  await tom.click('.chat-tools button:has-text("Clear")');
  await expect(tom.locator('.chat-log')).toHaveText('You cleared the chat.');
  expect(errors).toEqual([]);
});

test('the host can end a game for everyone', async ({ context, page }) => {
  const errors: string[] = [];
  watchErrors(page, errors, 'host');
  const hash = await createLobby(page, 'Hana');
  const tom = await joinTab(context, hash, '2', 'Tom', errors);
  await page.click('button:has-text("Start game")');
  await expect(tom.locator('.table')).toBeVisible();
  await expect(tom.locator('.end-game')).toHaveCount(0);
  await page.click('.end-game');
  await page.click('dialog.confirm-dialog button:has-text("End the game")');
  await expect(tom.locator('.hero-text h2')).toHaveText('Power Hungry Pets');
  await expect(tom.locator('.chat-log')).toContainText('The host ended the game.');
  expect(errors).toEqual([]);
});

test('a phone gets the side panels as drawers', async ({ context, page }) => {
  const errors: string[] = [];
  const hash = await createLobby(page, 'Hana');
  const phone = await joinTab(context, hash, '2', 'Tom', errors);
  await phone.setViewportSize({ width: 390, height: 844 });
  await expect(phone.locator('.dock')).toBeVisible();
  await expect(page.locator('.dock')).toBeHidden();

  await page.fill('.chat-form input', 'psst');
  await page.press('.chat-form input', 'Enter');
  await expect(phone.locator('.dock-badge')).toHaveText('1');
  await phone.click('.dock button:has-text("Chat")');
  await expect(phone.locator('.col-side .chat-log')).toContainText('psst');
  await expect(phone.locator('.dock-badge')).toHaveCount(0);
  await phone.keyboard.press('Escape');
  await expect(phone.locator('.col-side')).toBeHidden();
  expect(errors).toEqual([]);
});
