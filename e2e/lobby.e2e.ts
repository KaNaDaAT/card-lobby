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
