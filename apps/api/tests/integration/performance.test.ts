import { afterAll, beforeAll, expect, test } from 'vitest';
import { TODAY } from '../helpers/catalog.ts';
import { largeMovieIds, startLargeCatalogServer } from '../helpers/large-catalog.ts';

/** Plan.md performance goal: list endpoints answer in under 50 ms at p95 with a full database. */
const P95_BUDGET_MS = 50;
const REQUESTS = 200;

let server: Awaited<ReturnType<typeof startLargeCatalogServer>>;

beforeAll(async () => {
  server = await startLargeCatalogServer();
});

afterAll(async () => {
  await server.close();
});

function p95(durations: number[]): number {
  const sorted = [...durations].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Infinity;
}

test.each([
  ['GET /movies', '/api/v1/movies?city=vilnius'],
  ['GET /movies (all cities)', '/api/v1/movies?city=all'],
  ['GET /movies/{id} (all cities)', `/api/v1/movies/${largeMovieIds[1] ?? ''}?city=all`],
  [
    'GET /movies/{id}/screenings',
    `/api/v1/movies/${largeMovieIds[1] ?? ''}/screenings?city=all&date=${TODAY}`,
  ],
])('%s answers in < 50 ms at p95 with 7,000 screenings', async (_, url) => {
  for (let i = 0; i < 10; i++) await server.app.inject(url); // warm up

  const durations: number[] = [];
  for (let i = 0; i < REQUESTS; i++) {
    const started = performance.now();
    const response = await server.app.inject(url);
    durations.push(performance.now() - started);
    expect(response.statusCode).toBe(200);
  }

  expect(p95(durations)).toBeLessThan(P95_BUDGET_MS);
});
