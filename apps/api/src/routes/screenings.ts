import { DateSchema, type ScreeningsResponse } from '@seansai/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cinemaSummary, type Queries } from '../db/queries.ts';
import { formatInstant, todayIn } from '../lib/time.ts';
import { ApiError, citySchema, langSchema, parseQuery, setListCaching } from './http.ts';
import { findMovie } from './movies.ts';

type ScreeningsRouteOptions = { queries: Queries; now: () => Date };

/** All screenings of a movie on one date in a city, as one timeline (FR-006, FR-007). */
export const screeningsRoutes: FastifyPluginAsync<ScreeningsRouteOptions> = (
  app,
  { queries, now },
) => {
  const QuerySchema = z.object({
    city: citySchema((city) => queries.isCity(city)),
    /** Omitted means today, so a client can ask before it knows the server's date. */
    date: DateSchema.optional(),
    lang: langSchema,
  });

  app.get<{ Params: { movieId: string } }>(
    '/movies/:movieId/screenings',
    async (request, reply): Promise<ScreeningsResponse> => {
      const query = parseQuery(QuerySchema, request.query, {
        city: 'invalid_city',
        date: 'invalid_date',
      });
      const { city, lang } = query;
      const at = now();
      const date = query.date ?? todayIn(at);
      if (!(await queries.availableDates(todayIn(at))).includes(date)) {
        throw new ApiError(
          400,
          'invalid_date',
          'date must be between today and the last published date',
        );
      }
      const movie = await findMovie(queries, request.params.movieId);
      const cinemas = queries.cinemasIn(city);
      const [screenings, freshness] = await Promise.all([
        queries.listScreenings(movie.id, cinemas, date, at),
        queries.freshness(cinemas, at),
      ]);
      const nextDateWithScreenings =
        screenings.length === 0
          ? await queries.nextDateWithScreenings(movie.id, cinemas, date, at)
          : null;
      setListCaching(reply);
      return {
        date,
        screenings: screenings.map(({ cinema, startsAt, ...screening }) => ({
          ...screening,
          startsAt: formatInstant(startsAt),
          cinema: cinemaSummary(cinema, lang),
        })),
        nextDateWithScreenings,
        freshness,
      };
    },
  );
  return Promise.resolve();
};
