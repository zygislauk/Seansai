import { readFileSync } from 'node:fs';
import {
  CitiesResponseSchema,
  MoviesResponseSchema,
  ScreeningsResponseSchema,
} from '@seansai/shared';
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  answerExternalRequestsLocally,
  expectNoAccessibilityViolations,
  FIXTURE_INSTANT,
  waitForSources,
} from './helpers.ts';
import { SNAPSHOT_PORT } from './ports.ts';

/** The daily snapshot over the fixture data: what search engines and first-time visitors get. */
test.use({ baseURL: `http://localhost:${String(SNAPSHOT_PORT)}` });

const SITE = 'https://seansai.vercel.app';

test.beforeEach(async ({ context, request }) => {
  await answerExternalRequestsLocally(context);
  await waitForSources(request);
});

async function listedMovies(request: APIRequestContext, city = 'all') {
  const response = await request.get(`/api/v1/movies?city=${city}`);
  return MoviesResponseSchema.parse(await response.json()).movies;
}

const moviePath = (id: string) => `/lt/movie/${encodeURIComponent(id)}`;

test.describe('without scripts', () => {
  test.use({ javaScriptEnabled: false });

  test('a movie showing today has its title, facts, summary, screenings and ticket links', async ({
    page,
    request,
  }) => {
    const movies = await listedMovies(request);
    const listing = movies.find(({ screeningsToday }) => screeningsToday > 0);
    if (!listing) throw new Error('expected a movie showing today');
    const response = await request.get(
      `/api/v1/movies/${encodeURIComponent(listing.movie.id)}/screenings?city=all`,
    );
    const { screenings } = ScreeningsResponseSchema.parse(await response.json());

    await page.goto(moviePath(listing.movie.id));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(listing.movie.title);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('lang', 'lt');
    await expect(page.getByText(/Artimiausias seansas: .*\. Kur: /)).toBeVisible();
    const list = page.getByRole('list', { name: 'Seansai' });
    await expect(list.getByRole('listitem')).toHaveCount(screenings.length);
    for (const screening of screenings) {
      await expect(list.locator(`a[href="${screening.ticketUrl}"]`).first()).toBeAttached();
    }
    if (listing.movie.durationMinutes !== null) {
      await expect(page.getByText(`${String(listing.movie.durationMinutes)} min`)).toBeVisible();
    }
    expect(await page.title()).toContain(listing.movie.title);
  });

  test('a movie with none today has its summary and a link to the next date', async ({
    page,
    request,
  }) => {
    const movies = await listedMovies(request);
    const listing = movies.find(({ screeningsToday }) => screeningsToday === 0);
    if (!listing) throw new Error('expected a movie not showing today');

    await page.goto(moviePath(listing.movie.id));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(listing.movie.title);
    await expect(page.getByText(/Artimiausias seansas: .*\. Kur: /)).toBeVisible();
    await expect(page.getByRole('link', { name: /^Artimiausi seansai/ })).toHaveAttribute(
      'href',
      new RegExp(`\\?date=${listing.firstDate}$`),
    );
  });

  test('the list has a plain link to every movie', async ({ page, request }) => {
    const movies = await listedMovies(request);

    await page.goto('/lt/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'lt');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    const links = await page.getByRole('main').getByRole('link').all();
    const hrefs = await Promise.all(links.map((link) => link.getAttribute('href')));
    const decoded = new Set(hrefs.map((href) => decodeURIComponent(href ?? '')));
    for (const { movie } of movies) expect(decoded).toContain(`/lt/movie/${movie.id}`);
  });

  test('the English version is in English', async ({ page }) => {
    await page.goto('/en/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Now showing');
    expect(await page.title()).toBe('Cinema screenings across Lithuania – Seansai');
  });

  test('a movie whose address has non-ASCII letters has its page', async ({ page, request }) => {
    const movies = await listedMovies(request);
    const listing = movies.find(({ movie }) => /[^\p{ASCII}]/u.test(movie.id));
    test.skip(!listing, 'the fixture data has no such movie');
    if (!listing) return;

    const response = await page.goto(moviePath(listing.movie.id));

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(listing.movie.title);
  });
});

test.describe('link previews', () => {
  test.use({ javaScriptEnabled: false });

  const content = (page: Page, tag: string) => page.locator(`meta[${tag}]`).getAttribute('content');

  async function expectEveryTag(page: Page, path: string, locale: string) {
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      await page.title(),
    );
    expect(await content(page, 'property="og:description"')).toBe(
      await content(page, 'name="description"'),
    );
    expect(await content(page, 'property="og:url"')).toBe(`${SITE}${path}`);
    expect(await content(page, 'property="og:locale"')).toBe(locale);
    expect(await content(page, 'name="twitter:card"')).toBe('summary_large_image');
    await expect(page.locator('link[rel="icon"]').first()).toBeAttached();
  }

  test('the list page has every tag, with the general image', async ({ page }) => {
    await page.goto('/lt/');

    await expectEveryTag(page, '/lt/', 'lt_LT');
    expect(await content(page, 'property="og:type"')).toBe('website');
    expect(await content(page, 'property="og:image"')).toBe(`${SITE}/og-default.png`);
    expect(await content(page, 'property="og:image:alt"')).toBe('Seansai');
  });

  test('a movie with a poster has every tag, with its poster', async ({ page, request }) => {
    const movies = await listedMovies(request);
    const listing = movies.find(({ movie }) => movie.posterUrl !== null);
    if (!listing) throw new Error('expected a movie with a poster');
    const path = moviePath(listing.movie.id).replace('/lt/', '/en/');

    await page.goto(path);

    await expectEveryTag(page, path, 'en_GB');
    expect(await content(page, 'property="og:type"')).toBe('video.movie');
    expect(await content(page, 'property="og:image"')).toBe(listing.movie.posterUrl);
    expect(await content(page, 'property="og:image:alt"')).toBe(listing.movie.title);
  });

  test('a movie without a poster uses the general image', async ({ page, request }) => {
    const movies = await listedMovies(request);
    const listing = movies.find(({ movie }) => movie.posterUrl === null);
    if (!listing) throw new Error('expected a movie without a poster');

    await page.goto(moviePath(listing.movie.id));

    expect(await content(page, 'property="og:image"')).toBe(`${SITE}/og-default.png`);
    expect(await content(page, 'property="og:image:alt"')).toBe('Seansai');
  });

  test('the site icon and the general image answer', async ({ page, request }) => {
    await page.goto('/lt/');
    const icons = page.locator('link[rel="icon"]');
    await expect(icons).toHaveCount(2);
    await expect(icons.nth(0)).toHaveAttribute('href', '/favicon.svg');
    await expect(icons.nth(1)).toHaveAttribute('href', '/favicon.png');

    for (const path of ['/favicon.svg', '/favicon.png', '/og-default.png']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['content-type'], path).toMatch(/^image\//);
    }
  });
});

test.describe('city pages', () => {
  test.describe('without scripts', () => {
    test.use({ javaScriptEnabled: false });

    test('a city page names the city and lists only its movies', async ({ page, request }) => {
      await page.goto('/lt/city/kaunas');
      await expect(page).toHaveTitle('Kino seansai Kaune');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kino seansai Kaune');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        `${SITE}/lt/city/kaunas`,
      );

      const kaunas = await listedMovies(request, 'kaunas');
      const all = await listedMovies(request);
      const links = page.locator('main a[href*="/movie/"]');
      await expect(links).toHaveCount(kaunas.length);
      expect(kaunas.length).toBeLessThan(all.length);
    });

    test('the general list has a plain link to each city page', async ({ page, request }) => {
      await page.goto('/en/');
      const cities = CitiesResponseSchema.parse(
        await (await request.get('/api/v1/cities?lang=en')).json(),
      ).cities.filter((city) => city.hasMovies);
      const nav = page.getByRole('navigation', { name: 'Browse by city' });
      for (const { id, name } of cities) {
        await expect(nav.getByRole('link', { name })).toHaveAttribute('href', `/en/city/${id}`);
      }
    });

    test('an unknown city answers 404', async ({ page }) => {
      const response = await page.goto('/lt/city/riga');
      expect(response?.status()).toBe(404);
    });
  });

  test.describe('in a browser', () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(FIXTURE_INSTANT);
    });

    test('isn’t asked for a city, and opening a movie shows that city', async ({ page }) => {
      const consoleProblems: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleProblems.push(message.text());
      });

      await page.goto('/en/city/kaunas');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Cinema screenings in Kaunas',
      );
      await expect(page.getByRole('region', { name: 'City' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Change city: Kaunas' })).toBeVisible();
      await expectNoAccessibilityViolations(page);

      const saved = () => page.evaluate("window.localStorage.getItem('seansai.city')");
      await expect.poll(saved).toBe('kaunas');

      const screenings = page.waitForRequest(
        (request) => request.url().includes('/screenings') && request.url().includes('city=kaunas'),
      );
      await page.locator('main a[href*="/movie/"]').first().click();
      await screenings;
      await expect(page.getByRole('button', { name: 'Change city: Kaunas' })).toBeVisible();
      expect(consoleProblems).toEqual([]);
    });

    test('switching city goes to that city’s page, or to the list', async ({ page }) => {
      await page.goto('/en/city/kaunas');

      await page.getByRole('button', { name: 'Change city: Kaunas' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /Vilnius/ })
        .click();
      await expect(page).toHaveURL(/\/en\/city\/vilnius$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Cinema screenings in Vilnius',
      );

      await page.getByRole('button', { name: 'Change city: Vilnius' }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /All of Lithuania/ })
        .click();
      await expect(page).toHaveURL(/\/en\/$/);
      await expect(
        page.getByRole('button', { name: 'Change city: All of Lithuania' }),
      ).toBeVisible();
    });

    test('an unknown city shows the not-found page', async ({ page }) => {
      await page.goto('/en/city/riga');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    });
  });
});

test.describe('what search engines are told', () => {
  async function sitemapAddresses(request: APIRequestContext) {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    return [...(await response.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => {
      const address = match[1];
      if (!address?.startsWith(SITE))
        throw new Error(`Not on the public address: ${String(address)}`);
      return address.slice(SITE.length);
    });
  }

  test('every address in the site map answers directly', async ({ request }) => {
    const paths = await sitemapAddresses(request);
    const movies = await listedMovies(request);
    const cities = CitiesResponseSchema.parse(
      await (await request.get('/api/v1/cities')).json(),
    ).cities.filter((city) => city.hasMovies);
    expect(paths).toHaveLength(2 * (movies.length + cities.length + 1));

    for (const path of paths) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
      expect(await response.text(), path).toContain(
        `<link rel="canonical" href="${SITE}${path}" />`,
      );
    }
  });

  test('robots.txt names the site map', async ({ request }) => {
    const response = await request.get('/robots.txt');

    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  test.describe('without scripts', () => {
    test.use({ javaScriptEnabled: false });

    test('each page names its preferred address and every language version', async ({
      page,
      request,
    }) => {
      const movies = await listedMovies(request);
      const id = encodeURIComponent(movies[0]?.movie.id ?? '');

      for (const [lang, rest] of [
        ['lt', ''],
        ['en', ''],
        ['lt', `movie/${id}`],
        ['en', `movie/${id}`],
      ] as const) {
        await page.goto(`/${lang}/${rest}`);

        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
          'href',
          `${SITE}/${lang}/${rest}`,
        );
        const language = (hreflang: string) =>
          page.locator(`link[rel="alternate"][hreflang="${hreflang}"]`);
        await expect(language('lt')).toHaveAttribute('href', `${SITE}/lt/${rest}`);
        await expect(language('en')).toHaveAttribute('href', `${SITE}/en/${rest}`);
        await expect(language('x-default')).toHaveAttribute('href', `${SITE}/lt/${rest}`);
      }
    });
  });

  test('an unknown address answers 404, and a person sees the app’s not-found page', async ({
    page,
  }) => {
    const response = await page.goto('/lt/nonexistent/page');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Puslapis nerastas');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });

  test('an unknown movie answers 404, and a person sees the app’s not-found page', async ({
    page,
  }) => {
    const response = await page.goto('/lt/movie/no-such-movie-2026');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Filmas nerastas');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });

  test('a movie newer than the snapshot still opens, and is no longer marked noindex', async ({
    page,
    request,
  }) => {
    const movies = await listedMovies(request);
    const listing = movies[0];
    if (!listing) throw new Error('expected a movie');
    // As if this movie's page weren't in the snapshot yet: the host answers with 404.html.
    await page.route(`**${moviePath(listing.movie.id)}`, async (route) => {
      const notFound = await route.fetch({ url: new URL('/404.html', route.request().url()).href });
      await route.fulfill({ response: notFound, status: 404 });
    });

    await page.goto(moviePath(listing.movie.id));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(listing.movie.title);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `${SITE}${moviePath(listing.movie.id)}`,
    );
  });

  test('an address with options names the plain address', async ({ page, request }) => {
    const movies = await listedMovies(request);
    const path = moviePath(movies[0]?.movie.id ?? '');

    await page.goto(`${path}?date=2026-10-31`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE}${path}`);

    await page.goto('/lt/?city=all');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE}/lt/`);
  });
});

/** Adds the production CSP, which the preview server doesn't send, so a violation shows up. */
async function serveWithProductionCsp(context: BrowserContext) {
  const vercelJson = JSON.parse(
    readFileSync(new URL('../../../../vercel.json', import.meta.url), 'utf8'),
  ) as {
    services: { web: { headers: Array<{ headers: Array<{ key: string; value: string }> }> } };
  };
  const policy = vercelJson.services.web.headers
    .flatMap(({ headers }) => headers)
    .find(({ key }) => key.toLowerCase() === 'content-security-policy')?.value;
  if (!policy) throw new Error('expected vercel.json to set a Content-Security-Policy');

  await context.route(
    (url) =>
      url.hostname === 'localhost' &&
      !url.pathname.includes('.') &&
      !url.pathname.startsWith('/api/'),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': policy },
      });
    },
  );
}

/** Everything the browser complains about: hydration mismatches and CSP violations end up here. */
function complaints(page: Page): string[] {
  const messages: string[] = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) messages.push(message.text());
  });
  page.on('pageerror', (error) => messages.push(error.message));
  return messages;
}

/** Holds the app's own scripts back, to see what a visitor has before they run. */
async function holdScripts(page: Page) {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/assets/*.js', async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

const dateAfterFixture = (days: number) =>
  new Date(FIXTURE_INSTANT.getTime() + days * 24 * 60 * 60 * 1000);

test.describe('in a browser', () => {
  test.beforeEach(async ({ context, page }) => {
    await serveWithProductionCsp(context);
    await page.clock.setFixedTime(FIXTURE_INSTANT);
  });

  test('a first visit has its content before any script, then the app takes over', async ({
    page,
    request,
  }) => {
    const messages = complaints(page);
    const release = await holdScripts(page);

    await page.goto('/lt/', { waitUntil: 'commit' });

    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dabar rodomi filmai');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    release();

    // The app has taken over when its buttons work, which may take a moment after the release.
    const choice = page.getByRole('region', { name: 'Miestas' });
    await expect(async () => {
      await choice.getByRole('button', { name: 'Palikti visą Lietuvą' }).click({ timeout: 1000 });
      await expect(choice).toBeHidden({ timeout: 500 });
    }).toPass();
    await expect(cards).toHaveCount((await listedMovies(request)).length);
    expect(messages).toEqual([]);
  });

  test('a first visit to a movie takes over quietly, with nothing covering or taking focus', async ({
    page,
    request,
  }) => {
    const messages = complaints(page);
    const movies = await listedMovies(request);
    const listing = movies.find(({ screeningsToday }) => screeningsToday > 0);
    if (!listing) throw new Error('expected a movie showing today');

    await page.goto(moviePath(listing.movie.id));

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(listing.movie.title);
    await expect(page.getByRole('region', { name: 'Miestas' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('body')).toBeFocused();
    // The date picker works, so the app has taken over.
    const nextDate = page
      .getByRole('toolbar', { name: 'Pasirinkite datą' })
      .getByRole('button')
      .nth(1);
    await nextDate.click();
    await expect(page).toHaveURL(/\?date=/);
    await expect(nextDate).toHaveAttribute('aria-pressed', 'true');
    await expectNoAccessibilityViolations(page);
    expect(messages).toEqual([]);
  });

  test('with a remembered city, all of Lithuania is never visible', async ({
    context,
    page,
    request,
  }) => {
    const messages = complaints(page);
    await context.addInitScript({
      content: "window.localStorage.setItem('seansai.city', 'kaunas')",
    });
    const release = await holdScripts(page);

    await page.goto('/lt/', { waitUntil: 'commit' });

    await expect(page.locator('html')).toHaveAttribute('data-boot', 'client');
    await expect(page.getByRole('heading', { level: 1 })).toBeHidden();
    await expect(page.getByRole('article').first()).toBeHidden();

    release();

    await expect(page.getByRole('button', { name: 'Keisti miestą: Kaunas' })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(
      (await listedMovies(request, 'kaunas')).length,
    );
    await expect(page.locator('html')).not.toHaveAttribute('data-boot', 'client');
    await expect(page.getByRole('region', { name: 'Miestas' })).toHaveCount(0);
    expect(messages).toEqual([]);
  });

  test('a link with options never shows the plain snapshot, and shows what it asks for', async ({
    page,
    request,
  }) => {
    const movies = await listedMovies(request);
    const listing = movies.find(({ screeningsToday }) => screeningsToday > 0);
    if (!listing) throw new Error('expected a movie showing today');
    const messages = complaints(page);
    const release = await holdScripts(page);

    await page.goto(`${moviePath(listing.movie.id)}?date=2026-10-31`, { waitUntil: 'commit' });

    await expect(page.locator('html')).toHaveAttribute('data-boot', 'client');
    await expect(page.getByRole('heading', { level: 1 })).toBeHidden();

    release();

    await expect(page.getByRole('heading', { level: 2, name: /spalio 31/ })).toBeVisible();
    expect(messages).toEqual([]);
  });

  test('a link with a city shows that city', async ({ page, request }) => {
    const messages = complaints(page);

    await page.goto('/lt/?city=kaunas');

    await expect(page.getByRole('button', { name: 'Keisti miestą: Kaunas' })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(
      (await listedMovies(request, 'kaunas')).length,
    );
    expect(messages).toEqual([]);
  });

  test('a filter link applies its filter', async ({ page, request }) => {
    const movies = await listedMovies(request);
    const listing = movies.find(({ screeningsToday }) => screeningsToday > 0);
    if (!listing) throw new Error('expected a movie showing today');
    const messages = complaints(page);

    await page.goto(`${moviePath(listing.movie.id)}?format=other`);

    await expect(page.getByText(/^Rodoma \d+ iš \d+$/)).toBeVisible();
    expect(messages).toEqual([]);
  });

  test('a snapshot from an earlier day is replaced, not shown', async ({ page }) => {
    await page.clock.setFixedTime(dateAfterFixture(1));
    const messages = complaints(page);
    const release = await holdScripts(page);

    await page.goto('/lt/', { waitUntil: 'commit' });

    await expect(page.locator('html')).toHaveAttribute('data-boot', 'client');
    await expect(page.getByRole('heading', { level: 1 })).toBeHidden();

    release();

    await expect(page.getByRole('article').first()).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-boot', 'client');
    expect(messages).toEqual([]);
  });

  test('a failed background request leaves the content in place', async ({ page }) => {
    let failedRequests = 0;
    await page.route('**/api/v1/**', async (route) => {
      if (route.request().url().includes('/movies?')) failedRequests++;
      await route.abort();
    });

    await page.goto('/lt/');

    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible();
    // The list's first try and its two retries, after which the request has finally failed.
    await expect.poll(() => failedRequests, { timeout: 15_000 }).toBe(3);
    await page.waitForTimeout(300);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(cards.first()).toBeVisible();
  });

  test('once answered, the choice of city doesn’t come back', async ({ page }) => {
    await page.goto('/lt/');
    await page
      .getByRole('region', { name: 'Miestas' })
      .getByRole('button', { name: 'Palikti visą Lietuvą' })
      .click();

    await page.reload();

    await expect(page.getByRole('article').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Miestas' })).toHaveCount(0);
  });
});
