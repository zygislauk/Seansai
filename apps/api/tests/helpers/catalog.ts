import type { FastifyInstance } from 'fastify';
import { Repository, type ScreeningRecord } from '../../src/db/repository.ts';
import { localDateOf } from '../../src/lib/time.ts';
import { cinemaRegistry } from '../../src/registry/cinemas.ts';
import { buildServer, type ServerOptions } from '../../src/server.ts';
import {
  createTempDb,
  movieRecord,
  screeningRecord,
  seedMovies,
  seedScreenings,
} from './temp-db.ts';
import { createTestLogger } from './test-logger.ts';

/** 12:00 on Friday 30 October 2026 in Vilnius. */
export const NOW = new Date('2026-10-30T10:00:00Z');
export const TODAY = '2026-10-30';
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

let nextId = 1;

/** A screening of `movieId` at `cinemaId` starting at the given UTC instant. */
function at(movieId: string, cinemaId: string, startsAt: string): ScreeningRecord {
  const cinema = cinemaRegistry.get(cinemaId);
  if (!cinema) throw new Error(`Unknown cinema ${cinemaId}`);
  const start = new Date(startsAt);
  return screeningRecord({
    id: `${cinema.sourceId}:${String(nextId++)}`,
    sourceId: cinema.sourceId,
    movieId,
    cinemaId,
    startsAt: start,
    localDate: localDateOf(start),
    ticketUrl: `${cinema.websiteUrl}/seansas/${String(nextId)}`,
  });
}

/**
 * Movies and screenings around NOW, sources `apollo`, `forum` and `skalvija`:
 * - Zuikis: 5 screenings left today in Vilnius.
 * - Abba and Kasėjas: 3 each today in Vilnius (ties go by title); Kasėjas also had one that
 *   already started, one in Kaunas, and one tomorrow. It also shows at Cinamon Mega in Kaunas,
 *   but `cinamon` is not one of the sources shown unless a test asks for it.
 * - Anksčiau starts on 1 November (at 00:30, then 19:00), Vėliau on 6 November, also in Klaipėda
 *   and Šiauliai.
 * - Prasidėjęs has only a screening that already started.
 * Forum last succeeded 4 hours ago (stale); Apollo and Skalvija 1 hour ago.
 */
export async function seedCatalog(repo: Repository): Promise<void> {
  nextId = 1;
  const movies = {
    zuikis: movieRecord({
      id: 'zuikis-2026',
      title: 'Zuikis',
      originalTitle: 'Bunny',
      matchKey: 'bunny',
    }),
    abba: movieRecord({ id: 'abba-2026', title: 'Abba', originalTitle: null, matchKey: 'abba' }),
    digger: movieRecord(),
    sooner: movieRecord({
      id: 'sooner-2026',
      title: 'Anksčiau',
      originalTitle: 'Sooner',
      matchKey: 'sooner',
    }),
    later: movieRecord({
      id: 'later-2026',
      title: 'Vėliau',
      originalTitle: 'Later',
      englishTitle: 'Later',
      matchKey: 'later',
      posterUrl: null,
    }),
    started: movieRecord({
      id: 'started-2026',
      title: 'Prasidėjęs',
      originalTitle: null,
      matchKey: 'prasidejes',
    }),
  };
  await seedMovies(
    repo,
    Object.values(movies).map((movie) => ({ movie })),
  );

  const screenings = [
    ...['11:00', '12:00', '13:00', '14:00', '15:00'].map((time) =>
      at(movies.zuikis.id, 'apollo-outlet', `2026-10-30T${time}:00Z`),
    ),
    at(movies.abba.id, 'apollo-akropolis', '2026-10-30T12:00:00Z'),
    at(movies.abba.id, 'apollo-akropolis', '2026-10-30T14:00:00Z'),
    at(movies.abba.id, 'skalvija', '2026-10-30T16:00:00Z'),
    at(movies.digger.id, 'forum-vingis', '2026-10-30T15:00:00Z'),
    at(movies.digger.id, 'skalvija', '2026-10-30T13:00:00Z'),
    at(movies.digger.id, 'apollo-akropolis', '2026-10-30T13:00:00Z'),
    at(movies.digger.id, 'apollo-akropolis', '2026-10-30T09:00:00Z'), // already started
    at(movies.digger.id, 'forum-kaunas', '2026-10-30T16:00:00Z'),
    at(movies.digger.id, 'cinamon-mega', '2026-10-30T16:00:00Z'),
    at(movies.digger.id, 'apollo-akropolis', '2026-10-31T18:00:00Z'),
    at(movies.sooner.id, 'skalvija', '2026-10-31T22:30:00Z'), // 00:30 on 1 November in Vilnius
    at(movies.sooner.id, 'skalvija', '2026-11-01T17:00:00Z'),
    at(movies.later.id, 'apollo-akropolis', '2026-11-06T17:00:00Z'),
    at(movies.later.id, 'forum-klaipeda', '2026-11-06T18:00:00Z'),
    at(movies.later.id, 'forum-siauliai', '2026-11-06T18:00:00Z'),
    at(movies.started.id, 'apollo-akropolis', '2026-10-30T08:00:00Z'), // already started
  ];
  for (const sourceId of ['apollo', 'forum', 'skalvija', 'cinamon']) {
    await seedScreenings(
      repo,
      sourceId,
      new Date(0),
      screenings.filter((screening) => screening.sourceId === sourceId),
    );
  }
  await repo.recordSourceSuccess('apollo', hoursAgo(1));
  await repo.recordSourceSuccess('skalvija', hoursAgo(1));
  await repo.recordSourceSuccess('forum', hoursAgo(4));
}

/** A server over a seeded temporary database; call `close` after each test. */
export async function startCatalogServer(
  sourceIds: readonly string[] = ['apollo', 'forum', 'skalvija'],
  options: Pick<ServerOptions, 'staleAfterMs'> = {},
): Promise<{ app: FastifyInstance; close: () => Promise<void> }> {
  const temp = await createTempDb();
  await seedCatalog(new Repository(temp.db));
  const app = buildServer({
    db: temp.db,
    now: () => NOW,
    logger: createTestLogger().logger,
    sourceIds,
    ...options,
  });
  return {
    app,
    close: async () => {
      await app.close();
      temp.cleanup();
    },
  };
}
