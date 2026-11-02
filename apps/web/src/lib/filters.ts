import { ScreeningFormatSchema, type Screening, type ScreeningFormat } from '@seansai/shared';

/** Original language (subtitled or not), or dubbed into Lithuanian (US3). */
export type Audio = 'original' | 'dubbed';

export type Filters = {
  /** Cinema ids; empty means every cinema. */
  cinemas: string[];
  /** Empty means every format. */
  formats: ScreeningFormat[];
  audio: Audio | null;
};

export const noFilters: Filters = { cinemas: [], formats: [], audio: null };

/** 2D is the default viewing experience, so it is not a choice; only special formats are. */
const FORMATS = ScreeningFormatSchema.options.filter((format) => format !== '2D');
const AUDIO: readonly Audio[] = ['original', 'dubbed'];

/**
 * Whether a screening is in its original language. When the cinema does not say whether it is
 * dubbed, a known spoken language other than Lithuanian still counts; with neither it is unknown.
 */
function isOriginal(screening: Screening): boolean {
  if (screening.isDubbed !== null) return !screening.isDubbed;
  return screening.spokenLanguage !== null && screening.spokenLanguage !== 'lt';
}

function hasAudio(screening: Screening, audio: Audio): boolean {
  return audio === 'dubbed' ? screening.isDubbed === true : isOriginal(screening);
}

/** Screenings matching every set filter. Unknown values match only when that filter is unset. */
export function applyFilters(screenings: readonly Screening[], filters: Filters): Screening[] {
  return screenings.filter(
    (screening) =>
      (filters.cinemas.length === 0 || filters.cinemas.includes(screening.cinema.id)) &&
      (filters.formats.length === 0 ||
        (screening.format !== null && filters.formats.includes(screening.format))) &&
      (filters.audio === null || hasAudio(screening, filters.audio)),
  );
}

export function hasFilters(filters: Filters): boolean {
  return filters.cinemas.length + filters.formats.length > 0 || filters.audio !== null;
}

export function filterCount(filters: Filters): number {
  return filters.cinemas.length + filters.formats.length + (filters.audio === null ? 0 : 1);
}

export type FilterOptions = {
  /** By name. */
  cinemas: Array<{ id: string; name: string }>;
  formats: ScreeningFormat[];
  audio: Audio[];
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
    audio: AUDIO.filter(
      (audio) =>
        filters.audio === audio || screenings.some((screening) => hasAudio(screening, audio)),
    ),
  };
}

const listOf = (value: string | null) =>
  (value ?? '').split(',').filter((item) => item.trim() !== '');

/** Reads the `cinema`, `format` and `audio` parameters (web-routes.md); unknown values are ignored. */
export function parseFilters(params: URLSearchParams): Filters {
  const audio = params.get('audio');
  return {
    cinemas: listOf(params.get('cinema')),
    formats: listOf(params.get('format')).filter((format): format is ScreeningFormat =>
      (FORMATS as readonly string[]).includes(format),
    ),
    audio: AUDIO.find((value) => value === audio) ?? null,
  };
}

/** `params` with the filter parameters set from `filters`; other parameters are kept. */
export function toSearchParams(filters: Filters, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  const values = {
    cinema: filters.cinemas.join(','),
    format: filters.formats.join(','),
    audio: filters.audio ?? '',
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === '') next.delete(key);
    else next.set(key, value);
  }
  return next;
}
