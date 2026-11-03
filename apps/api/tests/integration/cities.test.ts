import { CitiesResponseSchema } from '@seansai/shared';
import { afterEach, expect, test } from 'vitest';
import { startCatalogServer } from '../helpers/catalog.ts';

let close: () => Promise<void>;

afterEach(async () => {
  await close();
});

test('lists every city with a supported cinema, with Lithuanian names by default', async () => {
  const server = await startCatalogServer([
    'apollo',
    'forum',
    'pasaka',
    'skalvija',
    'atlantis',
    'garsas',
    'spindulys',
    'minija',
    'romuva',
    'vue',
    'cinamon',
  ]);
  close = server.close;

  const response = await server.app.inject('/api/v1/cities');

  expect(response.statusCode).toBe(200);
  expect(CitiesResponseSchema.parse(response.json()).cities).toEqual([
    { id: 'vilnius', name: 'Vilnius', cinemaCount: 8, hasMovies: true },
    { id: 'kaunas', name: 'Kaunas', cinemaCount: 3, hasMovies: true },
    { id: 'klaipeda', name: 'Klaipėda', cinemaCount: 1, hasMovies: true },
    { id: 'siauliai', name: 'Šiauliai', cinemaCount: 2, hasMovies: true },
    { id: 'panevezys', name: 'Panevėžys', cinemaCount: 2, hasMovies: false },
    { id: 'marijampole', name: 'Marijampolė', cinemaCount: 1, hasMovies: false },
    { id: 'gargzdai', name: 'Gargždai', cinemaCount: 1, hasMovies: false },
  ]);
  expect(response.headers['cache-control']).toBe('public, max-age=300, s-maxage=300');
});

test('names cities in English with lang=en', async () => {
  const server = await startCatalogServer();
  close = server.close;

  const response = await server.app.inject('/api/v1/cities?lang=en');

  expect(response.json()).toMatchObject({
    cities: expect.arrayContaining([
      { id: 'klaipeda', name: 'Klaipeda', cinemaCount: 1, hasMovies: true },
    ]) as unknown,
  });
});

test('leaves out cities whose cinemas all come from inactive sources', async () => {
  const server = await startCatalogServer(['apollo']);
  close = server.close;

  const response = await server.app.inject('/api/v1/cities');

  expect(response.json()).toEqual({
    cities: [
      { id: 'vilnius', name: 'Vilnius', cinemaCount: 2, hasMovies: true },
      { id: 'panevezys', name: 'Panevėžys', cinemaCount: 1, hasMovies: false },
    ],
  });
});

async function hasMovies(
  sourceIds: readonly string[],
  cityId: string,
): Promise<boolean | undefined> {
  const server = await startCatalogServer(sourceIds);
  close = server.close;
  const response = await server.app.inject('/api/v1/cities');
  return CitiesResponseSchema.parse(response.json()).cities.find((city) => city.id === cityId)
    ?.hasMovies;
}

test('a city has movies when a screening there has not started', async () => {
  await expect(hasMovies(['forum'], 'kaunas')).resolves.toBe(true);
});

test('a city whose screenings have all started has no movies', async () => {
  await expect(hasMovies(['apollo'], 'panevezys')).resolves.toBe(false);
});

test('a city with no screenings has no movies', async () => {
  await expect(hasMovies(['spindulys'], 'marijampole')).resolves.toBe(false);
});

test('only the cinemas shown count', async () => {
  // Forum Kaunas and Cinamon Mega have screenings, but neither source is shown here.
  await expect(hasMovies(['romuva'], 'kaunas')).resolves.toBe(false);
});
