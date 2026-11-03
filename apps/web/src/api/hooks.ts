import type { Lang } from '@seansai/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { getCities, getMovie, getMovies, getScreenings } from './client.ts';

/** The API caches responses for 5 minutes too, so refetching sooner gains nothing. */
const STALE_TIME_MS = 5 * 60 * 1000;

export const queryKeys = {
  cities: (lang: Lang) => ['cities', lang] as const,
  movies: (city: string) => ['movies', city] as const,
  movie: (movieId: string, city: string, lang: Lang) => ['movie', movieId, city, lang] as const,
  screenings: (movieId: string, city: string, date: string | null) =>
    ['screenings', movieId, city, date ?? 'today'] as const,
};

/*
 * Query definitions shared by the hooks below and the route loaders (app/router.tsx), which start
 * these requests while the page's code is still downloading.
 */

export const citiesQuery = (lang: Lang) =>
  queryOptions({
    queryKey: queryKeys.cities(lang),
    queryFn: ({ signal }) => getCities(lang, signal),
    staleTime: STALE_TIME_MS,
  });

export const moviesQuery = (city: string) =>
  queryOptions({
    queryKey: queryKeys.movies(city),
    queryFn: ({ signal }) => getMovies(city, signal),
    staleTime: STALE_TIME_MS,
  });

export const movieQuery = (movieId: string, city: string, lang: Lang) =>
  queryOptions({
    queryKey: queryKeys.movie(movieId, city, lang),
    queryFn: ({ signal }) => getMovie(movieId, city, lang, signal),
    staleTime: STALE_TIME_MS,
  });

/** `date` null means today, as the server sees it. */
export const screeningsQuery = (movieId: string, city: string, date: string | null) =>
  queryOptions({
    queryKey: queryKeys.screenings(movieId, city, date),
    queryFn: ({ signal }) => getScreenings(movieId, city, date, signal),
    staleTime: STALE_TIME_MS,
  });

export function useCities(lang: Lang) {
  return useQuery(citiesQuery(lang));
}

export function useMovies(city: string) {
  return useQuery(moviesQuery(city));
}

export function useMovie(movieId: string, city: string, lang: Lang) {
  return useQuery(movieQuery(movieId, city, lang));
}

/**
 * `date` null means today. While another date of the same movie and city loads, the previous
 * date's list stays as placeholder data (`isPlaceholderData`).
 */
export function useScreenings(movieId: string, city: string, date: string | null) {
  return useQuery({
    ...screeningsQuery(movieId, city, date),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === movieId && previousQuery.queryKey[2] === city
        ? previous
        : undefined,
  });
}
