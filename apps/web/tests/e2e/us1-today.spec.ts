import { expect, test } from '@playwright/test';
import {
  answerExternalRequestsLocally,
  expectNoAccessibilityViolations,
  waitForSources,
} from './helpers.ts';

/** Quickstart US1 against the fixture data (see helpers.ts for the fixture clock). */

test.beforeEach(async ({ context, request }) => {
  await answerExternalRequestsLocally(context);
  await waitForSources(request);
});

test('US1: today’s screenings of a movie across all cinemas in the city', async ({ page }) => {
  // 1. A first visit lands in Lithuanian and shows all of Lithuania without asking first.
  await page.goto('/');
  await expect(page).toHaveURL(/\/lt\/$/);
  const switcher = page.getByRole('button', { name: 'Keisti miestą: Visa Lietuva' });
  await expect(switcher).toBeVisible();
  const prompt = page.getByRole('dialog', { name: 'Pasirinkite miestą' });
  await expect(prompt).toHaveCount(0);
  await expect(page.getByRole('article').first()).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // 2. Choosing Vilnius shows its movies, those with screenings left today first.
  await switcher.click();
  await prompt.getByRole('button', { name: /^Vilnius/ }).click();
  await expect(prompt).toBeHidden();
  const cards = page.getByRole('article');
  await expect(cards.first()).toContainText('šiandien');
  await expectNoAccessibilityViolations(page);

  // 3. A movie shown at several cinemas: one timeline in time order, nothing already started.
  await page.getByRole('link', { name: /Kita mamytė/ }).click();
  await expect(page).toHaveURL(/\/lt\/movie\/[\w-]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Kita mamytė' })).toBeVisible();
  const rows = page.getByRole('list', { name: 'Seansai' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  const times = await rows.locator('time').allTextContents();
  expect(times).toEqual([...times].sort());
  for (const time of times) expect(time > '19:46').toBe(true);
  for (const cinema of ['Apollo Akropolis', 'Apollo Outlet', 'Pasaka Paupys']) {
    await expect(page.getByRole('list', { name: 'Seansai' })).toContainText(cinema);
  }
  await expectNoAccessibilityViolations(page);

  // 4. "Pirkti bilietą" opens the cinema's page in a new tab.
  const popup = page.waitForEvent('popup');
  await rows
    .first()
    .getByRole('link', { name: /Pirkti bilietą/ })
    .click();
  expect(new URL((await popup).url()).hostname).not.toBe('localhost');

  // 5. A movie with no screenings left today points to the next date.
  await page.goto('/lt/');
  await page
    .getByRole('article')
    .filter({ hasText: 'Nuo spalio 31' })
    .first()
    .getByRole('link')
    .click();
  await expect(page.getByText('Šiandien seansų nebeliko')).toBeVisible();
  await expect(page.getByRole('link', { name: /Artimiausi seansai/ })).toHaveAttribute(
    'href',
    /\/lt\/movie\/[\w-]+\?date=2026-10-31$/,
  );
  await expectNoAccessibilityViolations(page);
});
