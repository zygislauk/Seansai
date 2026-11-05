// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildSnapshot, type Renderer } from '../../scripts/prerender.ts';

const API = 'http://api.test/api/v1';
const BUILD_TIME = new Date('2026-11-03T06:00:00Z');
const TODAY = '2026-11-03';

const TEMPLATE = `<!doctype html>
<html lang="lt">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Default" />
    <title>Seansai</title>
    <script src="/boot-gate.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const summary = (id: string, title: string) => ({
  id,
  title,
  originalTitle: null,
  englishTitle: null,
  posterUrl: null,
  ageRating: null,
  durationMinutes: null,
});

const freshness = { updatedAt: '2026-11-03T08:00:00+02:00', staleCinemas: [] };

const SITE = 'https://seansai.lt';
/** For pages whose addresses a test doesn't look at. */
const noLinks = {
  canonical: null,
  alternates: [],
  image: `${SITE}/og-default.png`,
  imageAlt: 'Seansai',
  type: 'website',
};
/** What `pageHead` says about the page at this address. */
const links = (path: string) => ({
  image: `${SITE}/og-default.png`,
  imageAlt: 'Seansai',
  type: 'website',
  canonical: `${SITE}${encodeURI(path)}`,
  alternates: [
    { hreflang: 'lt', href: `${SITE}${encodeURI(path.replace(/^\/\w\w/, '/lt'))}` },
    { hreflang: 'en', href: `${SITE}${encodeURI(path.replace(/^\/\w\w/, '/en'))}` },
    { hreflang: 'x-default', href: `${SITE}${encodeURI(path.replace(/^\/\w\w/, '/lt'))}` },
  ],
});

/** A small fake of the API with two movies, one of them with a non-ASCII id. */
function apiAnswers(url: URL): unknown {
  const path = decodeURIComponent(url.pathname.replace('/api/v1', ''));
  if (path === '/cities') {
    return {
      cities: [
        { id: 'vilnius', name: 'Vilnius', cinemaCount: 1, hasMovies: true },
        { id: 'kaunas', name: 'Kaunas', cinemaCount: 1, hasMovies: false },
      ],
    };
  }
  if (path === '/movies') {
    return {
      movies: [
        { movie: summary('a-2026', 'A'), screeningsToday: 1, firstDate: TODAY },
        { movie: summary('weiß-2026', 'Weiß'), screeningsToday: 0, firstDate: TODAY },
      ],
      freshness,
    };
  }
  const movie = /^\/movies\/([^/]+)(\/screenings)?$/.exec(path);
  if (!movie?.[1]) throw new Error(`Unexpected request: ${path}`);
  return movie[2]
    ? { date: TODAY, screenings: [], nextDateWithScreenings: null, freshness }
    : {
        movie: { ...summary(movie[1], movie[1]), genres: [], year: null },
        screeningDates: [TODAY],
        availableDates: [TODAY],
        showingAt: [],
      };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Answer = (url: URL) => Response;

let answer: Answer;
let requests: URL[];
let outDir: string;
let warnings: string[];

/** Renders each page with its own title and description, from the data it was given. */
const renderer: Renderer = {
  renderListPage: (lang, data) =>
    Promise.resolve({
      path: `/${lang}/`,
      head: {
        title: `List ${lang}`,
        description: `All ${lang}`,
        robots: null,
        ...links(`/${lang}/`),
      },
      markup: `<h1>List</h1>${data.movies.movies.map(({ movie }) => movie.title).join()}`,
      initialData: { lang },
    }),
  renderCityPage: (lang, data) =>
    Promise.resolve({
      path: `/${lang}/city/${data.city.id}`,
      head: {
        title: `${data.city.name} ${lang}`,
        description: `In ${data.city.name} ${lang}`,
        robots: null,
        ...links(`/${lang}/city/${data.city.id}`),
      },
      markup: `<h1>${data.city.name}</h1>${String(data.movies.movies.length)} movies`,
      initialData: { lang, city: data.city.id },
    }),
  renderMoviePage: (lang, data) =>
    Promise.resolve({
      path: `/${lang}/movie/${data.detail.movie.id}`,
      head: {
        title: `${data.detail.movie.id} ${lang}`,
        description: `About ${data.detail.movie.id} ${lang}`,
        robots: null,
        ...links(`/${lang}/movie/${data.detail.movie.id}`),
      },
      markup: `<h1>${data.detail.movie.title}</h1>`,
      initialData: { lang, id: data.detail.movie.id },
    }),
};

const build = (overrides: Partial<Renderer> = {}) =>
  buildSnapshot({
    apiUrl: API,
    outDir,
    renderer: { ...renderer, ...overrides },
    buildTime: BUILD_TIME,
    retryDelayMs: 0,
    log: {
      info: () => undefined,
      warn: (message) => {
        warnings.push(message);
      },
    },
  });

const page = (path: string) => readFileSync(join(outDir, path, 'index.html'), 'utf8');
const outputFiles = () => readdirSync(outDir, { recursive: true });

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'seansai-snapshot-'));
  writeFileSync(join(outDir, 'index.html'), TEMPLATE);
  warnings = [];
  requests = [];
  answer = (url) => json(apiAnswers(url));
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input);
      requests.push(url);
      return Promise.resolve(answer(url));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(outDir, { recursive: true, force: true });
});

describe('a good build', () => {
  test('writes the list and every movie in both languages', async () => {
    await build();

    for (const path of ['lt', 'en', 'lt/movie/a-2026', 'en/movie/a-2026', 'lt/movie/weiß-2026']) {
      expect(existsSync(join(outDir, path, 'index.html'))).toBe(true);
    }
  });

  test('writes each page’s language, head, date, markup and data into the template', async () => {
    await build();

    const html = page('en/movie/a-2026');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>a-2026 en</title>');
    expect(html).toContain('<meta name="description" content="About a-2026 en" />');
    expect(html).toContain(`<meta name="snapshot-date" content="${TODAY}" />`);
    expect(html).toContain('<div id="root"><h1>a-2026</h1></div>');
    expect(html).toContain('<script id="initial-data" type="application/json">{"lang":"en"');
  });

  test('puts the date before the boot gate, which reads it as the head is parsed', async () => {
    await build();

    const html = page('lt');
    expect(html.indexOf('snapshot-date')).toBeLessThan(html.indexOf('boot-gate.js'));
  });

  test('keeps text from cinema websites from breaking the page', async () => {
    const hostile = '</title><script>alert(1)</script>"$&';
    await build({
      renderMoviePage: renderer.renderMoviePage,
      renderListPage: (lang) =>
        Promise.resolve({
          path: `/${lang}/`,
          head: {
            title: `${hostile}${lang}`,
            description: `${hostile}${lang}`,
            robots: null,
            ...noLinks,
          },
          markup: '<h1>List</h1>',
          initialData: { title: hostile },
        }),
    });

    const html = page('lt');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain(
      '&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;$&amp;lt</title>',
    );
    const data = /id="initial-data"[^>]*>(.*?)<\/script>/s.exec(html)?.[1] ?? '';
    expect(JSON.parse(data)).toEqual({ title: hostile });
  });

  test('marks a page that asks not to be listed', async () => {
    await build({
      renderListPage: (lang) =>
        Promise.resolve({
          path: `/${lang}/`,
          head: { title: lang, description: lang, robots: 'noindex', ...noLinks },
          markup: '<h1>List</h1>',
          initialData: {},
        }),
    });

    expect(page('lt')).toContain('<meta name="robots" content="noindex" />');
  });

  test('writes each page’s preferred address and language links', async () => {
    await build();

    const html = page('en/movie/weiß-2026');
    const address = 'movie/wei%C3%9F-2026';
    expect(html).toContain(`<link rel="canonical" href="${SITE}/en/${address}" />`);
    expect(html).toContain(`<link rel="alternate" hreflang="lt" href="${SITE}/lt/${address}" />`);
    expect(html).toContain(`<link rel="alternate" hreflang="en" href="${SITE}/en/${address}" />`);
    expect(html).toContain(
      `<link rel="alternate" hreflang="x-default" href="${SITE}/lt/${address}" />`,
    );
  });

  test('writes what a shared link’s preview shows, in the page’s language', async () => {
    await build({
      renderListPage: (lang) =>
        Promise.resolve({
          path: `/${lang}/`,
          head: {
            title: `Title ${lang}`,
            description: `About ${lang}`,
            robots: null,
            ...links(`/${lang}/`),
            image: 'https://cinema.example/poster.jpg',
            imageAlt: `Poster ${lang}`,
            type: 'video.movie',
          },
          markup: '<h1>List</h1>',
          initialData: {},
        }),
    });

    const html = page('en');
    expect(html).toContain('<meta property="og:title" content="Title en" />');
    expect(html).toContain('<meta property="og:description" content="About en" />');
    expect(html).toContain(
      '<meta property="og:image" content="https://cinema.example/poster.jpg" />',
    );
    expect(html).toContain('<meta property="og:image:alt" content="Poster en" />');
    expect(html).toContain(`<meta property="og:url" content="${SITE}/en/" />`);
    expect(html).toContain('<meta property="og:type" content="video.movie" />');
    expect(html).toContain('<meta property="og:locale" content="en_GB" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(page('lt')).toContain('<meta property="og:locale" content="lt_LT" />');
  });

  test('keeps text from cinema websites from breaking out of a preview tag', async () => {
    const quoted = '"><script>alert(1)</script>';
    await build({
      renderListPage: (lang) =>
        Promise.resolve({
          path: `/${lang}/`,
          head: {
            title: quoted,
            description: quoted,
            robots: null,
            ...links(`/${lang}/`),
            image: `https://cinema.example/${quoted}`,
            imageAlt: quoted,
          },
          markup: '<h1>List</h1>',
          initialData: {},
        }),
    });

    expect(page('lt')).not.toContain('<script>alert(1)');
  });

  test('404.html has no preview of any one page', async () => {
    await build();

    expect(readFileSync(join(outDir, '404.html'), 'utf8')).not.toContain('og:');
  });

  test('keeps an address from breaking out of its attribute', async () => {
    await build({
      renderListPage: (lang) =>
        Promise.resolve({
          path: `/${lang}/`,
          head: {
            title: lang,
            description: lang,
            robots: null,
            ...noLinks,
            canonical: `${SITE}/"><script>`,
            alternates: [{ hreflang: 'lt', href: `${SITE}/"><script>` }],
          },
          markup: '<h1>List</h1>',
          initialData: {},
        }),
    });

    expect(page('lt')).not.toContain('"><script>');
  });

  test('the site map lists exactly the plain pages, in both languages', async () => {
    await build();

    const sitemap = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const addresses = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
    expect(addresses.toSorted()).toEqual(
      [
        `${SITE}/lt/`,
        `${SITE}/en/`,
        `${SITE}/lt/city/vilnius`,
        `${SITE}/en/city/vilnius`,
        `${SITE}/lt/movie/a-2026`,
        `${SITE}/en/movie/a-2026`,
        `${SITE}/lt/movie/wei%C3%9F-2026`,
        `${SITE}/en/movie/wei%C3%9F-2026`,
      ].toSorted(),
    );
    expect(sitemap.match(/<lastmod>2026-11-03<\/lastmod>/g)).toHaveLength(addresses.length);
  });

  test('the site map leaves out a page with no preferred address', async () => {
    await build({
      renderListPage: (lang) =>
        Promise.resolve({
          path: `/${lang}/`,
          head: { title: lang, description: lang, robots: 'noindex', ...noLinks },
          markup: '<h1>List</h1>',
          initialData: {},
        }),
    });

    expect(readFileSync(join(outDir, 'sitemap.xml'), 'utf8')).not.toContain(
      `<loc>${SITE}/lt/</loc>`,
    );
  });

  test('robots.txt allows everything and names the site map, exactly', async () => {
    await build();

    expect(readFileSync(join(outDir, 'robots.txt'), 'utf8')).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
    );
  });

  test('404.html is the app shell, not to be listed, with nothing from a page', async () => {
    await build();

    const html = readFileSync(join(outDir, '404.html'), 'utf8');
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('boot-gate.js');
    expect(html).not.toContain('initial-data');
    // With no date, the boot gate treats whatever this address turns out to be as not a snapshot.
    expect(html).not.toContain('snapshot-date');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('rel="alternate"');
  });

  test('reads every answer past the CDN’s cache, with a percent-encoded address', async () => {
    await build();

    expect(requests.length).toBeGreaterThan(0);
    for (const url of requests) {
      expect(url.searchParams.get('snapshot')).toBe(BUILD_TIME.toISOString());
    }
    expect(requests.map((url) => url.pathname)).toContain(
      `/api/v1/movies/${encodeURIComponent('weiß-2026')}`,
    );
  });

  test('asks for city names in each language', async () => {
    await build();

    const detail = requests.filter((url) => url.pathname === '/api/v1/movies/a-2026');
    expect(detail.map((url) => url.searchParams.get('lang')).toSorted()).toEqual(['en', 'lt']);
    expect(detail.every((url) => url.searchParams.get('city') === 'all')).toBe(true);
  });

  test('makes at most 8 requests at once', async () => {
    let running = 0;
    let most = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running--;
        return json(manyMovies(new URL(input)));
      }),
    );

    await build();

    expect(most).toBe(8);
  });

  test('retries a request twice before giving up', async () => {
    let failures = 2;
    answer = (url) => {
      if (url.pathname.endsWith('/movies') && failures-- > 0) return json({}, 503);
      return json(apiAnswers(url));
    };

    await build();

    expect(existsSync(join(outDir, 'lt', 'index.html'))).toBe(true);
  });

  test('warns about pages sharing a title or description, naming them, without failing', async () => {
    await build({
      renderMoviePage: (lang, data) =>
        Promise.resolve({
          path: `/${lang}/movie/${data.detail.movie.id}`,
          head: {
            title: `Same ${lang}`,
            description: `Same text ${lang}`,
            robots: null,
            ...noLinks,
          },
          markup: '<h1>Movie</h1>',
          initialData: {},
        }),
    });

    expect(warnings).toContainEqual(expect.stringContaining('Same lt'));
    expect(warnings.join()).toContain('/lt/movie/a-2026');
    expect(warnings.join()).toContain('/lt/movie/weiß-2026');
    expect(warnings.join()).toContain('Same text lt');
    expect(existsSync(join(outDir, 'lt', 'index.html'))).toBe(true);
  });
});

/** Enough movies that the limit on requests matters. */
function manyMovies(url: URL): unknown {
  if (url.pathname.endsWith('/movies')) {
    return {
      movies: Array.from({ length: 30 }, (_, index) => ({
        movie: summary(`m${String(index)}`, `M${String(index)}`),
        screeningsToday: 1,
        firstDate: TODAY,
      })),
      freshness,
    };
  }
  return apiAnswers(url);
}

describe('city pages', () => {
  test('writes every city in both languages, from that city’s movies', async () => {
    await build();

    for (const lang of ['lt', 'en']) {
      expect(page(`${lang}/city/vilnius`)).toContain('<h1>Vilnius</h1>');
      expect(page(`${lang}/city/kaunas`)).toContain('<h1>Kaunas</h1>');
    }
    expect(requests.map((url) => url.search)).toContainEqual(
      expect.stringContaining('city=vilnius'),
    );
  });

  test('a city with no current movies gets a page, and the build doesn’t fail', async () => {
    const answerAll = answer;
    answer = (url) =>
      url.searchParams.get('city') === 'kaunas' && url.pathname.endsWith('/movies')
        ? json({ movies: [], freshness })
        : answerAll(url);

    await build();

    expect(page('lt/city/kaunas')).toContain('0 movies');
  });

  test('the site map has city pages with current movies, and no others', async () => {
    await build();

    const siteMap = readFileSync(join(outDir, 'sitemap.xml'), 'utf8');
    expect(siteMap).toContain('/lt/city/vilnius</loc>');
    expect(siteMap).toContain('/en/city/vilnius</loc>');
    expect(siteMap).not.toContain('/city/kaunas');
  });

  test('a failed city list fails the build', async () => {
    const answerAll = answer;
    answer = (url) => (url.searchParams.get('city') === 'vilnius' ? json({}, 500) : answerAll(url));

    await expect(build()).rejects.toThrow('/movies?city=vilnius');
    expect(outputFiles()).toEqual(['index.html']);
  });
});

describe('a build that fails writes nothing', () => {
  const expectFailure = async (message: RegExp, overrides: Partial<Renderer> = {}) => {
    const before = outputFiles();

    await expect(build(overrides)).rejects.toThrow(message);

    expect(outputFiles()).toEqual(before);
  };

  test('a request that still fails after its retries', async () => {
    answer = (url) => (url.pathname.endsWith('a-2026') ? json({}, 500) : json(apiAnswers(url)));

    await expectFailure(/a-2026/);
    expect(
      requests.filter(
        (url) => url.pathname.endsWith('a-2026') && url.searchParams.get('lang') === 'lt',
      ),
    ).toHaveLength(3);
  });

  test('a request that gets no answer at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expectFailure(/fetch failed/);
  });

  test('an answer that doesn’t match the shared schema', async () => {
    answer = (url) =>
      url.pathname.endsWith('/cities') ? json({ wrong: true }) : json(apiAnswers(url));

    await expectFailure(/cities/);
  });

  test('an empty general list', async () => {
    answer = (url) =>
      url.pathname.endsWith('/movies') ? json({ movies: [], freshness }) : json(apiAnswers(url));

    await expectFailure(/no movies/i);
  });

  test('a page with no heading', async () => {
    await expectFailure(/\/lt\/movie\/a-2026.*h1/i, {
      renderMoviePage: (lang, data) =>
        Promise.resolve({
          path: `/${lang}/movie/${data.detail.movie.id}`,
          head: { title: 'x', description: 'x', robots: null, ...noLinks },
          markup: '<p>No heading</p>',
          initialData: {},
        }),
    });
  });

  test('a page with two headings', async () => {
    await expectFailure(/h1/i, {
      renderListPage: (lang) =>
        Promise.resolve({
          path: `/${lang}/`,
          head: { title: lang, description: lang, robots: null, ...noLinks },
          markup: '<h1>One</h1><h1>Two</h1>',
          initialData: {},
        }),
    });
  });

  /** Random bytes barely compress, so this is about as large compressed as it looks. */
  const incompressible = (kilobytes: number) => randomBytes(kilobytes * 1000).toString('base64');

  test('a movie page over its 40 kB budget', async () => {
    await expectFailure(/\/lt\/movie\/a-2026.*40 kB/, {
      renderMoviePage: (lang, data) =>
        Promise.resolve({
          path: `/${lang}/movie/${data.detail.movie.id}`,
          head: {
            title: `${data.detail.movie.id}${lang}`,
            description: 'x',
            robots: null,
            ...noLinks,
          },
          markup: `<h1>${incompressible(50)}</h1>`,
          initialData: {},
        }),
    });
  });

  test('a list page over its 80 kB budget', async () => {
    await expectFailure(/\/lt\/.*80 kB/, {
      renderListPage: (lang) =>
        Promise.resolve({
          path: `/${lang}/`,
          head: { title: lang, description: lang, robots: null, ...noLinks },
          markup: `<h1>${incompressible(90)}</h1>`,
          initialData: {},
        }),
    });
  });

  test('a template that has changed shape', async () => {
    writeFileSync(join(outDir, 'index.html'), '<html></html>');

    await expectFailure(/template/i);
  });
});
