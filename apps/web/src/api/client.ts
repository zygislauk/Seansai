import {
  CitiesResponseSchema,
  ErrorResponseSchema,
  MovieDetailResponseSchema,
  MoviesResponseSchema,
  ScreeningsResponseSchema,
  type CitiesResponse,
  type ErrorCode,
  type Lang,
  type MovieDetailResponse,
  type MoviesResponse,
  type ScreeningsResponse,
} from '@seansai/shared';
import type { z } from 'zod';

const API_BASE = '/api/v1';

/** `network_error`: the request never got an answer (offline, server down). */
export type ApiErrorCode = ErrorCode | 'network_error';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  /** HTTP status, or null when no response arrived. */
  readonly status: number | null;
  readonly code: ApiErrorCode;

  constructor(status: number | null, code: ApiErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const url = `${API_BASE}${path}?${new URLSearchParams(params).toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: signal ?? null,
    });
  } catch (error) {
    // A cancelled query is not an error worth reporting; let TanStack Query see the abort.
    if (signal?.aborted) throw error;
    throw new ApiError(null, 'network_error', `Could not reach the server (${url})`, {
      cause: error,
    });
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(body);
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(
          response.status,
          'internal_error',
          `HTTP ${String(response.status)} from ${url}`,
        );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(response.status, 'internal_error', `Unexpected response from ${url}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

const moviePath = (movieId: string) => `/movies/${encodeURIComponent(movieId)}`;

export function getCities(lang: Lang, signal?: AbortSignal): Promise<CitiesResponse> {
  return request('/cities', { lang }, CitiesResponseSchema, signal);
}

export function getMovies(city: string, signal?: AbortSignal): Promise<MoviesResponse> {
  return request('/movies', { city }, MoviesResponseSchema, signal);
}

export function getMovie(
  movieId: string,
  city: string,
  lang: Lang,
  signal?: AbortSignal,
): Promise<MovieDetailResponse> {
  return request(moviePath(movieId), { city, lang }, MovieDetailResponseSchema, signal);
}

/** `date` null asks for today as the server sees it; the response says which date that is. */
export function getScreenings(
  movieId: string,
  city: string,
  date: string | null,
  signal?: AbortSignal,
): Promise<ScreeningsResponse> {
  return request(
    `${moviePath(movieId)}/screenings`,
    date === null ? { city } : { city, date },
    ScreeningsResponseSchema,
    signal,
  );
}
