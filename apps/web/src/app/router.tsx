import { LangSchema } from '@seansai/shared';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  Outlet,
  redirect,
  useParams,
  type LoaderFunctionArgs,
  type ShouldRevalidateFunctionArgs,
  type RouteObject,
} from 'react-router';
import { citiesQuery, movieQuery, moviesQuery, screeningsQuery } from '../api/hooks.ts';
import { Spinner } from '../components/atoms/Spinner/index.ts';
import { I18nProvider } from '../i18n/index.tsx';
import { getCity, getLang } from '../storage/settings.ts';

const DEFAULT_LANG = 'lt';

/** Unknown language prefixes are redirected to the same page in Lithuanian. */
function languageLoader({ params, request }: LoaderFunctionArgs) {
  if (LangSchema.safeParse(params.lang).success) return null;
  const url = new URL(request.url);
  const rest = url.pathname.split('/').slice(2).join('/');
  return redirect(`/${DEFAULT_LANG}/${rest}${url.search}`);
}

/** Provides the interface language from the URL and keeps `<html lang>` in sync with it. */
function LanguageRoot() {
  const lang = LangSchema.catch(DEFAULT_LANG).parse(useParams().lang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <I18nProvider lang={lang}>
      <Outlet />
    </I18nProvider>
  );
}

function RouteLoading() {
  return <Spinner label="Kraunama… / Loading…" />;
}

/** The page's language and city as the page itself will read them (city.tsx, LanguageRoot). */
function pageContext({ params, request }: LoaderFunctionArgs) {
  return {
    lang: LangSchema.catch(DEFAULT_LANG).parse(params.lang),
    city: new URL(request.url).searchParams.get('city') ?? getCity() ?? 'all',
    date: new URL(request.url).searchParams.get('date'),
  };
}

/** A failed early request is not an error here: the page asks again and shows the error. */
const ignore = () => undefined;

/**
 * Loaders only warm the cache for a page being opened. Changing the date or a filter on the same
 * page needs no loader run: the page requests what it needs itself.
 */
function pageChanged({ currentUrl, nextUrl }: ShouldRevalidateFunctionArgs): boolean {
  return (
    currentUrl.pathname !== nextUrl.pathname ||
    currentUrl.searchParams.get('city') !== nextUrl.searchParams.get('city')
  );
}

/**
 * Page addresses are part of the contract: contracts/web-routes.md. Each page's loader starts the
 * page's API requests without waiting for them, so they run while the page's code downloads; the
 * page then finds them in the query cache.
 */
export function createRoutes(queryClient: QueryClient): RouteObject[] {
  return [
    {
      path: '/',
      loader: () => redirect(`/${getLang() ?? DEFAULT_LANG}/`),
      HydrateFallback: RouteLoading,
    },
    {
      path: '/:lang',
      loader: languageLoader,
      Component: LanguageRoot,
      HydrateFallback: RouteLoading,
      children: [
        {
          index: true,
          loader: (args) => {
            const { lang, city } = pageContext(args);
            queryClient.query(citiesQuery(lang)).catch(ignore);
            queryClient.query(moviesQuery(city)).catch(ignore);
            return null;
          },
          shouldRevalidate: pageChanged,
          lazy: async () => ({
            Component: (await import('../pages/MovieListPage.tsx')).MovieListPage,
          }),
        },
        {
          path: 'movie/:movieId',
          loader: (args) => {
            const { lang, city, date } = pageContext(args);
            const movieId = args.params.movieId ?? '';
            queryClient.query(citiesQuery(lang)).catch(ignore);
            queryClient.query(movieQuery(movieId, city)).catch(ignore);
            queryClient.query(screeningsQuery(movieId, city, date)).catch(ignore);
            return null;
          },
          shouldRevalidate: pageChanged,
          lazy: async () => ({ Component: (await import('../pages/MoviePage.tsx')).MoviePage }),
        },
        {
          path: '*',
          lazy: async () => ({
            Component: (await import('../pages/NotFoundPage.tsx')).NotFoundPage,
          }),
        },
      ],
    },
  ];
}
