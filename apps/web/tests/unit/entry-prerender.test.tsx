// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { citiesQuery, movieQuery, moviesQuery, screeningsQuery } from '../../src/api/hooks.ts';
import { createQueryClient } from '../../src/app/providers.tsx';
import { renderListPage, renderMoviePage, renderPage } from '../../src/entry-prerender.tsx';
import {
  cities,
  diggerDetail,
  diggerScreenings,
  freshness,
  movies,
  TODAY,
} from '../helpers/mock-api.ts';

/** A cache holding what `prerender.ts` reads for a page, for all of Lithuania. */
function filledCache() {
  const queryClient = createQueryClient();
  queryClient.setQueryData(citiesQuery('lt').queryKey, cities);
  queryClient.setQueryData(moviesQuery('all').queryKey, movies);
  queryClient.setQueryData(movieQuery('digger-2026', 'all', 'lt').queryKey, diggerDetail);
  queryClient.setQueryData(movieQuery('digger-2026', 'all', 'en').queryKey, diggerDetail);
  queryClient.setQueryData(screeningsQuery('digger-2026', 'all', null).queryKey, {
    date: TODAY,
    screenings: diggerScreenings,
    nextDateWithScreenings: null,
    freshness,
  });
  return queryClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('renders the movie list with its movies and plain links, with no browser or API', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  const { markup } = await renderPage('/lt/', filledCache());

  expect(markup).toContain('Dabar rodomi filmai');
  expect(markup).toContain('Kasėjas');
  expect(markup).toContain('href="/lt/movie/digger-2026"');
  expect(fetch).not.toHaveBeenCalled();
});

test('renders a movie page, which comes from a lazy route, with its screenings', async () => {
  const { markup } = await renderPage('/en/movie/digger-2026', filledCache());

  expect(markup).toContain('Kasėjas');
  expect(markup).toContain('Apollo Akropolis');
  expect(markup).toContain('https://www.apollokinas.lt/websales/show/1');
});

test('returns what the browser needs to take over', async () => {
  const queryClient = filledCache();

  const { initialData } = await renderPage('/lt/', queryClient);

  expect(initialData.queryCache.queries.map((query) => query.queryKey)).toContainEqual([
    'movies',
    'all',
  ]);
  expect(Object.keys(initialData.loaderData).length).toBeGreaterThan(0);
  // So the browser asks for current data, whatever its clock says.
  for (const query of initialData.queryCache.queries) expect(query.state.dataUpdatedAt).toBe(0);
});

test('renders the list and describes it', async () => {
  const page = await renderListPage('en', { cities, movies });

  expect(page.path).toBe('/en/');
  expect(page.head.title).toBe('Cinema screenings across Lithuania – Seansai');
  expect(page.markup).toContain('Now showing');
  expect(page.markup).toContain('Kasėjas');
});

test('renders a movie and describes it, with the choice of city beside it', async () => {
  const page = await renderMoviePage('en', {
    cities,
    detail: diggerDetail,
    screenings: {
      date: TODAY,
      screenings: diggerScreenings,
      nextDateWithScreenings: null,
      freshness,
    },
  });

  expect(page.path).toBe('/en/movie/digger-2026');
  expect(page.head.title).toBe('Kasėjas (2026) – screenings');
  expect(page.markup).toContain('Next screening: Friday 30 October');
  expect(page.markup).toContain('Keep all of Lithuania');
  expect(page.markup).toContain('https://www.apollokinas.lt/websales/show/1');
});

test('renders a movie whose address needs percent-encoding', async () => {
  const detail = { ...diggerDetail, movie: { ...diggerDetail.movie, id: 'weiß-2026' } };

  const page = await renderMoviePage('lt', {
    cities,
    detail,
    screenings: { date: TODAY, screenings: [], nextDateWithScreenings: '2026-10-31', freshness },
  });

  expect(page.path).toBe('/lt/movie/weiß-2026');
  expect(page.markup).toContain('Kasėjas');
  expect(page.markup).toContain('?date=2026-10-31');
});

test('an address that redirects is not a page', async () => {
  await expect(renderPage('/', filledCache())).rejects.toThrow('/');
});
