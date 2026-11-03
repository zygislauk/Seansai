/**
 * Writes the daily snapshot: every public page as a file with its content in the first response
 * (contracts/snapshot.md). Reads the public API, so a build needs no database credentials. A
 * problem fails the build, and the previous deployment stays live, so one bad answer can't publish
 * a site of 404s (research.md §3). Runs last in `npm run build`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  CitiesResponseSchema,
  MovieDetailResponseSchema,
  MoviesResponseSchema,
  ScreeningsResponseSchema,
  type CitiesResponse,
  type Lang,
  type MovieDetailResponse,
  type MoviesResponse,
  type ScreeningsResponse,
} from '@seansai/shared';
import type { z } from 'zod';
import { escapeHtml, serializeForScript } from '../src/lib/html-escape.ts';
import { SITE_URL } from '../src/lib/site.ts';
import { distDir } from './build-paths.ts';

const LANGS: readonly Lang[] = ['lt', 'en'];
const MAX_CONCURRENT_REQUESTS = 8;
const RETRIES = 2;
const MOVIE_BUDGET_BYTES = 40_000;
const LIST_BUDGET_BYTES = 80_000;

export type RenderedPage = {
  path: string;
  head: {
    title: string;
    description: string;
    robots: string | null;
    canonical: string | null;
    alternates: Array<{ hreflang: string; href: string }>;
  };
  markup: string;
  initialData: unknown;
};

/** `src/entry-prerender.tsx`, as built by `vite build --ssr`. */
export type Renderer = {
  renderListPage: (
    lang: Lang,
    data: { cities: CitiesResponse; movies: MoviesResponse },
  ) => Promise<RenderedPage>;
  renderMoviePage: (
    lang: Lang,
    data: { cities: CitiesResponse; detail: MovieDetailResponse; screenings: ScreeningsResponse },
  ) => Promise<RenderedPage>;
};

type SnapshotOptions = {
  apiUrl: string;
  outDir: string;
  renderer: Renderer;
  buildTime: Date;
  retryDelayMs?: number;
  log?: { info: (message: string) => void; warn: (message: string) => void };
};

/** Runs at most `limit` of the given tasks at once. */
function createLimiter(limit: number) {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}

function createReader({ apiUrl, buildTime, retryDelayMs = 1000 }: SnapshotOptions) {
  const limit = createLimiter(MAX_CONCURRENT_REQUESTS);

  /** `snapshot` makes each build's addresses new, so it doesn't read what the CDN cached earlier. */
  const fetchJson = async (path: string): Promise<unknown> => {
    const separator = path.includes('?') ? '&' : '?';
    const url = `${apiUrl}${path}${separator}snapshot=${buildTime.toISOString()}`;
    let lastProblem = '';
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      try {
        const response = await fetch(url);
        if (response.ok) return await response.json();
        lastProblem = `HTTP ${String(response.status)}`;
      } catch (error) {
        lastProblem = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`${path} failed after ${String(RETRIES)} retries: ${lastProblem}`);
  };

  return async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
    const parsed = schema.safeParse(await limit(() => fetchJson(path)));
    if (!parsed.success) throw new Error(`${path} answered unexpectedly: ${parsed.error.message}`);
    return parsed.data;
  };
}

/** Replaces one piece of the built index.html. Literally, as cinema text can contain `$&`. */
function fill(html: string, piece: string | RegExp, replacement: string): string {
  if (html.search(piece) === -1) throw new Error(`The index.html template has no ${String(piece)}`);
  return html.replace(piece, () => replacement);
}

const robotsMeta = (robots: string) =>
  `\n    <meta name="robots" content="${escapeHtml(robots)}" />`;

function addressLinks({ canonical, alternates }: RenderedPage['head']): string {
  const links = alternates.map(
    ({ hreflang, href }) =>
      `<link rel="alternate" hreflang="${hreflang}" href="${escapeHtml(href)}" />`,
  );
  if (canonical !== null) links.unshift(`<link rel="canonical" href="${escapeHtml(canonical)}" />`);
  return links.map((link) => `\n    ${link}`).join('');
}

function pageHtml(template: string, lang: Lang, page: RenderedPage, snapshotDate: string): string {
  const robots = page.head.robots === null ? '' : robotsMeta(page.head.robots);
  let html = template;
  html = fill(html, '<html lang="lt">', `<html lang="${lang}">`);
  // In the head before boot-gate.js, which reads it while the head is being parsed.
  html = fill(
    html,
    '<meta charset="UTF-8" />',
    `<meta charset="UTF-8" />\n    <meta name="snapshot-date" content="${snapshotDate}" />${robots}`,
  );
  html = fill(
    html,
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${escapeHtml(page.head.description)}" />${addressLinks(page.head)}`,
  );
  html = fill(html, '<title>Seansai</title>', `<title>${escapeHtml(page.head.title)}</title>`);
  return fill(
    html,
    '<div id="root"></div>',
    `<div id="root">${page.markup}</div>\n    <script id="initial-data" type="application/json">${serializeForScript(page.initialData)}</script>`,
  );
}

/**
 * What the host answers an unknown address with. It boots the app, which shows its not-found page,
 * or the real page for a movie newer than the snapshot, and then removes the `noindex`.
 */
function notFoundHtml(template: string): string {
  return fill(
    template,
    '<meta charset="UTF-8" />',
    `<meta charset="UTF-8" />${robotsMeta('noindex')}`,
  );
}

function siteMapXml(pages: readonly RenderedPage[], snapshotDate: string): string {
  const entries = pages.flatMap(({ head: { canonical } }) =>
    canonical === null
      ? []
      : `  <url><loc>${escapeHtml(canonical)}</loc><lastmod>${snapshotDate}</lastmod></url>\n`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('')}</urlset>
`;
}

/** The API isn't blocked, as crawlers need it to render pages (research.md §7). */
const ROBOTS_TXT = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;

function checkPage(page: RenderedPage, html: string, budgetBytes: number): void {
  const headings = page.markup.match(/<h1[\s>]/g)?.length ?? 0;
  if (headings !== 1) {
    throw new Error(`${page.path} has ${String(headings)} <h1> headings instead of one`);
  }
  const size = gzipSync(html).length;
  if (size > budgetBytes) {
    throw new Error(
      `${page.path} is ${(size / 1000).toFixed(1)} kB compressed, over its ${String(budgetBytes / 1000)} kB budget`,
    );
  }
}

/** Duplicates come from split movie records. The fix is merging them, so they don't stop a build. */
function warnAboutDuplicates(pages: readonly RenderedPage[], warn: (message: string) => void) {
  for (const field of ['title', 'description'] as const) {
    const paths = new Map<string, string[]>();
    for (const page of pages) {
      const value = page.head[field];
      paths.set(value, [...(paths.get(value) ?? []), page.path]);
    }
    for (const [value, sharing] of paths) {
      if (sharing.length > 1) warn(`Pages share the ${field} "${value}": ${sharing.join(', ')}`);
    }
  }
}

export async function buildSnapshot(options: SnapshotOptions): Promise<void> {
  const { outDir, renderer, log = console } = options;
  const read = createReader(options);
  const template = readFileSync(join(outDir, 'index.html'), 'utf8');

  const moviesResponse = await read('/movies?city=all', MoviesResponseSchema);
  const { movies } = moviesResponse;
  if (movies.length === 0) throw new Error('The general movie list has no movies');

  const [ltCities, enCities] = await Promise.all(
    LANGS.map((lang) => read(`/cities?lang=${lang}`, CitiesResponseSchema)),
  );
  if (!ltCities || !enCities) throw new Error('Could not read the cities');
  const citiesFor = (lang: Lang) => (lang === 'lt' ? ltCities : enCities);

  const movieData = await Promise.all(
    movies.map(async ({ movie }) => {
      const path = `/movies/${encodeURIComponent(movie.id)}`;
      const [lt, en, screenings] = await Promise.all([
        read(`${path}?city=all&lang=lt`, MovieDetailResponseSchema),
        read(`${path}?city=all&lang=en`, MovieDetailResponseSchema),
        read(`${path}/screenings?city=all`, ScreeningsResponseSchema),
      ]);
      return { details: { lt, en }, screenings };
    }),
  );

  // "Today" comes from the API, so it matches the data, also when tests fix the API's clock.
  const snapshotDate = movieData[0]?.details.lt.availableDates[0];
  if (snapshotDate === undefined) throw new Error('The API gave no date for today');

  const pages: Array<{ page: RenderedPage; html: string }> = [];
  for (const lang of LANGS) {
    const list = await renderer.renderListPage(lang, {
      cities: citiesFor(lang),
      movies: moviesResponse,
    });
    const listHtml = pageHtml(template, lang, list, snapshotDate);
    checkPage(list, listHtml, LIST_BUDGET_BYTES);
    pages.push({ page: list, html: listHtml });

    for (const { details, screenings } of movieData) {
      const page = await renderer.renderMoviePage(lang, {
        cities: citiesFor(lang),
        detail: details[lang],
        screenings,
      });
      const html = pageHtml(template, lang, page, snapshotDate);
      checkPage(page, html, MOVIE_BUDGET_BYTES);
      pages.push({ page, html });
    }
  }

  const rendered = pages.map(({ page }) => page);
  warnAboutDuplicates(rendered, (message) => {
    log.warn(message);
  });
  const notFound = notFoundHtml(template);

  // Only now that every page has passed, so a failure leaves nothing behind.
  for (const { page, html } of pages) {
    const file = join(outDir, page.path, 'index.html');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  writeFileSync(join(outDir, '404.html'), notFound);
  writeFileSync(join(outDir, 'sitemap.xml'), siteMapXml(rendered, snapshotDate));
  writeFileSync(join(outDir, 'robots.txt'), ROBOTS_TXT);
  log.info(`Snapshot: wrote ${String(pages.length)} pages for ${snapshotDate}`);
}

async function main(): Promise<void> {
  const apiUrl =
    process.env.SNAPSHOT_API_URL ?? (process.env.VERCEL ? `${SITE_URL}/api/v1` : undefined);
  if (apiUrl === undefined) {
    console.log('Snapshot: skipped, as neither VERCEL nor SNAPSHOT_API_URL is set');
    return;
  }
  const rendererFile = join(`${distDir}-prerender`, 'entry-prerender.js');
  const renderer = (await import(pathToFileURL(rendererFile).href)) as Renderer;
  await buildSnapshot({ apiUrl, outDir: distDir, renderer, buildTime: new Date() });
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error('Snapshot failed, so the previous deployment stays live:', error);
    process.exit(1);
  });
}
