import { ScreeningFormatSchema, type Screening, type ScreeningFormat } from '@seansai/shared';

/**
 * Cinema and format only. There is no language filter: most films are in the original language
 * with Lithuanian subtitles, and the cinemas' language labels are too inconsistent to filter on.
 */
export type Filters = {
  /** Cinema ids; empty means every cinema. */
  cinemas: string[];
  /** Empty means every format. */
  formats: ScreeningFormat[];
};

export const noFilters: Filters = { cinemas: [], formats: [] };

/** 2D is the default viewing experience, so it is not a choice; only special formats are. */
const FORMATS = ScreeningFormatSchema.options.filter((format) => format !== '2D');

/** Screenings matching every set filter. Unknown values match only when that filter is unset. */
export function applyFilters(screenings: readonly Screening[], filters: Filters): Screening[] {
  return screenings.filter(
    (screening) =>
      (filters.cinemas.length === 0 || filters.cinemas.includes(screening.cinema.id)) &&
      (filters.formats.length === 0 ||
        (screening.format !== null && filters.formats.includes(screening.format))),
  );
}

export function hasFilters(filters: Filters): boolean {
  return filterCount(filters) > 0;
}

export function filterCount(filters: Filters): number {
  return filters.cinemas.length + filters.formats.length;
}

export type FilterOptions = {
  /** By name. */
  cinemas: Array<{ id: string; name: string }>;
  formats: ScreeningFormat[];
};

/**
 * The choices worth offering for a list: values present in it, plus selected ones that are not
 * (after switching date), so they can still be turned off.
 */
export function filterOptions(screenings: readonly Screening[], filters: Filters): FilterOptions {
  const cinemas = new Map(screenings.map(({ cinema }) => [cinema.id, cinema.name]));
  for (const id of filters.cinemas) if (!cinemas.has(id)) cinemas.set(id, id);
  return {
    cinemas: [...cinemas]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'lt')),
    formats: FORMATS.filter(
      (format) =>
        filters.formats.includes(format) ||
        screenings.some((screening) => screening.format === format),
    ),
  };
}

const listOf = (value: string | null) =>
  (value ?? '').split(',').filter((item) => item.trim() !== '');

/**
 * Reads the `cinema` and `format` parameters (web-routes.md); unknown values are ignored, as is the
 * retired `audio` parameter of older links.
 */
export function parseFilters(params: URLSearchParams): Filters {
  return {
    cinemas: listOf(params.get('cinema')),
    formats: listOf(params.get('format')).filter((format): format is ScreeningFormat =>
      (FORMATS as readonly string[]).includes(format),
    ),
  };
}

/**
 * `params` with the filter parameters set from `filters`; other parameters are kept, except the
 * retired `audio`, which older links may still carry.
 */
export function toSearchParams(filters: Filters, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('audio');
  const values = {
    cinema: filters.cinemas.join(','),
    format: filters.formats.join(','),
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === '') next.delete(key);
    else next.set(key, value);
  }
  return next;
}
