import { z } from 'zod';
import type {
  MovieIdentity,
  Repository,
  ScreeningRecord,
  SourceRefresh,
} from '../db/repository.ts';
import type { Logger } from '../lib/logger.ts';
import type { HttpClient } from '../lib/polite-http.ts';
import { localDateOf } from '../lib/time.ts';
import { resolveMovie, type Alias, type MatchReview } from '../matching/match.ts';
import type { CinemaRegistry } from '../registry/cinemas.ts';
import { lastListedDate } from '../sources/horizon.ts';
import {
  SourceScreeningSchema,
  type SourceAdapter,
  type SourceScreening,
} from '../sources/types.ts';

export type RefreshContext = {
  repo: Repository;
  registry: CinemaRegistry;
  http: HttpClient;
  now: Date;
  /** The adapter's clock when it differs from `now` (fixture mode replays each capture). */
  sourceNow?: Date;
  aliases: readonly Alias[];
  logger: Logger;
  /** Kill switch (DISABLED_SOURCES): these sources are not refreshed at all. */
  disabledSources: readonly string[];
};

export type RefreshOutcome =
  | { status: 'success'; stored: number; skipped: number; newReviews: number }
  | { status: 'failed'; error: string }
  | { status: 'disabled' };

const ResultSchema = z.array(SourceScreeningSchema);

/** Thrown when an adapter's output does not match the SourceScreening contract. */
class InvalidAdapterOutputError extends Error {
  override readonly name = 'InvalidAdapterOutputError';
}

function validateScreenings(screenings: unknown): SourceScreening[] {
  const result = ResultSchema.safeParse(screenings);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const [index, ...field] = issue?.path ?? [];
  throw new InvalidAdapterOutputError(
    `Invalid adapter output at screenings[${String(index)}].${field.join('.')}: ${issue?.message ?? 'invalid'}`,
  );
}

/**
 * One refresh of one source: run the adapter, validate its output, keep the listed days (today
 * through today + 90, horizon.ts), match each listing to a movie and replace the source's future
 * screenings. Any failure keeps the source's previous data and is
 * recorded, so the UI can flag the cinema once its data gets old (FR-015).
 */
export async function refreshSource(
  adapter: SourceAdapter,
  ctx: RefreshContext,
): Promise<RefreshOutcome> {
  const { repo, registry, now, logger } = ctx;
  const source = adapter.id;
  if (ctx.disabledSources.includes(source)) {
    logger.info({ source }, 'Source disabled by DISABLED_SOURCES; not refreshed');
    return { status: 'disabled' };
  }

  // Reserved before fetching, so sources store in the order they started and the result does not
  // depend on which cinema answered first: the first listing of a film sets its id and matching
  // details. One at a time from reading the movies to storing them, or two sources listing a new
  // film at once would each miss the other's and create it twice, for good. Fetching stays parallel.
  const turn = repo.reserveTurn();
  try {
    ctx.http.beginCycle();
    const result = await adapter.fetchScreenings({
      now: ctx.sourceNow ?? now,
      http: ctx.http,
      registry,
    });
    const lastDate = lastListedDate(ctx.sourceNow ?? now);
    const published = validateScreenings(result.screenings);
    const screenings = published.filter((screening) => localDateOf(screening.startsAt) <= lastDate);
    if (screenings.length < published.length) {
      logger.debug(
        { source, dropped: published.length - screenings.length, lastDate },
        'Dropped screenings beyond the listed days',
      );
    }

    const known = screenings.filter((screening) => registry.get(screening.cinemaId) !== undefined);
    for (const screening of screenings) {
      if (registry.get(screening.cinemaId) === undefined) {
        logger.warn(
          { source, cinemaId: screening.cinemaId, title: screening.title },
          'Dropped a screening at a cinema missing from the registry',
        );
      }
    }
    for (const item of result.skipped) {
      logger.debug({ source, reason: item.reason, raw: item.raw }, 'Adapter skipped an item');
    }

    const { newReviews } = await turn.run(async () => {
      const { movies, records, reviews } = matchScreenings(
        source,
        known,
        await repo.listMovieIdentities(),
        ctx,
      );
      return repo.storeRefresh({ sourceId: source, now, movies, screenings: records, reviews });
    });

    const outcome = {
      status: 'success' as const,
      stored: known.length,
      skipped: result.skipped.length + (screenings.length - known.length),
      newReviews,
    };
    logger.info({ source, ...outcome }, 'Source refreshed');
    return outcome;
  } catch (error) {
    turn.skip();
    const message = error instanceof Error ? error.message : String(error);
    await repo.recordSourceAttempt(source, now, message);
    logger.error({ source, err: error }, 'Source refresh failed; previous data kept');
    return { status: 'failed', error: message };
  }
}

/**
 * Matches each screening to a movie, in memory: the movies to write (in listing order), the
 * screening records and the uncertain matches found. Nothing is written here.
 */
function matchScreenings(
  source: string,
  screenings: readonly SourceScreening[],
  identities: MovieIdentity[],
  ctx: RefreshContext,
): Pick<SourceRefresh, 'movies' | 'reviews'> & { records: ScreeningRecord[] } {
  const { now, aliases } = ctx;
  const movies: SourceRefresh['movies'] = [];
  const reviews: MatchReview[] = [];
  const records: ScreeningRecord[] = screenings.map((screening) => {
    const resolution = resolveMovie(screening, identities, aliases);
    const { movie, keys } = resolution;
    movies.push({ movie, keys });
    // Later listings in this refresh can match on the titles just learned.
    const known = identities.find((existing) => existing.id === movie.id);
    if (known) known.keys = [...new Set([...known.keys, ...keys])];
    else identities.push({ ...movie, keys: [...new Set([movie.matchKey, ...keys])] });
    reviews.push(...resolution.reviews);
    return {
      id: `${source}:${screening.sourceScreeningId}`,
      sourceId: source,
      movieId: movie.id,
      cinemaId: screening.cinemaId,
      startsAt: screening.startsAt,
      localDate: localDateOf(screening.startsAt),
      durationMinutes: screening.durationMinutes,
      hall: screening.hall,
      format: screening.format,
      spokenLanguage: screening.spokenLanguage,
      subtitleLanguage: screening.subtitleLanguage,
      isDubbed: screening.isDubbed,
      ticketUrl: screening.ticketUrl,
      sourceTitle: screening.title,
      refreshedAt: now,
    };
  });
  return { movies, records, reviews };
}
