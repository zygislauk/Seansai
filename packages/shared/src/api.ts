import { z } from 'zod';

/** Calendar date in Europe/Vilnius, `YYYY-MM-DD`. */
export const DateSchema = z.iso.date();

/** Exact instant, ISO 8601 with offset, e.g. `2026-10-30T21:35:00+02:00`. */
export const InstantSchema = z.iso.datetime({ offset: true });

export const LangSchema = z.enum(['lt', 'en']);
export type Lang = z.infer<typeof LangSchema>;

export const ScreeningFormatSchema = z.enum(['IMAX', '4DX', 'ScreenX', 'other']);
export type ScreeningFormat = z.infer<typeof ScreeningFormatSchema>;

export const FreshnessSchema = z.object({
  /** Oldest `lastSuccessAt` among the cinemas included in the response. */
  updatedAt: InstantSchema,
  /** Cinemas without a successful refresh for 3 hours or more (FR-015). */
  staleCinemas: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      lastSuccessAt: InstantSchema.nullable(),
    }),
  ),
});
export type Freshness = z.infer<typeof FreshnessSchema>;

export const MovieSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  originalTitle: z.string().nullable(),
  /** When a cinema states it; shown under the Lithuanian title. */
  englishTitle: z.string().nullable(),
  posterUrl: z.string().nullable(),
  ageRating: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
});
export type MovieSummary = z.infer<typeof MovieSummarySchema>;

export const MovieDetailSchema = MovieSummarySchema.extend({
  genres: z.array(z.string()),
  year: z.number().int().nullable(),
});
export type MovieDetail = z.infer<typeof MovieDetailSchema>;

export const ScreeningSchema = z.object({
  id: z.string(),
  startsAt: InstantSchema,
  cinema: z.object({
    id: z.string(),
    name: z.string(),
    cityId: z.string(),
    cityName: z.string(),
  }),
  hall: z.string().nullable(),
  format: ScreeningFormatSchema.nullable(),
  /** ISO 639-1 */
  spokenLanguage: z.string().nullable(),
  /** ISO 639-1 */
  subtitleLanguage: z.string().nullable(),
  isDubbed: z.boolean().nullable(),
  ticketUrl: z.string(),
});
export type Screening = z.infer<typeof ScreeningSchema>;

export const CitiesResponseSchema = z.object({
  cities: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      cinemaCount: z.number().int(),
    }),
  ),
});
export type CitiesResponse = z.infer<typeof CitiesResponseSchema>;

export const MoviesResponseSchema = z.object({
  movies: z.array(
    z.object({
      movie: MovieSummarySchema,
      screeningsToday: z.number().int(),
      firstDate: DateSchema,
    }),
  ),
  freshness: FreshnessSchema,
});
export type MoviesResponse = z.infer<typeof MoviesResponseSchema>;

export const MovieDetailResponseSchema = z.object({
  movie: MovieDetailSchema,
  screeningDates: z.array(DateSchema),
  availableDates: z.array(DateSchema),
});
export type MovieDetailResponse = z.infer<typeof MovieDetailResponseSchema>;

export const ScreeningsResponseSchema = z.object({
  date: DateSchema,
  screenings: z.array(ScreeningSchema),
  /** Set only when `screenings` is empty. */
  nextDateWithScreenings: DateSchema.nullable(),
  freshness: FreshnessSchema,
});
export type ScreeningsResponse = z.infer<typeof ScreeningsResponseSchema>;

export const SourceStatusSchema = z.enum(['healthy', 'degraded', 'stale']);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  sources: z.array(
    z.object({
      id: z.string(),
      status: SourceStatusSchema,
      lastSuccessAt: InstantSchema.nullable(),
    }),
  ),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ErrorCodeSchema = z.enum([
  'invalid_city',
  'invalid_date',
  'movie_not_found',
  'not_found',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
