import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Db } from '../../src/db/index.ts';
import { Repository } from '../../src/db/repository.ts';
import { loadAliases } from '../../src/matching/match.ts';
import { cinemaRegistry } from '../../src/registry/cinemas.ts';
import { refreshSource, type RefreshContext } from '../../src/refresh/refresh-source.ts';
import { FixtureHttpClient } from '../../src/sources/fixture-http.ts';
import type { AdapterResult, SourceAdapter, SourceScreening } from '../../src/sources/types.ts';
import { createTempDb, findSource } from '../helpers/temp-db.ts';
import { createTestLogger } from '../helpers/test-logger.ts';

const NOW = new Date('2026-10-30T10:00:00Z');
const LATER = new Date('2026-10-30T11:00:00Z');

function screening(overrides: Partial<SourceScreening> = {}): SourceScreening {
  return {
    sourceScreeningId: '1',
    cinemaId: 'apollo-akropolis',
    startsAt: new Date('2026-10-30T17:00:00Z'),
    title: 'Kasėjas',
    originalTitle: 'Digger',
    englishTitle: null,
    year: 2026,
    durationMinutes: 101,
    ageRating: 'N13',
    genres: ['drama'],
    posterUrl: 'https://www.apollokinas.lt/posters/digger.jpg',
    hall: '6 salė',
    format: '2D',
    spokenLanguage: 'en',
    subtitleLanguage: 'lt',
    isDubbed: false,
    ticketUrl: 'https://www.apollokinas.lt/websales/show/1',
    ...overrides,
  };
}

function listingsFrom(id: SourceAdapter['id'], screenings: SourceScreening[]): SourceAdapter {
  return { id, fetchScreenings: () => Promise.resolve({ screenings, skipped: [] }) };
}

function stubAdapter(result: AdapterResult | (() => Promise<AdapterResult>)) {
  const fetchScreenings = vi.fn(
    typeof result === 'function' ? result : () => Promise.resolve(result),
  );
  const adapter: SourceAdapter = { id: 'apollo', fetchScreenings };
  return Object.assign(adapter, { fetchScreeningsMock: fetchScreenings });
}

let db: Db;
let repo: Repository;
let cleanup: () => void;
let log: ReturnType<typeof createTestLogger>;

function context(overrides: Partial<RefreshContext> = {}): RefreshContext {
  return {
    repo,
    registry: cinemaRegistry,
    http: new FixtureHttpClient({ sourceId: 'apollo', failingSources: [] }),
    now: NOW,
    aliases: [],
    logger: log.logger,
    disabledSources: [],
    ...overrides,
  };
}

const storedScreenings = async () =>
  (await db.execute('SELECT id, movie_id, cinema_id, local_date FROM screenings ORDER BY id')).rows;

beforeEach(async () => {
  ({ db, cleanup } = await createTempDb());
  repo = new Repository(db);
  log = createTestLogger();
});

afterEach(() => {
  cleanup();
});

describe('refreshSource', () => {
  test('stores a valid result, merging listings of the same movie, and marks success', async () => {
    const adapter = stubAdapter({
      screenings: [
        screening({ sourceScreeningId: '1' }),
        screening({
          sourceScreeningId: '2',
          cinemaId: 'apollo-outlet',
          title: 'KASĖJAS (LT sub.)',
          // 00:30 local time on 31 October: belongs to the date it starts on.
          startsAt: new Date('2026-10-30T22:30:00Z'),
        }),
      ],
      skipped: [{ reason: 'no start time', raw: '{"id":3}' }],
    });

    const outcome = await refreshSource(adapter, context());

    expect(outcome).toEqual({ status: 'success', stored: 2, skipped: 1, newReviews: 0 });
    expect(await storedScreenings()).toEqual([
      {
        id: 'apollo:1',
        movie_id: 'digger-2026',
        cinema_id: 'apollo-akropolis',
        local_date: '2026-10-30',
      },
      {
        id: 'apollo:2',
        movie_id: 'digger-2026',
        cinema_id: 'apollo-outlet',
        local_date: '2026-10-31',
      },
    ]);
    expect(await findSource(repo, 'apollo')).toMatchObject({ lastSuccessAt: NOW, lastError: null });
    expect(log.lines()).toContainEqual(
      expect.objectContaining({ source: 'apollo', stored: 2, skipped: 1, newReviews: 0 }),
    );
  });

  test('passes the clock, HTTP client and registry to the adapter', async () => {
    const adapter = stubAdapter({ screenings: [], skipped: [] });
    const ctx = context();

    await refreshSource(adapter, ctx);

    expect(adapter.fetchScreeningsMock).toHaveBeenCalledWith({
      now: NOW,
      http: ctx.http,
      registry: ctx.registry,
    });
  });

  test('runs the adapter on its own clock when one is given (fixture replay)', async () => {
    const adapter = stubAdapter({ screenings: [], skipped: [] });
    const capturedAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

    await refreshSource(adapter, context({ sourceNow: capturedAt }));

    expect(adapter.fetchScreeningsMock).toHaveBeenCalledWith(
      expect.objectContaining({ now: capturedAt }),
    );
    expect((await repo.listSources())[0]?.lastAttemptAt).toEqual(NOW);
  });

  test('keeps screenings through today + 90 days (Vilnius dates) and drops later ones', async () => {
    const adapter = stubAdapter({
      screenings: [
        // 23:30 on 28 January 2027 in Vilnius, the 90th day after 30 October.
        screening({ sourceScreeningId: 'last', startsAt: new Date('2027-01-28T21:30:00Z') }),
        // 00:30 on 29 January in Vilnius, although still 28 January in UTC.
        screening({ sourceScreeningId: 'beyond', startsAt: new Date('2027-01-28T22:30:00Z') }),
      ],
      skipped: [],
    });

    const outcome = await refreshSource(adapter, context());

    expect(outcome).toMatchObject({ status: 'success', stored: 1, skipped: 0 });
    expect((await storedScreenings()).map((row) => row.id)).toEqual(['apollo:last']);
  });

  test('counts the 90 days from the adapter’s own clock in fixture replay', async () => {
    const adapter = stubAdapter({
      screenings: [screening({ startsAt: new Date('2027-01-29T10:00:00Z') })],
      skipped: [],
    });

    await refreshSource(adapter, context({ sourceNow: new Date('2026-10-31T10:00:00Z') }));

    expect((await storedScreenings()).map((row) => row.id)).toEqual(['apollo:1']);
  });

  test('a result failing SourceScreeningSchema keeps the previous data and records the error', async () => {
    await refreshSource(stubAdapter({ screenings: [screening()], skipped: [] }), context());

    const outcome = await refreshSource(
      stubAdapter({
        screenings: [screening({ sourceScreeningId: '2', ticketUrl: 'javascript:alert(1)' })],
        skipped: [],
      }),
      context({ now: LATER }),
    );

    expect(outcome).toMatchObject({ status: 'failed' });
    expect(await storedScreenings()).toEqual([expect.objectContaining({ id: 'apollo:1' })]);
    expect(await findSource(repo, 'apollo')).toMatchObject({
      lastAttemptAt: LATER,
      lastSuccessAt: NOW,
      lastError: expect.stringContaining('ticketUrl') as unknown,
    });
  });

  test('a thrown error keeps the previous data and records the error', async () => {
    await refreshSource(stubAdapter({ screenings: [screening()], skipped: [] }), context());

    const outcome = await refreshSource(
      stubAdapter(() => Promise.reject(new Error('Blocked by www.apollokinas.lt: HTTP 403'))),
      context({ now: LATER }),
    );

    expect(outcome).toEqual({ status: 'failed', error: 'Blocked by www.apollokinas.lt: HTTP 403' });
    expect(await storedScreenings()).toHaveLength(1);
    expect(await findSource(repo, 'apollo')).toMatchObject({
      lastSuccessAt: NOW,
      lastError: 'Blocked by www.apollokinas.lt: HTTP 403',
    });
    expect(log.lines()).toContainEqual(expect.objectContaining({ source: 'apollo', level: 50 }));
  });

  test('drops and logs screenings whose cinema is not in the registry', async () => {
    const outcome = await refreshSource(
      stubAdapter({
        screenings: [
          screening(),
          screening({ sourceScreeningId: '2', cinemaId: 'apollo-new-mall' }),
        ],
        skipped: [],
      }),
      context(),
    );

    expect(outcome).toMatchObject({ status: 'success', stored: 1, skipped: 1 });
    expect(await storedScreenings()).toEqual([expect.objectContaining({ id: 'apollo:1' })]);
    expect(log.lines()).toContainEqual(
      expect.objectContaining({ source: 'apollo', cinemaId: 'apollo-new-mall', level: 40 }),
    );
  });

  test('logs uncertain matches for review and counts the new ones', async () => {
    const dune = (id: string, year: number) =>
      screening({ sourceScreeningId: id, title: 'Kopa', originalTitle: 'Dune', year });
    const adapter = stubAdapter({ screenings: [dune('1', 1984), dune('2', 2021)], skipped: [] });

    expect(await refreshSource(adapter, context())).toMatchObject({ newReviews: 1 });
    expect(await refreshSource(adapter, context({ now: LATER }))).toMatchObject({ newReviews: 0 });

    expect(
      (await db.execute('SELECT movie_id_a, movie_id_b, reason FROM match_reviews')).rows,
    ).toEqual([{ movie_id_a: 'dune-1984', movie_id_b: 'dune-2021', reason: 'year 1984 vs 2021' }]);
  });

  test('skips a source listed in DISABLED_SOURCES', async () => {
    const adapter = stubAdapter({ screenings: [screening()], skipped: [] });

    const outcome = await refreshSource(adapter, context({ disabledSources: ['vue', 'apollo'] }));

    expect(outcome).toEqual({ status: 'disabled' });
    expect(adapter.fetchScreeningsMock).not.toHaveBeenCalled();
    expect(await findSource(repo, 'apollo')).toBeUndefined();
  });

  test('sources refreshed at the same time still share one movie', async () => {
    const apollo = stubAdapter({
      screenings: [screening({ title: 'Kasėjas', originalTitle: null, englishTitle: 'Digger' })],
      skipped: [],
    });
    const forum: SourceAdapter = {
      id: 'forum',
      fetchScreenings: () =>
        Promise.resolve({
          screenings: [
            screening({ cinemaId: 'forum-vingis', title: 'Kasėjas', originalTitle: null }),
          ],
          skipped: [],
        }),
    };

    await Promise.all([refreshSource(apollo, context()), refreshSource(forum, context())]);

    const movies = (await db.execute('SELECT id FROM movies')).rows;
    expect(movies).toHaveLength(1);
    expect(await storedScreenings()).toHaveLength(2);
  });

  test('sources store in the order they started, whichever fetch finishes first', async () => {
    const slowApollo: SourceAdapter = {
      id: 'apollo',
      fetchScreenings: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { screenings: [screening({ title: 'Pirmasis' })], skipped: [] };
      },
    };
    const fastForum = listingsFrom('forum', [
      screening({ cinemaId: 'forum-vingis', title: 'Antrasis' }),
    ]);

    await Promise.all([refreshSource(slowApollo, context()), refreshSource(fastForum, context())]);

    // The first title stored stays.
    expect((await db.execute('SELECT title FROM movies')).rows).toEqual([{ title: 'Pirmasis' }]);
  });

  test('a source whose fetch fails does not hold up the ones behind it', async () => {
    const broken: SourceAdapter = {
      id: 'apollo',
      fetchScreenings: () => Promise.reject(new Error('cinema down')),
    };
    const forum = listingsFrom('forum', [screening({ cinemaId: 'forum-vingis' })]);

    const [first, second] = await Promise.all([
      refreshSource(broken, context()),
      refreshSource(forum, context()),
    ]);

    expect(first.status).toBe('failed');
    expect(second.status).toBe('success');
  });

  test('a disabled source does not hold up the ones behind it', async () => {
    const apollo = listingsFrom('apollo', [screening()]);
    const forum = listingsFrom('forum', [screening({ cinemaId: 'forum-vingis' })]);

    const [first, second] = await Promise.all([
      refreshSource(apollo, context({ disabledSources: ['apollo'] })),
      refreshSource(forum, context({ disabledSources: ['apollo'] })),
    ]);

    expect(first.status).toBe('disabled');
    expect(second.status).toBe('success');
  });

  test('failing to record a failed fetch does not hold up the sources behind it', async () => {
    const broken: SourceAdapter = {
      id: 'apollo',
      fetchScreenings: () => Promise.reject(new Error('cinema down')),
    };
    const forum = listingsFrom('forum', [screening({ cinemaId: 'forum-vingis' })]);
    vi.spyOn(repo, 'recordSourceAttempt').mockRejectedValueOnce(new Error('database down'));

    const [first, second] = await Promise.allSettled([
      refreshSource(broken, context()),
      refreshSource(forum, context()),
    ]);

    expect(first.status).toBe('rejected');
    expect(second).toMatchObject({ status: 'fulfilled', value: { status: 'success' } });
  });

  test('a film stays one movie when its most common running time moves away from a listing', async () => {
    const noYear = { title: 'Kasėjas', originalTitle: null, year: null };
    const sources = [
      listingsFrom('apollo', [screening({ durationMinutes: 120 })]),
      listingsFrom('forum', [
        screening({ cinemaId: 'forum-vingis', ...noYear, durationMinutes: 122 }),
      ]),
      listingsFrom(
        'vue',
        ['1', '2', '3'].map((sourceScreeningId) =>
          screening({ sourceScreeningId, cinemaId: 'vue-vilnius', durationMinutes: 105 }),
        ),
      ),
    ];

    for (const day of [NOW, LATER]) {
      for (const adapter of sources) await refreshSource(adapter, context({ now: day }));
    }

    expect((await db.execute('SELECT id, duration_minutes FROM movies')).rows).toEqual([
      { id: 'digger-2026', duration_minutes: 105 },
    ]);
    expect((await db.execute('SELECT 1 FROM match_reviews')).rows).toEqual([]);
  });

  test("a listing does not join a film through another listing's running time", async () => {
    const kopa = { title: 'Kopa', originalTitle: null, year: null };
    const sources = [
      listingsFrom(
        'apollo',
        ['1', '2'].map((sourceScreeningId) =>
          screening({
            sourceScreeningId,
            title: 'Kopa',
            originalTitle: 'Dune',
            year: 2021,
            durationMinutes: 155,
          }),
        ),
      ),
      // 12 minutes from the film: the same film.
      listingsFrom('vue', [screening({ cinemaId: 'vue-vilnius', ...kopa, durationMinutes: 143 })]),
      // 18 minutes from the film, though 6 from the listing above: another film (FR-005).
      listingsFrom('forum', [
        screening({ cinemaId: 'forum-vingis', ...kopa, durationMinutes: 137 }),
      ]),
    ];

    for (const day of [NOW, LATER]) {
      for (const adapter of sources) await refreshSource(adapter, context({ now: day }));
    }

    expect((await db.execute('SELECT id FROM movies ORDER BY id')).rows).toEqual([
      { id: 'dune-2021' },
      { id: 'kopa' },
    ]);
    expect((await db.execute('SELECT movie_id_b FROM match_reviews')).rows).toEqual([
      { movie_id_b: 'kopa' },
    ]);
  });

  test('a merged film shows the most common running time, even if a rare one came first', async () => {
    const sundayShowing: SourceAdapter = {
      id: 'forum',
      fetchScreenings: () =>
        Promise.resolve({
          screenings: [
            screening({
              cinemaId: 'forum-vingis',
              title: 'Katinas su skrybėle | Sekmadienis su vaikais',
              originalTitle: 'The Cat in the Hat',
              englishTitle: null,
              year: null,
              durationMinutes: 108,
            }),
          ],
          skipped: [],
        }),
    };
    const film = (sourceScreeningId: string) =>
      screening({
        sourceScreeningId,
        title: 'Katinas su skrybėle',
        originalTitle: 'The Cat in the Hat',
        englishTitle: 'Cat in the Hat',
        year: 2026,
        durationMinutes: 91,
      });

    await refreshSource(sundayShowing, context({ aliases: loadAliases() }));
    await refreshSource(
      stubAdapter({ screenings: [film('1'), film('2')], skipped: [] }),
      context({ aliases: loadAliases() }),
    );

    expect((await db.execute('SELECT duration_minutes AS d FROM movies')).rows).toEqual([
      { d: 91 },
    ]);
    expect(await storedScreenings()).toHaveLength(3);
  });
});
