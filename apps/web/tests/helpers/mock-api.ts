import type {
  CitiesResponse,
  Freshness,
  MovieDetailResponse,
  MoviesResponse,
  Screening,
  ScreeningsResponse,
} from '@seansai/shared';
import { vi } from 'vitest';

/** Today in the sample data: Friday 30 October 2026. */
export const TODAY = '2026-10-30';

export const freshness: Freshness = { updatedAt: '2026-10-30T19:45:00+02:00', staleCinemas: [] };

export const cities: CitiesResponse = {
  cities: [
    { id: 'vilnius', name: 'Vilnius', cinemaCount: 8, hasMovies: true },
    { id: 'kaunas', name: 'Kaunas', cinemaCount: 3, hasMovies: true },
  ],
};

const vilnius = (id: string, name: string) => ({
  id,
  name,
  cityId: 'vilnius',
  cityName: 'Vilnius',
});

export function screening(overrides: Partial<Screening> = {}): Screening {
  return {
    id: 'apollo:1',
    startsAt: '2026-10-30T21:00:00+02:00',
    cinema: vilnius('apollo-akropolis', 'Apollo Akropolis'),
    hall: '6 salė',
    format: '3D',
    spokenLanguage: 'en',
    subtitleLanguage: 'lt',
    isDubbed: false,
    ticketUrl: 'https://www.apollokinas.lt/websales/show/1',
    ...overrides,
  };
}

export const diggerScreenings: Screening[] = [
  screening({ id: 'apollo:1', startsAt: '2026-10-30T20:00:00+02:00' }),
  screening({
    id: 'skalvija:2',
    startsAt: '2026-10-30T20:00:00+02:00',
    cinema: vilnius('skalvija', 'Skalvija'),
    hall: null,
    format: null,
    spokenLanguage: null,
    subtitleLanguage: null,
    isDubbed: null,
    ticketUrl: 'https://bilietai.skalvija.lt/kasa/seansas/2',
  }),
  screening({
    id: 'vue:3',
    startsAt: '2026-10-30T22:15:00+02:00',
    cinema: vilnius('vue-vilnius', 'Vue Vilnius'),
    hall: '3 salė',
    format: '2D',
    spokenLanguage: 'lt',
    subtitleLanguage: null,
    isDubbed: true,
    ticketUrl: 'https://vuekinas.lt/pirkti-bilieta/3',
  }),
];

const summary = (
  id: string,
  title: string,
  originalTitle: string | null,
  englishTitle: string | null = null,
) => ({
  id,
  title,
  originalTitle,
  englishTitle,
  posterUrl: null,
  ageRating: 'N13',
  durationMinutes: 101,
});

export const movies: MoviesResponse = {
  movies: [
    {
      movie: summary('bunny-2026', 'Zuikis', 'Lapin', 'Bunny'),
      screeningsToday: 5,
      firstDate: TODAY,
    },
    { movie: summary('digger-2026', 'Kasėjas', 'Digger'), screeningsToday: 3, firstDate: TODAY },
    {
      movie: summary('later-2026', 'Vėliau', 'Vėliau'),
      screeningsToday: 0,
      firstDate: '2026-11-06',
    },
  ],
  freshness,
};

export const diggerDetail: MovieDetailResponse = {
  movie: { ...summary('digger-2026', 'Kasėjas', 'Digger'), genres: ['drama'], year: 2026 },
  screeningDates: [TODAY, '2026-10-31'],
  availableDates: [TODAY, '2026-10-31', '2026-11-01'],
  showingAt: [
    vilnius('apollo-akropolis', 'Apollo Akropolis'),
    vilnius('skalvija', 'Skalvija'),
    vilnius('vue-vilnius', 'Vue Vilnius'),
  ],
};

type MockOptions = {
  movies?: MoviesResponse;
  screenings?: ScreeningsResponse;
  detail?: MovieDetailResponse;
  /** Requests for which this returns true never get an answer, to observe loading states. */
  pending?: (url: URL) => boolean;
  /** Requests that fail. */
  failing?: (url: URL) => boolean;
};

const urlOf = (input: string | URL | Request): string =>
  input instanceof Request ? input.url : input.toString();

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

/**
 * Stubs `fetch` with a small fake of the public API: known cities are `vilnius`, `kaunas` and
 * `all`; the only known movie is `digger-2026`. Returns the mock to inspect requested URLs.
 */
export function mockApi(options: MockOptions = {}) {
  const fetch = vi.fn((input: string | URL | Request) => {
    const url = new URL(urlOf(input), 'http://localhost');
    if (options.pending?.(url)) return new Promise<Response>(() => undefined);
    // A 4xx, as those aren't retried, so a test sees the failure straight away.
    if (options.failing?.(url)) return json(400, { error: { code: 'failed', message: 'failed' } });
    const city = url.searchParams.get('city');
    const badCity = city !== null && !['vilnius', 'kaunas', 'all'].includes(city);
    if (url.pathname === '/api/v1/cities') return json(200, cities);
    if (badCity) return json(400, { error: { code: 'invalid_city', message: 'unknown city' } });
    if (url.pathname === '/api/v1/movies') return json(200, options.movies ?? movies);
    const match = /^\/api\/v1\/movies\/([^/]+)(\/screenings)?$/.exec(url.pathname);
    if (match?.[1] !== 'digger-2026') {
      return json(404, { error: { code: 'movie_not_found', message: 'no such movie' } });
    }
    if (!match[2]) return json(200, options.detail ?? diggerDetail);
    return json(
      200,
      options.screenings ?? {
        date: url.searchParams.get('date') ?? TODAY,
        screenings: diggerScreenings,
        nextDateWithScreenings: null,
        freshness,
      },
    );
  });
  vi.stubGlobal('fetch', fetch);
  const requested = () => fetch.mock.calls.map(([input]) => urlOf(input));
  return { fetch, requested };
}
