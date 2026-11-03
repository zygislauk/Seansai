import type { MovieDetailResponse, MovieSummary, MoviesResponse } from '@seansai/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cinemaSummary, collator, type Queries } from '../db/queries.ts';
import type { MovieRecord } from '../db/repository.ts';
import { todayIn } from '../lib/time.ts';
import { ApiError, citySchema, langSchema, parseQuery, setListCaching } from './http.ts';

type MoviesRouteOptions = { queries: Queries; now: () => Date };

export function movieSummary(movie: MovieRecord): MovieSummary {
  return {
    id: movie.id,
    title: movie.title,
    originalTitle: movie.originalTitle,
    englishTitle: movie.englishTitle,
    posterUrl: movie.posterUrl,
    ageRating: movie.ageRating,
    durationMinutes: movie.durationMinutes,
  };
}

/**
 * Movie ids are slugs of a normalised title and a year: letters and digits joined by hyphens.
 * Over-long ones never reach this route (`maxParamLength`): the answer is 414, or 404 from the
 * catch-all when the web app is served too.
 */
const MovieIdSchema = z.string().regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u);

/** The movie, or a 404 `movie_not_found` (also for ids that cannot be movie ids). */
export async function findMovie(queries: Queries, movieId: string): Promise<MovieRecord> {
  const movie = MovieIdSchema.safeParse(movieId).success
    ? await queries.getMovie(movieId)
    : undefined;
  if (!movie) throw new ApiError(404, 'movie_not_found', 'There is no movie with this id.');
  return movie;
}

export const moviesRoutes: FastifyPluginAsync<MoviesRouteOptions> = (app, { queries, now }) => {
  const QuerySchema = z.object({ city: citySchema((city) => queries.isCity(city)) });
  const DetailQuerySchema = QuerySchema.extend({ lang: langSchema });
  const codes = { city: 'invalid_city' } as const;

  /** The "currently showing" list for a city, ordered as FR-003 requires. */
  app.get('/movies', async (request, reply): Promise<MoviesResponse> => {
    const { city } = parseQuery(QuerySchema, request.query, codes);
    const at = now();
    const cinemas = queries.cinemasIn(city);
    const [listings, freshness] = await Promise.all([
      queries.listMovies(cinemas, todayIn(at), at),
      queries.freshness(cinemas, at),
    ]);
    setListCaching(reply);
    return {
      movies: listings.map((listing) => ({
        movie: movieSummary(listing.movie),
        screeningsToday: listing.screeningsToday,
        firstDate: listing.firstDate,
      })),
      freshness,
    };
  });

  /** Movie details plus when (US2) and where it has screenings in the city. */
  app.get<{ Params: { movieId: string } }>(
    '/movies/:movieId',
    async (request, reply): Promise<MovieDetailResponse> => {
      const { city, lang } = parseQuery(DetailQuerySchema, request.query, codes);
      const movie = await findMovie(queries, request.params.movieId);
      const at = now();
      const cinemas = queries.cinemasIn(city);
      const [screeningDates, availableDates, showing] = await Promise.all([
        queries.screeningDates(movie.id, cinemas, at),
        queries.availableDates(todayIn(at)),
        queries.cinemasShowing(movie.id, cinemas, at),
      ]);
      setListCaching(reply);
      return {
        movie: { ...movieSummary(movie), genres: movie.genres, year: movie.year },
        screeningDates,
        availableDates,
        showingAt: showing
          .map((cinema) => cinemaSummary(cinema, lang))
          .sort(
            (a, b) => collator.compare(a.cityName, b.cityName) || collator.compare(a.name, b.name),
          ),
      };
    },
  );
  return Promise.resolve();
};
