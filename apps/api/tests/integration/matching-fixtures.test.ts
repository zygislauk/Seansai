import type { InStatement } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Db } from '../../src/db/index.ts';
import { Repository } from '../../src/db/repository.ts';
import { loadAliases } from '../../src/matching/match.ts';
import { titleKeysOf } from '../../src/matching/normalize.ts';
import { refreshSource } from '../../src/refresh/refresh-source.ts';
import { cinemaRegistry } from '../../src/registry/cinemas.ts';
import {
  FixtureHttpClient,
  readCaptureInstant,
  readFixtureNow,
} from '../../src/sources/fixture-http.ts';
import { adapters } from '../../src/sources/index.ts';
import type { SourceAdapter } from '../../src/sources/types.ts';
import { createTempDb } from '../helpers/temp-db.ts';
import { createTestLogger } from '../helpers/test-logger.ts';

/**
 * The database with a delay before each call, as a remote one has, so sources can overlap. A batch
 * takes longer than a read, or a store outside the lock would still land before the next read.
 */
function withLatency(db: Db): Db {
  const delayed =
    <Args extends unknown[], Result>(ms: number, call: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return call(...args);
    };
  return Object.assign(Object.create(db) as Db, {
    execute: delayed(20, (stmt: InStatement) => db.execute(stmt)),
    batch: delayed(60, db.batch.bind(db)),
  });
}

const SLOW_LAST: readonly string[] = [
  'cinamon',
  'romuva',
  'garsas',
  'vue',
  'skalvija',
  'apollo',
  'pasaka',
  'atlantis',
  'forum',
];

async function refreshAll(
  order: 'forward' | 'reverse' | 'parallel',
): Promise<{ db: Db; cleanup: () => void }> {
  const temp = await createTempDb();
  const repo = new Repository(order === 'parallel' ? withLatency(temp.db) : temp.db);
  const now = readFixtureNow() ?? new Date();
  const refresh = (adapter: SourceAdapter) =>
    refreshSource(adapter, {
      repo,
      registry: cinemaRegistry,
      http: new FixtureHttpClient({ sourceId: adapter.id, failingSources: [] }),
      now,
      sourceNow: readCaptureInstant(adapter.id) ?? now,
      // The maintainer's merge decisions apply, as in production.
      aliases: loadAliases(),
      logger: createTestLogger().logger,
      disabledSources: [],
    });
  if (order === 'parallel') {
    // As the daily refresh and the scheduler's startup run do it, with cinemas answering in an
    // order that used to split "Forgotten Island" into three movies.
    await Promise.all(
      adapters.map((adapter) => {
        const answersAfterMs = 20 * SLOW_LAST.indexOf(adapter.id);
        return refresh({
          ...adapter,
          fetchScreenings: async (context) => {
            await new Promise((resolve) => setTimeout(resolve, answersAfterMs));
            return adapter.fetchScreenings(context);
          },
        });
      }),
    );
    return temp;
  }
  for (const adapter of order === 'forward' ? adapters : [...adapters].reverse()) {
    await refresh(adapter);
  }
  return temp;
}

const SHOWN = 'EXISTS (SELECT 1 FROM screenings WHERE screenings.movie_id = movie_keys.movie_id)';

/** Shown movies known by this title (in any language), with their English titles. */
async function moviesKnownAs(db: Db, title: string) {
  const [key] = titleKeysOf({ title, originalTitle: null, englishTitle: null });
  const { rows } = await db.execute({
    sql: `SELECT movies.id, movies.english_title AS englishTitle FROM movie_keys
          JOIN movies ON movies.id = movie_keys.movie_id
          WHERE key = ? AND ${SHOWN}`,
    args: [key ?? null],
  });
  return rows as unknown as Array<{ id: string; englishTitle: string | null }>;
}

/**
 * The same movie must not appear twice (FR-005, SC-004): every source's saved data is refreshed
 * into one database, in three orders, and films that several cinemas show become one movie each.
 */
describe.each(['forward', 'reverse', 'parallel'] as const)(
  'all fixtures, refreshed %s',
  (order) => {
    let db: Db;
    let cleanup: () => void;

    beforeAll(async () => {
      ({ db, cleanup } = await refreshAll(order));
    });

    afterAll(() => {
      cleanup();
    });

    test('no two shown movies share a title', async () => {
      const shared = await db.execute(
        `SELECT key, group_concat(movie_id, ', ') AS movies FROM movie_keys
       WHERE ${SHOWN} GROUP BY key HAVING count(*) > 1`,
      );

      expect(shared.rows).toEqual([]);
      expect(
        (await db.execute('SELECT count(DISTINCT movie_id) AS movies FROM screenings')).rows[0],
      ).toEqual({ movies: 228 });
    });

    test.each([
      // Apollo's English title vs the Lithuanian original at Vue, Cinamon and the Fliko sites.
      ['Instruktorius', /^Instructor$/],
      // "Uprising" (Apollo), "The Uprising" (Cinamon, Pasaka, Vue) and "Sukilimas" (Romuva).
      ['Sukilimas', /Uprising$/],
      // Pasaka's original title is French; Apollo's is English.
      ['Mergaitė ir stebuklinga plunksna', /^Girl In The Clouds$/],
      // Vue spells the English title differently; the Lithuanian title is the same.
      ['Aviukas Šonas ir baimės pilnos kelnės', /^Shaun the Sheep: The Beast of Mossy Bottom$/],
      // Vue lists running times without ads, 11–13 minutes shorter than Apollo's.
      ['Forgotten Island', /^Forgotten Island$/],
      // Romuva publishes only the Lithuanian title.
      ['Kita mamytė', /^Other Mommy$/],
      // Forum's "Odisėja" and the same film at other cinemas.
      ['Odisėja', /^The Odyssey$/],
    ])('"%s" is one movie, under its English title', async (title, englishTitle) => {
      const movies = await moviesKnownAs(db, title);

      expect(movies).toHaveLength(1);
      expect(movies[0]?.englishTitle).toMatch(englishTitle);
    });

    test.each([
      ['Instruktorius', 90],
      ['Forgotten Island', 109],
      ['Aviukas Šonas ir baimės pilnos kelnės', 80],
    ])('"%s" shows its most common running time, whatever the order', async (title, minutes) => {
      const [movie] = await moviesKnownAs(db, title);
      const { rows } = await db.execute({
        sql: 'SELECT duration_minutes AS minutes FROM movies WHERE id = ?',
        args: [movie?.id ?? null],
      });

      expect(rows[0]?.minutes).toBe(minutes);
    });

    test.each(['Katinas su skrybėle', 'Lobių ieškotojai'])(
      'Sunday series film "%s" is one movie at every cinema that shows it',
      async (title) => {
        expect(await moviesKnownAs(db, title)).toHaveLength(1);
      },
    );

    test('no movie is stored under a Sunday series label', async () => {
      const { rows } = await db.execute(
        `SELECT title FROM movies
         WHERE title LIKE '%ekmadienis:%' OR title LIKE '%Sekmadienis su vaikais%'
            OR original_title LIKE '%ekmadienis:%'`,
      );

      expect(rows).toEqual([]);
    });

    test.each(['Aukso amžius', 'Rozė', 'Paukščių šneka', 'Zeitūno melodija'])(
      'Scanorama film "%s" is one movie at every cinema that shows it',
      async (title) => {
        expect(await moviesKnownAs(db, title)).toHaveLength(1);
      },
    );
  },
);
