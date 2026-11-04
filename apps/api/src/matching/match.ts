import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { MatchReviewRecord, MovieIdentity, MovieRecord } from '../db/repository.ts';
import { matchKeyOf, titleKeysOf, withoutSeriesLabel } from './normalize.ts';

/** The movie details one source listing carries. */
export type Listing = {
  title: string;
  originalTitle: string | null;
  englishTitle: string | null;
  year: number | null;
  durationMinutes: number | null;
  ageRating: string | null;
  genres: string[];
  posterUrl: string | null;
};

const AliasSchema = z.object({
  matchKey: z.string().min(1),
  movieIdA: z.string().min(1),
  movieIdB: z.string().min(1),
  resolution: z.enum(['merge', 'keep-separate']),
});
export type Alias = z.infer<typeof AliasSchema>;

/** The maintainer's decisions on pairs from the match-review log (versioned in the repo). */
export function loadAliases(path = new URL('./aliases.json', import.meta.url)): Alias[] {
  return z.array(AliasSchema).parse(JSON.parse(readFileSync(path, 'utf8')));
}

export type MatchReview = Omit<MatchReviewRecord, 'firstSeenAt'>;

export type Resolution = {
  /** The movie this listing belongs to: an existing one, or a new one to create. */
  movie: MovieRecord;
  /** The listing's titles, to remember on the movie so later listings can match on them. */
  keys: string[];
  /** Uncertain pairs to log for the maintainer (FR-005). */
  reviews: MatchReview[];
};

/** Cinemas list running times with or without ads and trailers: Vue's run 11–13 minutes shorter than Apollo's. */
const DURATION_TOLERANCE_MINUTES = 15;

/**
 * Ids must fit in an address and be a file name in the page snapshot, which allows 255 bytes. Any
 * real title fits: the longest so far is 102 characters. An id's length is also the router's limit
 * on path parameters, so every movie can be reached.
 */
export const MAX_MOVIE_ID_BYTES = 200;
const HASH_LENGTH = 8;
/** For a title with no letters or digits, such as "???", whose match key is empty. */
const UNNAMED_MOVIE_SLUG = 'be-pavadinimo';

/** Stable, URL-friendly id from match key and year, e.g. `digger-2026`. */
export function movieIdOf(matchKey: string, year: number | null): string {
  const slug = matchKey === '' ? UNNAMED_MOVIE_SLUG : matchKey.replaceAll(' ', '-');
  const id = year === null ? slug : `${slug}-${String(year)}`;
  if (Buffer.byteLength(id) <= MAX_MOVIE_ID_BYTES) return id;

  // Cut by whole letters, with a hash of the whole id so two long titles stay two movies.
  const hash = createHash('sha256').update(id).digest('hex').slice(0, HASH_LENGTH);
  const letters = Array.from(id);
  while (Buffer.byteLength(letters.join('')) > MAX_MOVIE_ID_BYTES - HASH_LENGTH - 1) letters.pop();
  return `${letters.join('').replace(/-+$/, '')}-${hash}`;
}

/** What can contradict a shared title: a listing's or a movie's year and running time. */
type FilmFacts = Pick<Listing, 'year' | 'durationMinutes'>;

/**
 * For two listings that share a title (research.md §5): known production years must be equal, or
 * one apart with both running times known and within 15 minutes, as cinemas date a film by its
 * premiere or its release here. When a year is missing, known durations must be within 15 minutes.
 * Nothing known to contradict the shared title (e.g. Romuva publishes only titles) counts as a
 * match, because the same movie appearing twice is the more common mistake.
 */
function isConfidentMatch(a: FilmFacts, b: FilmFacts): boolean {
  const durationGap =
    a.durationMinutes === null || b.durationMinutes === null
      ? null
      : Math.abs(a.durationMinutes - b.durationMinutes);
  const durationsAgree = durationGap !== null && durationGap <= DURATION_TOLERANCE_MINUTES;
  if (a.year !== null && b.year !== null) {
    return a.year === b.year || (Math.abs(a.year - b.year) === 1 && durationsAgree);
  }
  return durationGap === null || durationsAgree;
}

function conflictReason(listing: Listing, candidate: MovieIdentity): string {
  if (listing.year !== null && candidate.year !== null) {
    return `year ${String(candidate.year)} vs ${String(listing.year)}`;
  }
  const duration = (minutes: number | null) =>
    minutes === null ? 'unknown' : `${String(minutes)} min`;
  return `year ${String(candidate.year ?? 'missing')} vs ${String(listing.year ?? 'missing')}, duration ${duration(candidate.durationMinutes)} vs ${duration(listing.durationMinutes)}`;
}

function findAlias(aliases: readonly Alias[], idA: string, idB: string): Alias | undefined {
  return aliases.find(
    (alias) =>
      (alias.movieIdA === idA && alias.movieIdB === idB) ||
      (alias.movieIdA === idB && alias.movieIdB === idA),
  );
}

/**
 * Whether existing movies are one film: every pair is merged by an alias, or shares a title with
 * nothing contradicting it. A listing linking two titles isn't enough to merge movies (FR-005).
 */
function areOneFilm(movies: readonly MovieIdentity[], aliases: readonly Alias[]): boolean {
  return movies.every((a, index) =>
    movies.slice(index + 1).every((b) => {
      const alias = findAlias(aliases, a.id, b.id);
      if (alias) return alias.resolution === 'merge';
      return a.keys.some((key) => b.keys.includes(key)) && isConfidentMatch(a, b);
    }),
  );
}

/** Dated first, then the latest year. Depends only on the movies, so every listing agrees. */
function byPreference(a: MovieIdentity, b: MovieIdentity): number {
  return (b.year ?? 0) - (a.year ?? 0) || a.id.localeCompare(b.id);
}

/**
 * Decides which movie a listing belongs to: an existing movie that shares one of its titles
 * (English, original or Lithuanian) and does not contradict it, else a new movie named after its
 * English title when known. Conflicts and ambiguities become a separate movie and are logged
 * for review (FR-005).
 */
export function resolveMovie(
  listing: Listing,
  existingMovies: readonly MovieIdentity[],
  aliases: readonly Alias[],
): Resolution {
  const matchKey = matchKeyOf(listing);
  const keys = titleKeysOf(listing);
  const ownId = movieIdOf(matchKey, listing.year);
  const fromListing: MovieRecord = {
    id: ownId,
    title: withoutSeriesLabel(listing.title),
    originalTitle: listing.originalTitle && withoutSeriesLabel(listing.originalTitle),
    englishTitle: listing.englishTitle && withoutSeriesLabel(listing.englishTitle),
    matchKey,
    year: listing.year,
    durationMinutes: listing.durationMinutes,
    ageRating: listing.ageRating,
    genres: listing.genres,
    posterUrl: listing.posterUrl,
  };
  const joinExisting = (target: MovieIdentity): Resolution => ({
    movie: { ...fromListing, id: target.id, matchKey: target.matchKey, year: target.year },
    keys,
    reviews: [],
  });

  const candidates = existingMovies.filter(
    (movie) => movie.id === ownId || movie.keys.some((key) => keys.includes(key)),
  );
  const own = candidates.find((movie) => movie.id === ownId);

  const merged: MovieIdentity[] = [];
  const confident: MovieIdentity[] = [];
  const conflicting: MovieIdentity[] = [];
  for (const candidate of candidates) {
    if (candidate === own) continue;
    const alias = findAlias(aliases, ownId, candidate.id);
    if (alias?.resolution === 'merge') merged.push(candidate);
    else if (alias?.resolution === 'keep-separate') continue;
    else (isConfidentMatch(listing, candidate) ? confident : conflicting).push(candidate);
  }

  // An alias outranks the rules. Movies that turn out to be one film come together under the
  // preferred one, which empties the others until the daily cleanup removes them.
  const sameFilm = [...(own ? [own] : []), ...(merged.length > 0 ? merged : confident)];
  const [preferred] = sameFilm.toSorted(byPreference);
  if (preferred && areOneFilm(sameFilm, aliases)) return joinExisting(preferred);
  if (own) return joinExisting(own);

  const reviews: MatchReview[] = [
    ...conflicting.map((candidate) => ({
      matchKey,
      movieIdA: candidate.id,
      movieIdB: ownId,
      reason: conflictReason(listing, candidate),
    })),
    ...confident.map((candidate) => ({
      matchKey,
      movieIdA: candidate.id,
      movieIdB: ownId,
      reason: 'matches more than one movie',
    })),
  ];
  return { movie: fromListing, keys, reviews };
}
