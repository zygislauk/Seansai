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

test('US1: today’s screenings of a movie across all cinemas in the city', async ({
  page,
  isMobile,
}) => {
  // 1. A first visit lands in Lithuanian and shows all of Lithuania, offering a choice of city.
  await page.goto('/');
  await expect(page).toHaveURL(/\/lt\/$/);
  const prompt = page.getByRole('dialog', { name: 'Pasirinkite miestą' });
  await expect(prompt).toHaveCount(0);
  await expect(page.getByRole('article').first()).toBeVisible();
  const choice = page.getByRole('region', { name: 'Miestas' });
  await expect(choice).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // 2. Choosing Vilnius shows its movies, those with screenings left today first.
  await choice.getByRole('button', { name: 'Pasirinkti miestą' }).click();
  await prompt.getByRole('button', { name: /^Vilnius/ }).click();
  await expect(prompt).toBeHidden();
  await expect(choice).toBeHidden();
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

  // 4. "Pirkti bilietą" stays readable on hover and opens the cinema's page in a new tab.
  const ticket = rows.first().getByRole('link', { name: /Pirkti bilietą/ });
  const resting = 'rgb(180, 35, 24)';
  const hovered = 'rgb(145, 32, 24)';
  const popupOpens = page.waitForEvent('popup');
  if (isMobile) {
    await ticket.tap();
  } else {
    await ticket.hover();
    // The background first, as the resting label would pass until the hover style applies.
    await expect(ticket).toHaveCSS('background-color', hovered);
    await expect(ticket).toHaveCSS('color', 'rgb(255, 255, 255)');
    await ticket.click();
  }
  const popup = await popupOpens;
  expect(new URL(popup.url()).hostname).not.toBe('localhost');

  // Coming back, the button no longer looks hovered, though the browser still reports `:hover`.
  await popup.close();
  await page.bringToFront();
  await expect(ticket).toHaveCSS('background-color', resting);
  await expect(ticket).toHaveCSS('color', 'rgb(255, 255, 255)');
  if (!isMobile) {
    await page.mouse.move(0, 0);
    await ticket.hover();
    await expect(ticket).toHaveCSS('background-color', hovered);
  }

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
