import type { ScreeningFormat } from '@seansai/shared';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, splitStatements, type Db } from '../../src/db/index.ts';
import { Repository, type SourceRefresh } from '../../src/db/repository.ts';
import {
  createTempDb,
  findSource,
  movieRecord,
  screeningRecord,
  seedMovies,
  seedScreenings,
} from '../helpers/temp-db.ts';

const NOW = new Date('2026-10-30T10:00:00Z');
/** Violates the schema's CHECK on `format`, so any write including it fails. */
const INVALID_FORMAT = 'VHS' as unknown as ScreeningFormat;

let db: Db;
let path: string;
let repo: Repository;
let cleanup: () => void;

beforeEach(async () => {
  ({ db, path, cleanup } = await createTempDb());
  repo = new Repository(db);
  await seedMovies(repo, [{ movie: movieRecord() }]);
});

afterEach(() => {
  cleanup();
});

const ids = async (sql: string): Promise<string[]> =>
  ((await db.execute(sql)).rows as unknown as Array<{ id: string }>).map((row) => row.id);

const screeningIds = () => ids('SELECT id FROM screenings ORDER BY id');

const count = async (table: string): Promise<number> =>
  Number((await db.execute(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0]?.count);

const schemaVersion = async (database: Db): Promise<number> =>
  Number(
    (await database.execute('SELECT MAX(version) AS version FROM schema_migrations')).rows[0]
      ?.version,
  );

const userVersion = async (database: Db): Promise<number> =>
  Number((await database.execute('PRAGMA user_version')).rows[0]?.user_version);

describe('splitStatements', () => {
  test('ignores comment lines and empty statements', () => {
    expect(
      splitStatements('-- a; b\nCREATE TABLE a (x);\n\n-- c\nCREATE INDEX i ON a (x);\n'),
    ).toEqual(['CREATE TABLE a (x)', 'CREATE INDEX i ON a (x)']);
  });
});

describe('openDb', () => {
  test('records the migrations in a table, never in PRAGMA user_version (Turso rejects it)', async () => {
    expect(await schemaVersion(db)).toBe(6);
    expect(await userVersion(db)).toBe(0);
  });

  test('reopening a database file does not run the migrations again', async () => {
    db.close();
    db = await openDb(`file:${path}`);

    expect(await schemaVersion(db)).toBe(6);
  });

  test('a database migrated before the table existed is not migrated again', async () => {
    const legacyPath = `${path}.legacy`;
    const legacy = createClient({ url: `file:${legacyPath}` });
    await legacy.executeMultiple(
      readFileSync(new URL('../../src/db/schema.sql', import.meta.url), 'utf8') +
        readFileSync(
          new URL('../../src/db/migration-002-movie-keys.sql', import.meta.url),
          'utf8',
        ) +
        'PRAGMA user_version = 2;',
    );
    legacy.close();

    const reopened = await openDb(`file:${legacyPath}`);

    expect(
      (await reopened.execute("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'movies'"))
        .rows[0]?.count,
    ).toBe(1);
    // Only the migrations it lacks run.
    expect(await schemaVersion(reopened)).toBe(6);
    expect(
      (await reopened.execute('PRAGMA table_info(screenings)')).rows.map((row) => row.name),
    ).toContain('duration_minutes');
    reopened.close();
  });

  test('an upgraded database no longer holds anything from the two removed cinemas', async () => {
    await db.execute('DELETE FROM schema_migrations WHERE version >= 6');
    for (const source of ['spindulys', 'minija', 'garsas']) {
      await seedScreenings(repo, source, NOW, [
        screeningRecord({ id: `${source}:1`, sourceId: source, cinemaId: source }),
      ]);
    }

    db.close();
    db = await openDb(`file:${path}`);

    expect(await screeningIds()).toEqual(['garsas:1']);
    expect(await ids('SELECT id FROM sources ORDER BY id')).toEqual(['garsas', 'seed']);
    expect(await count('movies')).toBe(1);
  });

  test('an upgraded database keeps matching against the time each movie already has', async () => {
    const legacyPath = `${path}.upgrade`;
    const legacy = createClient({ url: `file:${legacyPath}` });
    await legacy.executeMultiple(
      readFileSync(new URL('../../src/db/schema.sql', import.meta.url), 'utf8') +
        readFileSync(
          new URL('../../src/db/migration-002-movie-keys.sql', import.meta.url),
          'utf8',
        ) +
        `INSERT INTO movies (id, title, match_key, duration_minutes)
         VALUES ('old-film', 'Senas', 'senas', 104);
         PRAGMA user_version = 2;`,
    );
    legacy.close();

    const reopened = await openDb(`file:${legacyPath}`);
    const [oldFilm] = await new Repository(reopened).listMovieIdentities();
    reopened.close();

    expect(oldFilm?.durationMinutes).toBe(104);
  });

  test('two servers starting at once on a new database both migrate it safely', async () => {
    const url = `file:${path}.fresh`;

    const [first, second] = await Promise.all([openDb(url), openDb(url)]);

    expect(await schemaVersion(first)).toBe(6);
    expect(
      (await first.execute("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'movies'"))
        .rows[0]?.count,
    ).toBe(1);
    first.close();
    second.close();
  });
});

describe('storeRefresh: screenings', () => {
  test("replaces only that source's future screenings, so cancelled screenings disappear", async () => {
    await seedScreenings(repo, 'apollo', NOW, [
      screeningRecord({ id: 'apollo:started', startsAt: new Date('2026-10-30T09:00:00Z') }),
      screeningRecord({ id: 'apollo:cancelled', startsAt: new Date('2026-10-30T15:00:00Z') }),
      screeningRecord({ id: 'apollo:kept', startsAt: new Date('2026-10-30T18:00:00Z') }),
    ]);
    await seedScreenings(repo, 'forum', NOW, [
      screeningRecord({ id: 'forum:1', sourceId: 'forum', cinemaId: 'forum-vingis' }),
    ]);

    await seedScreenings(repo, 'apollo', NOW, [
      screeningRecord({ id: 'apollo:kept', startsAt: new Date('2026-10-30T18:00:00Z') }),
      screeningRecord({ id: 'apollo:new', startsAt: new Date('2026-10-31T18:00:00Z') }),
    ]);

    // The screening that already started stays until the daily cleanup removes past dates.
    expect(await screeningIds()).toEqual([
      'apollo:kept',
      'apollo:new',
      'apollo:started',
      'forum:1',
    ]);
  });

  test('updates a screening that is published again with new details', async () => {
    await seedScreenings(repo, 'apollo', NOW, [screeningRecord({ hall: '6 salė' })]);
    await seedScreenings(repo, 'apollo', NOW, [screeningRecord({ hall: '7 salė' })]);

    expect((await db.execute('SELECT hall FROM screenings')).rows).toEqual([{ hall: '7 salė' }]);
  });

  test("records each movie's latest screening start", async () => {
    await seedScreenings(repo, 'apollo', NOW, [
      screeningRecord({ id: 'apollo:1', startsAt: new Date('2026-11-02T18:00:00Z') }),
      screeningRecord({ id: 'apollo:2', startsAt: new Date('2026-11-01T18:00:00Z') }),
    ]);

    expect((await db.execute('SELECT last_screening_at AS at FROM movies')).rows).toEqual([
      { at: '2026-11-02T18:00:00.000Z' },
    ]);
  });
});

describe('storeRefresh', () => {
  const refresh = (overrides: Partial<SourceRefresh> = {}): SourceRefresh => ({
    sourceId: 'apollo',
    now: NOW,
    movies: [
      { movie: movieRecord(), keys: ['kasejas'] },
      { movie: movieRecord({ id: 'digger-2025', year: 2025 }), keys: [] },
    ],
    screenings: [screeningRecord({ startsAt: new Date('2026-10-30T17:00:00Z') })],
    reviews: [
      {
        matchKey: 'digger',
        movieIdA: 'digger-2025',
        movieIdB: 'digger-2026',
        reason: 'year 2025 vs 2026',
      },
    ],
    ...overrides,
  });

  test('writes one source refresh and counts only the new reviews', async () => {
    expect(await repo.storeRefresh(refresh())).toEqual({ newReviews: 1 });
    expect(await repo.storeRefresh(refresh())).toEqual({ newReviews: 0 });

    expect((await findSource(repo, 'apollo'))?.lastSuccessAt).toEqual(NOW);
    expect(await screeningIds()).toEqual(['apollo:1']);
    const identities = await repo.listMovieIdentities();
    expect(identities.find((movie) => movie.id === 'digger-2026')?.keys.sort()).toEqual([
      'digger',
      'kasejas',
    ]);
  });

  test('is all or nothing: a failing write leaves the previous refresh in place', async () => {
    await repo.storeRefresh(refresh());
    const later = new Date('2026-10-30T11:00:00Z');

    await expect(
      repo.storeRefresh(
        refresh({
          now: later,
          screenings: [screeningRecord({ id: 'apollo:2', format: INVALID_FORMAT })],
        }),
      ),
    ).rejects.toThrow();

    expect(await screeningIds()).toEqual(['apollo:1']);
    expect((await findSource(repo, 'apollo'))?.lastSuccessAt).toEqual(NOW);
  });

  test('two refreshes of the same source at once leave no duplicates', async () => {
    const screenings = ['1', '2', '3'].map((id) => screeningRecord({ id: `apollo:${id}` }));

    await Promise.all([
      repo.storeRefresh(refresh({ screenings })),
      repo.storeRefresh(refresh({ screenings })),
    ]);

    expect(await screeningIds()).toEqual(['apollo:1', 'apollo:2', 'apollo:3']);
  });
});

describe('deletePastScreenings', () => {
  test('removes screenings whose calendar date is before today', async () => {
    await seedScreenings(repo, 'apollo', new Date('2026-10-28T00:00:00Z'), [
      screeningRecord({ id: 'apollo:yesterday', localDate: '2026-10-29' }),
      screeningRecord({ id: 'apollo:today', localDate: '2026-10-30' }),
      screeningRecord({ id: 'apollo:tomorrow', localDate: '2026-10-31' }),
    ]);

    expect(await repo.deletePastScreenings('2026-10-30')).toBe(1);
    expect(await screeningIds()).toEqual(['apollo:today', 'apollo:tomorrow']);
  });
});

describe('deleteStaleMovies', () => {
  const movieIds = () => ids('SELECT id FROM movies ORDER BY id');
  const setLastScreening = (id: string, at: string) =>
    db.execute({ sql: 'UPDATE movies SET last_screening_at = ? WHERE id = ?', args: [at, id] });

  test('deletes movies after 30 days without screenings', async () => {
    await seedMovies(repo, [
      { movie: movieRecord({ id: 'old-2025', matchKey: 'old', year: 2025 }) },
      { movie: movieRecord({ id: 'recent-2026', matchKey: 'recent' }) },
    ]);
    await setLastScreening('old-2025', '2026-09-29T18:00:00.000Z');
    await setLastScreening('recent-2026', '2026-10-01T18:00:00.000Z');
    // digger-2026 still has a screening, however old its last_screening_at says it is.
    await seedScreenings(repo, 'apollo', new Date('2026-09-01T00:00:00Z'), [screeningRecord()]);
    await setLastScreening('digger-2026', '2026-09-01T18:00:00.000Z');

    expect(await repo.deleteStaleMovies(NOW)).toBe(1);
    expect(await movieIds()).toEqual(['digger-2026', 'recent-2026']);
  });

  test('leaves no keys or match reviews of a deleted movie behind', async () => {
    await seedMovies(
      repo,
      [
        { movie: movieRecord({ id: 'dune-1984', matchKey: 'dune', year: 1984 }), keys: ['kopa'] },
        { movie: movieRecord({ id: 'dune-2021', matchKey: 'dune', year: 2021 }) },
      ],
      [
        {
          matchKey: 'dune',
          movieIdA: 'dune-1984',
          movieIdB: 'dune-2021',
          reason: 'year 1984 vs 2021',
        },
      ],
    );
    // Only the two Dune movies are stale: digger-2026 has a screening.
    await seedScreenings(repo, 'apollo', NOW, [screeningRecord()]);

    expect(await repo.deleteStaleMovies(NOW)).toBe(2);
    expect(
      (
        await db.execute(
          "SELECT COUNT(*) AS count FROM movie_keys WHERE movie_id IN ('dune-1984', 'dune-2021')",
        )
      ).rows[0]?.count,
    ).toBe(0);
    expect(await count('match_reviews')).toBe(0);
  });
});

describe('storeRefresh: running time', () => {
  const duration = async (): Promise<unknown> =>
    (await db.execute("SELECT duration_minutes AS d FROM movies WHERE id = 'digger-2026'")).rows[0]
      ?.d;
  const times = (prefix: string, ...minutes: Array<number | null>) =>
    minutes.map((durationMinutes, index) =>
      screeningRecord({ id: `${prefix}:${String(index)}`, sourceId: prefix, durationMinutes }),
    );

  test.each([
    ['most common last', ['forum', [108]], ['apollo', [91, 91]]],
    ['most common first', ['apollo', [91, 91]], ['forum', [108]]],
  ] as const)('is the most common across cinemas, whichever came first (%s)', async (_, a, b) => {
    await seedScreenings(repo, a[0], NOW, times(a[0], ...a[1]));
    await seedScreenings(repo, b[0], NOW, times(b[0], ...b[1]));

    expect(await duration()).toBe(91);
  });

  test('a tie goes to the shorter time, so the result does not depend on order', async () => {
    await seedScreenings(repo, 'forum', NOW, times('forum', 108));
    await seedScreenings(repo, 'apollo', NOW, times('apollo', 91));

    expect(await duration()).toBe(91);
  });

  test('screenings without a time do not count, and none at all keeps the movie as it is', async () => {
    await seedScreenings(repo, 'apollo', NOW, times('apollo', null, null));
    expect(await duration()).toBe(101);

    await seedScreenings(repo, 'forum', NOW, times('forum', 95));
    expect(await duration()).toBe(95);
  });

  test('follows the cinemas when they change their listings', async () => {
    await seedScreenings(repo, 'apollo', NOW, times('apollo', 91, 91));
    await seedScreenings(repo, 'apollo', NOW, times('apollo', 93, 93));

    expect(await duration()).toBe(93);
  });

  test('recounts a film that another cinema stopped listing', async () => {
    await seedScreenings(repo, 'apollo', NOW, times('apollo', 91, 91, 91));
    await seedScreenings(repo, 'forum', NOW, times('forum', 108));
    expect(await duration()).toBe(91);

    await seedScreenings(repo, 'apollo', NOW, []);

    expect(await duration()).toBe(108);
  });

  test('updates the time of a screening that has started and is listed again', async () => {
    const started = screeningRecord({ startsAt: new Date(NOW.getTime() - 60_000) });
    await seedScreenings(repo, 'apollo', NOW, [started]);
    await seedScreenings(repo, 'apollo', NOW, [{ ...started, durationMinutes: 95 }]);

    expect((await db.execute('SELECT duration_minutes AS d FROM screenings')).rows).toEqual([
      { d: 95 },
    ]);
  });

  test('matching keeps the first listed time, whatever the movie shows', async () => {
    await seedScreenings(repo, 'apollo', NOW, times('apollo', 91, 91));
    expect(await duration()).toBe(91);

    const [digger] = await repo.listMovieIdentities();

    expect(digger?.durationMinutes).toBe(101);
  });

  test('matching takes the first time known when the first listing had none', async () => {
    const listed = (durationMinutes: number | null) => [
      { movie: movieRecord({ id: 'new-film', matchKey: 'new film', durationMinutes }) },
    ];
    await seedMovies(repo, listed(null));
    await seedMovies(repo, listed(120));
    await seedMovies(repo, listed(130));

    const identities = await repo.listMovieIdentities();

    expect(identities.find(({ id }) => id === 'new-film')?.durationMinutes).toBe(120);
  });
});

describe('reserveTurn', () => {
  test('failed work rejects only for its caller, and the next turn still runs', async () => {
    const failing = repo.reserveTurn().run(() => Promise.reject(new Error('store failed')));
    const next = repo.reserveTurn().run(() => Promise.resolve('stored'));

    await expect(failing).rejects.toThrow('store failed');
    await expect(next).resolves.toBe('stored');
  });

  test('turns run one at a time, in the order reserved, whenever their work arrives', async () => {
    const events: string[] = [];
    const work = (name: string, ms: number) => async () => {
      events.push(`${name} start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`${name} end`);
    };
    const first = repo.reserveTurn();
    const second = repo.reserveTurn();

    const secondDone = second.run(work('second', 0));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual([]);
    await Promise.all([first.run(work('first', 20)), secondDone]);

    expect(events).toEqual(['first start', 'first end', 'second start', 'second end']);
  });

  test('a skipped turn lets the next one run, but not before the turn ahead of it', async () => {
    const events: string[] = [];
    const first = repo.reserveTurn();
    const skipped = repo.reserveTurn();
    const third = repo.reserveTurn();

    skipped.skip();
    const thirdDone = third.run(async () => {
      events.push('third');
      await Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual([]);

    await first.run(async () => {
      events.push('first');
      await Promise.resolve();
    });
    await thirdDone;

    expect(events).toEqual(['first', 'third']);
  });
});

describe('storeRefresh: movies', () => {
  test('keeps the first title and fills in details that were missing', async () => {
    await seedMovies(repo, [
      {
        movie: movieRecord({
          id: 'kopa',
          matchKey: 'kopa',
          year: null,
          posterUrl: null,
          genres: [],
        }),
      },
    ]);
    await seedMovies(repo, [
      {
        movie: movieRecord({
          id: 'kopa',
          matchKey: 'kopa',
          year: null,
          title: 'KOPA (LT sub.)',
          posterUrl: 'https://cinema.lt/kopa.jpg',
          genres: ['sci-fi'],
        }),
      },
    ]);

    expect(
      (await db.execute("SELECT title, poster_url, genres FROM movies WHERE id = 'kopa'")).rows,
    ).toEqual([
      { title: 'Kasėjas', poster_url: 'https://cinema.lt/kopa.jpg', genres: '["sci-fi"]' },
    ]);
  });
});

describe('sources', () => {
  test('records attempts and successes', async () => {
    await repo.recordSourceAttempt('forum', NOW, 'Request to https://forum failed: HTTP 500');
    expect(await findSource(repo, 'forum')).toEqual({
      id: 'forum',
      lastAttemptAt: NOW,
      lastSuccessAt: null,
      lastError: 'Request to https://forum failed: HTTP 500',
    });

    const later = new Date('2026-10-30T11:00:00Z');
    await repo.recordSourceSuccess('forum', later);
    expect(await findSource(repo, 'forum')).toEqual({
      id: 'forum',
      lastAttemptAt: later,
      lastSuccessAt: later,
      lastError: null,
    });

    const failedAgain = new Date('2026-10-30T12:00:00Z');
    await repo.recordSourceAttempt('forum', failedAgain, 'timeout');
    expect(await findSource(repo, 'forum')).toMatchObject({
      lastSuccessAt: later,
      lastError: 'timeout',
    });
    expect((await repo.listSources()).map((source) => source.id)).toEqual(['forum', 'seed']);
  });
});
