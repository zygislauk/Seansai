import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, getMovie, getMovies, getScreenings } from '../../src/api/client.ts';

const freshness = { updatedAt: '2026-10-30T12:00:00+02:00', staleCinemas: [] };

function mockFetch(status: number, body: unknown, contentType = 'application/json') {
  const fetch = vi.fn(() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': contentType },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const requestedUrl = (fetch: ReturnType<typeof mockFetch>) =>
  String((fetch.mock.calls[0] as unknown[] | undefined)?.[0]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API client', () => {
  test('requests the movie list for a city and parses it', async () => {
    const fetch = mockFetch(200, { movies: [], freshness });

    await expect(getMovies('vilnius')).resolves.toEqual({ movies: [], freshness });
    expect(requestedUrl(fetch)).toBe('/api/v1/movies?city=vilnius');
  });

  test('encodes the movie id and passes city and date', async () => {
    const fetch = mockFetch(200, {
      date: '2026-10-31',
      screenings: [],
      nextDateWithScreenings: null,
      freshness,
    });

    await getScreenings('kopa/2', 'all', '2026-10-31');
    expect(requestedUrl(fetch)).toBe('/api/v1/movies/kopa%2F2/screenings?city=all&date=2026-10-31');
  });

  test('throws ApiError with the code from an ErrorResponse', async () => {
    mockFetch(404, { error: { code: 'movie_not_found', message: 'No such movie' } });

    const error = await getMovie('nope', 'vilnius', 'lt').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'movie_not_found' });
  });

  test('treats a non-JSON error page as an internal error', async () => {
    mockFetch(502, '<html>Bad gateway</html>', 'text/html');

    await expect(getMovies('vilnius')).rejects.toMatchObject({
      status: 502,
      code: 'internal_error',
    });
  });

  test('rejects a response that breaks the contract', async () => {
    mockFetch(200, { movies: 'not a list', freshness });

    await expect(getMovies('vilnius')).rejects.toMatchObject({ code: 'internal_error' });
  });

  test('reports a failed connection as a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    await expect(getMovies('vilnius')).rejects.toMatchObject({
      status: null,
      code: 'network_error',
    });
  });
});
