import AxeBuilder from '@axe-core/playwright';
import { HealthResponseSchema } from '@seansai/shared';
import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

/**
 * The e2e tests run against the fixture data (SOURCES_MODE=fixtures). The fixture clock is the
 * earliest capture instant in apps/api/tests/fixtures/README.md: Friday 30 October 2026, 19:39 in
 * Vilnius. Forum was captured a day later, so its screenings start on Saturday 31 October.
 */

/** The fixture clock, for tests that need the browser to agree with the API about today. */
export const FIXTURE_INSTANT = new Date('2026-10-30T17:39:42Z');

/** Tests never contact cinema websites: posters and ticket pages are answered locally. */
export async function answerExternalRequestsLocally(context: BrowserContext) {
  await context.route(
    (url) => url.hostname !== 'localhost',
    (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Kino teatras</title>' }),
  );
}

export async function expectNoAccessibilityViolations(page: Page) {
  // Part-way through a colour transition, a scan can catch text in its old colour on its new
  // background, which no visitor is left with.
  await page.evaluate(
    'Promise.allSettled(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished))',
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

/**
 * The API answers as soon as it listens, but loads the fixtures just after, and slower when
 * several test servers start at once. Waits until every source has loaded, so counts are final.
 * `request` uses the test's baseURL.
 */
export async function waitForSources(request: APIRequestContext) {
  await expect
    .poll(
      async () => {
        const response = await request.get('/api/v1/health');
        if (!response.ok()) return ['API not up'];
        return HealthResponseSchema.parse(await response.json())
          .sources.filter((source) => source.lastSuccessAt === null)
          .map((source) => source.id);
      },
      { message: 'sources still loading', timeout: 30_000 },
    )
    .toEqual([]);
}
