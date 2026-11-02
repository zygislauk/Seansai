import type { CinemaSummary, Freshness, Lang, ScreeningFormat } from '@seansai/shared';
import { addDays, formatInstant } from '../lib/time.ts';
import { deriveSourceStatus } from '../refresh/status.ts';
import type { Cinema, CinemaRegistry } from '../registry/cinemas.ts';
import { cities, findCity, type City } from '../registry/cities.ts';
import type { Db } from './index.ts';
import { Repository, toMovieRecord, type MovieRecord, type MovieRow } from './repository.ts';

/**
 * Read queries behind the public API. Every query is bounded by a set of cinemas (one city, or
 * all of them) and filters out screenings that already started (FR-007). Cinema ids are passed
 * as a JSON array so each statement's SQL is the same whatever the cinemas.
 */

export type MovieListing = { movie: MovieRecord; screeningsToday: number; firstDate: string };

export type ScreeningListing = {
  id: string;
  startsAt: Date;
  cinema: Cinema;
  hall: string | null;
  format: ScreeningFormat | null;
  spokenLanguage: string | null;
  subtitleLanguage: string | null;
  isDubbed: boolean | null;
  ticketUrl: string;
};

type ScreeningRow = {
  id: string;
  cinema_id: string;
  starts_at: string;
  hall: string | null;
  format: ScreeningFormat | null;
  spoken_language: string | null;
  subtitle_language: string | null;
  is_dubbed: number | null;
  ticket_url: string;
};

type QueriesOptions = {
  db: Db;
  registry: CinemaRegistry;
  /** Sources whose cinemas are shown; a disabled source's cinemas disappear entirely. */
  sourceIds: readonly string[];
  /** Age after which a cinema's data is flagged as stale. */
  staleAfterMs: number;
};

export const collator = new Intl.Collator('lt');
const IN_CINEMAS = 'cinema_id IN (SELECT value FROM json_each(@cinemaIds))';

const SQL = {
  movies: `
    SELECT movies.*, listed.screenings_today, listed.first_date
    FROM (
      -- Grouped before the join, so each movie is looked up once and not once per screening.
      SELECT movie_id, SUM(local_date = @today) AS screenings_today, MIN(local_date) AS first_date
      FROM screenings
      WHERE ${IN_CINEMAS} AND starts_at > @now
      GROUP BY movie_id
    ) AS listed
    JOIN movies ON movies.id = listed.movie_id`,
  movie: 'SELECT * FROM movies WHERE id = ?',
  screeningDates: `
    SELECT DISTINCT local_date FROM screenings
    WHERE movie_id = @movieId AND ${IN_CINEMAS} AND starts_at > @now
    ORDER BY local_date`,
  cinemasShowing: `
    SELECT DISTINCT cinema_id FROM screenings
    WHERE movie_id = @movieId AND ${IN_CINEMAS} AND starts_at > @now`,
  lastDate: 'SELECT MAX(local_date) AS last_date FROM screenings',
  screenings: `
    SELECT id, cinema_id, starts_at, hall, format, spoken_language, subtitle_language,
           is_dubbed, ticket_url
    FROM screenings
    WHERE movie_id = @movieId AND local_date = @date AND ${IN_CINEMAS} AND starts_at > @now
    ORDER BY starts_at`,
  nextDate: `
    SELECT MIN(local_date) AS next_date FROM screenings
    WHERE movie_id = @movieId AND local_date > @date AND ${IN_CINEMAS} AND starts_at > @now`,
} as const;

export class Queries {
  readonly #db: Db;
  readonly #repo: Repository;
  readonly #cinemas: readonly Cinema[];
  readonly #staleAfterMs: number;

  constructor({ db, registry, sourceIds, staleAfterMs }: QueriesOptions) {
    this.#db = db;
    this.#repo = new Repository(db);
    this.#cinemas = registry.all().filter((cinema) => sourceIds.includes(cinema.sourceId));
    this.#staleAfterMs = staleAfterMs;
  }

  /** Cinemas in a city, or in every city for `all`. */
  cinemasIn(city: string): Cinema[] {
    return this.#cinemas.filter((cinema) => city === 'all' || cinema.cityId === city);
  }

  /** Cities with at least one shown cinema (the city prompt, FR-013). */
  listCities(): Array<{ city: City; cinemaCount: number }> {
    return cities
      .map((city) => ({ city, cinemaCount: this.cinemasIn(city.id).length }))
      .filter((entry) => entry.cinemaCount > 0);
  }

  isCity(city: string): boolean {
    return city === 'all' || this.cinemasIn(city).length > 0;
  }

  /**
   * The "currently showing" list (FR-003): movies with screenings left today first, most
   * screenings first and ties by title; then movies starting later, by first date and title.
   */
  async listMovies(cinemas: readonly Cinema[], today: string, now: Date): Promise<MovieListing[]> {
    const { rows } = await this.#db.execute({
      sql: SQL.movies,
      args: { ...this.#bounds(cinemas, now), today },
    });
    return (rows as unknown as Array<MovieRow & { screenings_today: number; first_date: string }>)
      .map((row) => ({
        movie: toMovieRecord(row),
        screeningsToday: row.screenings_today,
        firstDate: row.first_date,
      }))
      .sort((a, b) => {
        const todayFirst = Number(b.screeningsToday > 0) - Number(a.screeningsToday > 0);
        if (todayFirst !== 0) return todayFirst;
        if (a.screeningsToday > 0) {
          if (a.screeningsToday !== b.screeningsToday) return b.screeningsToday - a.screeningsToday;
        } else if (a.firstDate !== b.firstDate) {
          return a.firstDate < b.firstDate ? -1 : 1;
        }
        return collator.compare(a.movie.title, b.movie.title);
      });
  }

  async getMovie(id: string): Promise<MovieRecord | undefined> {
    const { rows } = await this.#db.execute({ sql: SQL.movie, args: [id] });
    const row = rows[0] as unknown as MovieRow | undefined;
    return row ? toMovieRecord(row) : undefined;
  }

  /** Dates on which the movie still has screenings in these cinemas. */
  async screeningDates(movieId: string, cinemas: readonly Cinema[], now: Date): Promise<string[]> {
    const { rows } = await this.#db.execute({
      sql: SQL.screeningDates,
      args: { ...this.#bounds(cinemas, now), movieId },
    });
    return (rows as unknown as Array<{ local_date: string }>).map((row) => row.local_date);
  }

  /** Which of these cinemas still have a screening of the movie. */
  async cinemasShowing(movieId: string, cinemas: readonly Cinema[], now: Date): Promise<Cinema[]> {
    const { rows } = await this.#db.execute({
      sql: SQL.cinemasShowing,
      args: { ...this.#bounds(cinemas, now), movieId },
    });
    const showing = new Set(
      (rows as unknown as Array<{ cinema_id: string }>).map((row) => row.cinema_id),
    );
    return cinemas.filter((cinema) => showing.has(cinema.id));
  }

  /** Today up to the furthest date any cinema has published (FR-010). */
  async availableDates(today: string): Promise<string[]> {
    const { rows } = await this.#db.execute(SQL.lastDate);
    const lastDate =
      (rows[0] as unknown as { last_date: string | null } | undefined)?.last_date ?? null;
    const dates = [today];
    while (lastDate !== null && (dates.at(-1) ?? today) < lastDate) {
      dates.push(addDays(dates.at(-1) ?? today, 1));
    }
    return dates;
  }

  /** The movie's screenings on `date` as one timeline: by start time, ties by cinema name. */
  async listScreenings(
    movieId: string,
    cinemas: readonly Cinema[],
    date: string,
    now: Date,
  ): Promise<ScreeningListing[]> {
    const byId = new Map(cinemas.map((cinema) => [cinema.id, cinema]));
    const { rows } = await this.#db.execute({
      sql: SQL.screenings,
      args: { ...this.#bounds(cinemas, now), movieId, date },
    });
    return (rows as unknown as ScreeningRow[])
      .flatMap((row) => {
        const cinema = byId.get(row.cinema_id);
        if (!cinema) return [];
        return [
          {
            id: row.id,
            startsAt: new Date(row.starts_at),
            cinema,
            hall: row.hall,
            format: row.format,
            spokenLanguage: row.spoken_language,
            subtitleLanguage: row.subtitle_language,
            isDubbed: row.is_dubbed === null ? null : row.is_dubbed === 1,
            ticketUrl: row.ticket_url,
          },
        ];
      })
      .sort(
        (a, b) =>
          a.startsAt.getTime() - b.startsAt.getTime() ||
          collator.compare(a.cinema.name, b.cinema.name),
      );
  }

  /** The first date after `date` with screenings of the movie (US1 scenario 6). */
  async nextDateWithScreenings(
    movieId: string,
    cinemas: readonly Cinema[],
    date: string,
    now: Date,
  ): Promise<string | null> {
    const { rows } = await this.#db.execute({
      sql: SQL.nextDate,
      args: { ...this.#bounds(cinemas, now), movieId, date },
    });
    return (rows[0] as unknown as { next_date: string | null } | undefined)?.next_date ?? null;
  }

  /**
   * How current the data for these cinemas is: the oldest successful refresh among their
   * sources, and the cinemas without one within the stale threshold (FR-014, FR-015).
   */
  async freshness(cinemas: readonly Cinema[], now: Date): Promise<Freshness> {
    // One query for every source, however many cinemas are listed.
    const sources = new Map(
      (await this.#repo.listSources()).map((source) => [source.id, source] as const),
    );
    const successes = [...new Set(cinemas.map((cinema) => cinema.sourceId))]
      .map((id) => sources.get(id)?.lastSuccessAt?.getTime())
      .filter((time) => time !== undefined);
    const oldest = successes.length > 0 ? new Date(Math.min(...successes)) : now;
    return {
      updatedAt: formatInstant(oldest),
      staleCinemas: cinemas
        .filter(
          (cinema) =>
            deriveSourceStatus(sources.get(cinema.sourceId), now, this.#staleAfterMs) === 'stale',
        )
        .map((cinema) => {
          const lastSuccessAt = sources.get(cinema.sourceId)?.lastSuccessAt;
          return {
            id: cinema.id,
            name: cinema.name,
            lastSuccessAt: lastSuccessAt ? formatInstant(lastSuccessAt) : null,
          };
        }),
    };
  }

  #bounds(cinemas: readonly Cinema[], now: Date) {
    return {
      cinemaIds: JSON.stringify(cinemas.map((cinema) => cinema.id)),
      now: now.toISOString(),
    };
  }
}

export function cityName(city: City, lang: Lang): string {
  return lang === 'en' ? city.nameEn : city.nameLt;
}

export function cinemaSummary(cinema: Cinema, lang: Lang): CinemaSummary {
  const city = findCity(cinema.cityId);
  return {
    id: cinema.id,
    name: cinema.name,
    cityId: cinema.cityId,
    cityName: city ? cityName(city, lang) : cinema.cityId,
  };
}
