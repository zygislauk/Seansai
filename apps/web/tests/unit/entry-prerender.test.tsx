// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { citiesQuery, movieQuery, moviesQuery, screeningsQuery } from '../../src/api/hooks.ts';
import { createQueryClient } from '../../src/app/providers.tsx';
import { renderPage } from '../../src/entry-prerender.tsx';
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
  queryClient.setQueryData(movieQuery('digger-2026', 'all').queryKey, diggerDetail);
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
});

test('an address that redirects is not a page', async () => {
  await expect(renderPage('/', filledCache())).rejects.toThrow('/');
});
