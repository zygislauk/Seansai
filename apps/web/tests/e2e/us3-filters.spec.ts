import { MoviesResponseSchema } from '@seansai/shared';
import { expect, test, type Page } from '@playwright/test';
import {
  answerExternalRequestsLocally,
  expectNoAccessibilityViolations,
  waitForSources,
} from './helpers.ts';

/**
 * Quickstart US3 against the fixture data (see helpers.ts for the fixture clock). No cinema had a 3D
 * screening when the fixtures were captured, so the format step filters Forum's IMAX screenings.
 */

test.beforeEach(async ({ context, request }) => {
  await answerExternalRequestsLocally(context);
  await waitForSources(request);
});

async function movieCount(page: Page, city: string) {
  const response = await page.request.get(`/api/v1/movies?city=${city}`);
  return MoviesResponseSchema.parse(await response.json()).movies.length;
}

async function switchCity(page: Page, from: string, to: RegExp) {
  await page.getByRole('button', { name: `Keisti miestą: ${from}` }).click();
  await page
    .getByRole('dialog', { name: 'Pasirinkite miestą' })
    .getByRole('button', { name: to })
    .click();
}

/** On phones the filter groups fold behind a toggle. */
async function showFilters(page: Page) {
  const toggle = page.getByRole('button', { name: /^Filtrai/ });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

test('US3: changing city and filtering screenings', async ({ page }) => {
  // 1. Switch city to "Visa Lietuva", then to Kaunas; the list follows, and Kaunas survives a reload.
  await page.goto('/lt/');
  await page
    .getByRole('dialog', { name: 'Pasirinkite miestą' })
    .getByRole('button', { name: /^Vilnius/ })
    .click();
  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(await movieCount(page, 'vilnius'));

  await switchCity(page, 'Vilnius', /^Visa Lietuva/);
  await expect(cards).toHaveCount(await movieCount(page, 'all'));
  await switchCity(page, 'Visa Lietuva', /^Kaunas/);
  await expect(cards).toHaveCount(await movieCount(page, 'kaunas'));
  await expectNoAccessibilityViolations(page);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Keisti miestą: Kaunas' })).toBeVisible();
  await expect(cards).toHaveCount(await movieCount(page, 'kaunas'));
  await cards.first().getByRole('link').click();
  const rows = page.getByRole('list', { name: 'Seansai' }).getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasNotText: 'Kaunas' })).toHaveCount(0);

  // 2. Back in Vilnius, a movie shown at several cinemas: filter by cinema, then by language.
  await switchCity(page, 'Kaunas', /^Vilnius/);
  await page.getByRole('link', { name: 'Seansai', exact: true }).click();
  await page.getByRole('searchbox').fill('Užmirštoji sala');
  await page.getByRole('link', { name: /Užmirštoji sala/ }).click();
  await page.getByRole('toolbar', { name: 'Pasirinkite datą' }).getByRole('button').nth(2).click();
  await expect(page).toHaveURL(/\?date=2026-11-01$/);
  await expect(rows).toHaveCount(13);
  await showFilters(page);
  // Every screening of it that day is 2D, so there is no format to choose.
  await expect(page.getByRole('group', { name: 'Formatas' })).toHaveCount(0);

  const cinemas = page.getByRole('group', { name: 'Kino teatras' });
  await cinemas.getByRole('button', { name: 'Vue Vilnius' }).click();
  await expect(page).toHaveURL(/[?&]cinema=vue-vilnius(&|$)/);
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasNotText: 'Vue Vilnius' })).toHaveCount(0);
  await cinemas.getByRole('button', { name: 'Vue Vilnius' }).click();
  await expect(rows).toHaveCount(13);

  await page
    .getByRole('group', { name: 'Kalba' })
    .getByRole('button', { name: 'Originalo kalba' })
    .click();
  await expect(page).toHaveURL(/[?&]audio=original(&|$)/);
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('Rodoma 2 iš 13')).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // 3. Filters that match nothing explain so and clear with one click.
  const shownRows = (await rows.allTextContents()).join(' ');
  const names = await cinemas.getByRole('button').allTextContents();
  const otherCinema = names.find((name) => !shownRows.includes(name)) ?? '';
  await cinemas.getByRole('button', { name: otherCinema }).click();
  await expect(rows).toHaveCount(0);
  const noMatch = page.getByText('Pagal pasirinktus filtrus seansų nėra');
  await expect(noMatch).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await page.getByRole('main').getByRole('button', { name: 'Išvalyti filtrus' }).last().click();
  await expect(rows).toHaveCount(13);
  await expect(page).toHaveURL(/\/lt\/movie\/[\w-]+\?date=2026-11-01$/);

  // 2 (format). "Odisėja" runs in 2D at Vue and in IMAX at Forum Cinemas Vingis that day.
  await page.getByRole('link', { name: 'Seansai', exact: true }).click();
  await page.getByRole('searchbox').fill('Odisėja');
  await page.getByRole('link', { name: /Odisėja/ }).click();
  await page.getByRole('toolbar', { name: 'Pasirinkite datą' }).getByRole('button').nth(2).click();
  await expect(page).toHaveURL(/\?date=2026-11-01$/);
  await expect(rows).toHaveCount(4);
  await expect(rows.getByText('2D', { exact: true })).toHaveCount(0);
  await showFilters(page);
  const formats = page.getByRole('group', { name: 'Formatas' });
  await expect(formats.getByRole('button')).toHaveText(['IMAX']);
  await formats.getByRole('button', { name: 'IMAX' }).click();
  await expect(page).toHaveURL(/[?&]format=IMAX(&|$)/);
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasNotText: 'Forum Cinemas Vingis' })).toHaveCount(0);
  await expect(page.getByText('Rodoma 2 iš 4')).toBeVisible();
  await expectNoAccessibilityViolations(page);
});
