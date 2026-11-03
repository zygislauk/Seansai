import type {
  CitiesResponse,
  Lang,
  MovieDetailResponse,
  MoviesResponse,
  ScreeningsResponse,
} from '@seansai/shared';
import { dehydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from 'react-router';
import { citiesQuery, movieQuery, moviesQuery, screeningsQuery } from './api/hooks.ts';
import { AppProviders, createQueryClient } from './app/providers.tsx';
import { createRoutes } from './app/router.tsx';
import { pageHead } from './lib/page-head.ts';
import { SITE_URL } from './lib/site.ts';

/** What a page embeds as `#initial-data`, so the browser takes over without asking again. */
export type InitialData = {
  queryCache: DehydratedState;
  /** The routes' loader results: the router runs its loaders, and shows its fallback, without them. */
  loaderData: Record<string, unknown>;
};

/**
 * Renders one page to HTML, for the daily snapshot (scripts/prerender.ts). `queryClient` must
 * already hold the page's data, so the route loaders find it and make no requests.
 */
export async function renderPage(
  path: string,
  queryClient: QueryClient,
): Promise<{ markup: string; initialData: InitialData }> {
  const handler = createStaticHandler(createRoutes(queryClient));
  const context = await handler.query(new Request(new URL(path, SITE_URL)));
  if (context instanceof Response) throw new Error(`${path} redirects, so it isn't a page`);

  const markup = renderToString(
    <AppProviders queryClient={queryClient}>
      {/* hydrate={false}: its default is an inline script, which the CSP doesn't allow. */}
      <StaticRouterProvider
        router={createStaticRouter(handler.dataRoutes, context)}
        context={context}
        hydrate={false}
      />
    </AppProviders>,
  );
  const queryCache = dehydrate(queryClient);
  // Old by any clock, so the browser always asks for current data once it has taken over.
  for (const cached of queryCache.queries) cached.state.dataUpdatedAt = 0;
  return { markup, initialData: { queryCache, loaderData: context.loaderData } };
}

/** A snapshot's pages always show all of Lithuania (FR-004). */
const SNAPSHOT_CITY = 'all';

export async function renderListPage(
  lang: Lang,
  { cities, movies }: { cities: CitiesResponse; movies: MoviesResponse },
) {
  const queryClient = createQueryClient();
  queryClient.setQueryData(citiesQuery(lang).queryKey, cities);
  queryClient.setQueryData(moviesQuery(SNAPSHOT_CITY).queryKey, movies);
  const path = `/${lang}/`;
  return {
    path,
    head: pageHead({ kind: 'list' }, lang),
    ...(await renderPage(path, queryClient)),
  };
}

export async function renderMoviePage(
  lang: Lang,
  {
    cities,
    detail,
    screenings,
  }: { cities: CitiesResponse; detail: MovieDetailResponse; screenings: ScreeningsResponse },
) {
  const movieId = detail.movie.id;
  const queryClient = createQueryClient();
  queryClient.setQueryData(citiesQuery(lang).queryKey, cities);
  queryClient.setQueryData(movieQuery(movieId, SNAPSHOT_CITY, lang).queryKey, detail);
  queryClient.setQueryData(screeningsQuery(movieId, SNAPSHOT_CITY, null).queryKey, screenings);
  const path = `/${lang}/movie/${movieId}`;
  return {
    path,
    head: pageHead({ kind: 'movie', detail, city: SNAPSHOT_CITY }, lang),
    ...(await renderPage(encodeURI(path), queryClient)),
  };
}
