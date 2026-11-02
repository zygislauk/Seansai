import {
  ErrorResponseSchema,
  MovieDetailResponseSchema,
  MoviesResponseSchema,
} from '@seansai/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Repository } from '../../src/db/repository.ts';
import { startCatalogServer } from '../helpers/catalog.ts';

let server: Awaited<ReturnType<typeof startCatalogServer>>;

beforeEach(async () => {
  server = await startCatalogServer();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
});

const summaries = (body: unknown) =>
  MoviesResponseSchema.parse(body).movies.map(({ movie, screeningsToday, firstDate }) => [
    movie.title,
    screeningsToday,
    firstDate,
  ]);

test('orders movies with screenings left today first, by count then title, then later starts by date', async () => {
  const response = await server.app.inject('/api/v1/movies?city=vilnius');

  expect(response.statusCode).toBe(200);
  expect(summaries(response.json())).toEqual([
    ['Zuikis', 5, '2026-10-30'],
    ['Abba', 3, '2026-10-30'],
    ['Kasėjas', 3, '2026-10-30'],
    ['Anksčiau', 0, '2026-11-01'],
    ['Vėliau', 0, '2026-11-06'],
  ]);
});

test('returns movie summaries as the contract describes', async () => {
  const response = await server.app.inject('/api/v1/movies?city=vilnius');
  const later = MoviesResponseSchema.parse(response.json()).movies.find(
    (item) => item.movie.id === 'later-2026',
  );

  expect(later?.movie).toEqual({
    id: 'later-2026',
    title: 'Vėliau',
    originalTitle: 'Later',
    englishTitle: 'Later',
    posterUrl: null,
    ageRating: 'N13',
    durationMinutes: 101,
  });
});

test('city=all covers every city', async () => {
  const response = await server.app.inject('/api/v1/movies?city=all');

  // Kasėjas gains its Kaunas screening.
  expect(summaries(response.json())).toContainEqual(['Kasėjas', 4, '2026-10-30']);
});

test('a city only sees its own cinemas', async () => {
  const response = await server.app.inject('/api/v1/movies?city=kaunas');

  expect(summaries(response.json())).toEqual([['Kasėjas', 1, '2026-10-30']]);
});

test('rejects an unknown city with 400 invalid_city', async () => {
  for (const query of ['city=riga', '']) {
    const response = await server.app.inject(`/api/v1/movies?${query}`);

    expect(response.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('invalid_city');
  }
});

test('reports freshness: the oldest update and the cinemas whose data is stale', async () => {
  const response = await server.app.inject('/api/v1/movies?city=vilnius');

  expect(MoviesResponseSchema.parse(response.json()).freshness).toEqual({
    updatedAt: '2026-10-30T08:00:00+02:00',
    staleCinemas: [
      {
        id: 'forum-vingis',
        name: 'Forum Cinemas Vingis',
        lastSuccessAt: '2026-10-30T08:00:00+02:00',
      },
    ],
  });
  expect(response.headers['cache-control']).toBe('public, max-age=300, s-maxage=300');
  expect(response.headers.etag).toEqual(expect.any(String));
});

test('reads every source in one query, however many cinemas are listed', async () => {
  const listSources = vi.spyOn(Repository.prototype, 'listSources');

  const response = await server.app.inject('/api/v1/movies?city=all');

  expect(response.statusCode).toBe(200);
  expect(listSources).toHaveBeenCalledTimes(1);
});

test('on Vercel, data refreshed 4 hours ago is not flagged as stale (48-hour threshold)', async () => {
  const vercel = await startCatalogServer(undefined, { staleAfterMs: 48 * 60 * 60 * 1000 });

  const response = await vercel.app.inject('/api/v1/movies?city=vilnius');

  expect(MoviesResponseSchema.parse(response.json()).freshness.staleCinemas).toEqual([]);
  await vercel.close();
});

describe('showingAt on GET /movies/{id}', () => {
  const showingAt = async (url: string) =>
    MovieDetailResponseSchema.parse((await server.app.inject(url)).json()).showingAt;

  // The Kaunas answer also shows that a source's cinemas stay hidden when it isn't shown.
  test('lists cinemas with a screening that has not started, within the requested city', async () => {
    const inVilnius = await showingAt('/api/v1/movies/digger-2026?city=vilnius');
    const inKaunas = await showingAt('/api/v1/movies/digger-2026?city=kaunas');

    expect(inVilnius.map((cinema) => cinema.id)).toEqual([
      'apollo-akropolis',
      'forum-vingis',
      'skalvija',
    ]);
    expect(inKaunas).toEqual([
      {
        id: 'forum-kaunas',
        name: 'Forum Cinemas Kaunas',
        cityId: 'kaunas',
        cityName: 'Kaunas',
      },
    ]);
  });

  test('orders all of Lithuania by city name, then cinema name', async () => {
    const cinemas = await showingAt('/api/v1/movies/digger-2026?city=all');

    expect(cinemas.map((cinema) => cinema.name)).toEqual([
      'Forum Cinemas Kaunas',
      'Apollo Akropolis',
      'Forum Cinemas Vingis',
      'Skalvija',
    ]);
  });

  test('within a city, orders by cinema name', async () => {
    const withCinamon = await startCatalogServer(['forum', 'cinamon']);

    const response = await withCinamon.app.inject('/api/v1/movies/digger-2026?city=kaunas');

    expect(
      MovieDetailResponseSchema.parse(response.json()).showingAt.map((cinema) => cinema.name),
    ).toEqual(['Cinamon Mega', 'Forum Cinemas Kaunas']);
    await withCinamon.close();
  });

  test('is empty when the only screening already started, or none is in the city', async () => {
    expect(await showingAt('/api/v1/movies/started-2026?city=all')).toEqual([]);
    expect(await showingAt('/api/v1/movies/zuikis-2026?city=kaunas')).toEqual([]);
  });

  test('names cities in the requested language, Lithuanian by default', async () => {
    const cityNames = async (query: string) =>
      (await showingAt(`/api/v1/movies/later-2026?city=all${query}`)).map(
        (cinema) => cinema.cityName,
      );

    // Šiauliai before Vilnius: sorted as Lithuanian, not by character code.
    expect(await cityNames('')).toEqual(['Klaipėda', 'Šiauliai', 'Vilnius']);
    expect(await cityNames('&lang=en')).toEqual(['Klaipeda', 'Siauliai', 'Vilnius']);
  });
});
