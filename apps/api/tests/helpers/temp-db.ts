import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../../src/db/index.ts';
import type {
  MovieRecord,
  Repository,
  ScreeningRecord,
  SourceRecord,
} from '../../src/db/repository.ts';

/** A migrated SQLite database in a fresh temporary file; `cleanup` closes and deletes it. */
export async function createTempDb(): Promise<{ db: Db; path: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'seansai-test-'));
  const path = join(dir, 'test.sqlite');
  const db = await openDb(`file:${path}`);
  return {
    db,
    path,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Writes movies through `storeRefresh`, the production write path, as a source named `seed`. */
export async function seedMovies(
  repo: Repository,
  movies: ReadonlyArray<{ movie: MovieRecord; keys?: readonly string[] }>,
  reviews: Parameters<Repository['storeRefresh']>[0]['reviews'] = [],
): Promise<void> {
  await repo.storeRefresh({
    sourceId: 'seed',
    now: new Date(0),
    movies: movies.map(({ movie, keys = [] }) => ({ movie, keys })),
    screenings: [],
    reviews,
  });
}

/** Replaces the source's screenings from `from` on; also records a success at `from`. */
export async function seedScreenings(
  repo: Repository,
  sourceId: string,
  from: Date,
  screenings: ScreeningRecord[],
): Promise<void> {
  await repo.storeRefresh({ sourceId, now: from, movies: [], screenings, reviews: [] });
}

export async function findSource(repo: Repository, id: string): Promise<SourceRecord | undefined> {
  return (await repo.listSources()).find((source) => source.id === id);
}

export function movieRecord(overrides: Partial<MovieRecord> = {}): MovieRecord {
  return {
    id: 'digger-2026',
    title: 'Kasėjas',
    originalTitle: 'Digger',
    englishTitle: null,
    matchKey: 'digger',
    year: 2026,
    durationMinutes: 101,
    ageRating: 'N13',
    genres: ['drama'],
    posterUrl: 'https://cinema.lt/posters/digger.jpg',
    ...overrides,
  };
}

export function screeningRecord(overrides: Partial<ScreeningRecord> = {}): ScreeningRecord {
  return {
    id: 'apollo:1',
    sourceId: 'apollo',
    movieId: 'digger-2026',
    cinemaId: 'apollo-akropolis',
    startsAt: new Date('2026-10-30T17:00:00Z'),
    localDate: '2026-10-30',
    durationMinutes: 101,
    hall: '6 salė',
    format: 'IMAX',
    spokenLanguage: 'en',
    subtitleLanguage: 'lt',
    isDubbed: false,
    ticketUrl: 'https://www.apollokinas.lt/websales/show/1',
    sourceTitle: 'Kasėjas',
    refreshedAt: new Date('2026-10-30T10:00:00Z'),
    ...overrides,
  };
}
