import { z } from 'zod';
import { SourceRequestError, SourceResponseError } from '../../lib/errors.ts';
import type { HttpClient } from '../../lib/polite-http.ts';
import { addDays, todayIn } from '../../lib/time.ts';
import { DAYS_AHEAD } from '../horizon.ts';
import { ageRatingOf, formatOf, languageOf } from '../parse.ts';
import type { AdapterContext, AdapterResult, SourceAdapter, SourceScreening } from '../types.ts';

/**
 * Forum Cinemas (Vingis, Kaunas, Klaipėda, Šiauliai): the REST API that forumcinemas.lt itself
 * calls (its `config.json` names `https://restapi.forumcinemas.lt/api`). Per cycle: the regions,
 * each region's screenings for the listed days (horizon.ts), the movie list once (plus any movie missing from it),
 * and each cinema's hall names at most once a day, because that answer carries full seat maps.
 *
 * The feed gives no ticket link; the site opens a screening at `/lt/ekranas/?id=…&cid=…`.
 */
const API = 'https://restapi.forumcinemas.lt/api';
const SITE = 'https://forumcinemas.lt';
const HALLS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const RegionsSchema = z.array(z.object({ id: z.string().min(1) }));
const ItemsSchema = z.array(z.unknown());

const ScreeningSchema = z.object({
  id: z.string().min(1),
  cinemaId: z.string().min(1),
  screenId: z.string().nullish(),
  movieId: z.string().min(1),
  screeningTimeFrom: z.iso.datetime({ offset: true }),
  printType: z.string().nullish(),
  /** "ORG" (original language) or "DUB" (dubbed). */
  speakingType: z.string().nullish(),
  language: z.string().nullish(),
  subtitles: z.string().nullish(),
});
type Screening = z.infer<typeof ScreeningSchema>;

const MovieSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  originalTitle: z.string().nullish(),
  yearOfProduction: z.string().nullish(),
  duration: z.number().nullish(),
  genres: z.array(z.object({ name: z.string() })).default([]),
  posters: z.array(z.string()).default([]),
  /** e.g. "N-13. 7-12 m. vaikams būtina suaugusiojo palyda." */
  ratings: z.array(z.object({ value: z.string().nullish() })).default([]),
});
type Movie = z.infer<typeof MovieSchema>;

const ScreensSchema = z.array(z.object({ id: z.string().min(1), name: z.string().nullish() }));

/**
 * Forum prefixes some titles with a programme or event ("SCA'26: Išganymas" for Scanorama,
 * "Pamatyk kine: Kiti (2001)", "LNK premjera: Kopa: Trečia dalis") and lists dubbed or subtitled
 * versions as films of their own ("Užmirštoji sala (dubliuotas)", original "Forgotten Island
 * (dubbed)"). Other cinemas print the bare title.
 */
const PROGRAMME_LABEL =
  /^(?:SCA['’]\d{2}[:.]|Pamatyk kine:|PASIKLYDĘ EKRANE (?:kino klasika|pristato):|(?:LNK|TV3) (?:premjera|premiere):|Patirti kiną:|Šeimos kino seansas:|Family screening:)\s*/iu;
const VERSION_NOTE =
  /\s*\((?:dubliuotas|dubbed|su lietuviškais subtitrais|with lithuanian subtitles|(?:18|19|20)\d{2})\)\s*$/iu;
const DUBBED_NOTE = /\((?:dubliuotas|dubbed)\)\s*$/iu;

function cleanTitle(text: string | null | undefined): string | null {
  let title = text?.trim().replace(PROGRAMME_LABEL, '') ?? '';
  while (VERSION_NOTE.test(title)) title = title.replace(VERSION_NOTE, '');
  return title.trim() || null;
}

/** The feed has slips such as "1753", which is no film's year. */
function yearOf(text: string | null | undefined): number | null {
  const year = /^\d{4}$/.test(text?.trim() ?? '') ? Number(text) : null;
  return year !== null && year >= 1888 && year <= 2100 ? year : null;
}

const posterOf = (urls: readonly string[]): string | null =>
  urls.find((url) => /^https?:\/\//.test(url) && URL.canParse(url)) ?? null;

/** A missing page or a malformed answer loses one movie or one cinema's halls, not the source. */
function isLocalFailure(error: unknown): boolean {
  return (
    (error instanceof SourceRequestError && error.status === 404) ||
    error instanceof SourceResponseError
  );
}

type Halls = { fetchedAt: number; names: Map<string, string> };

/** Each adapter keeps its own hall cache, so tests can start from an empty one. */
export function createForumAdapter(): SourceAdapter {
  const hallsByCinema = new Map<string, Halls>();

  async function hallsOf(http: HttpClient, cinemaKey: string, now: Date): Promise<Halls['names']> {
    const cached = hallsByCinema.get(cinemaKey);
    if (cached && now.getTime() - cached.fetchedAt < HALLS_MAX_AGE_MS) return cached.names;
    try {
      const screens = await http.getJson(`${API}/cinema/${cinemaKey}/screen`, ScreensSchema);
      const names = new Map(
        screens.flatMap((screen) => {
          const name = screen.name?.trim();
          return name ? [[screen.id, name] as const] : [];
        }),
      );
      hallsByCinema.set(cinemaKey, { fetchedAt: now.getTime(), names });
      return names;
    } catch (error) {
      // Hall names are a detail: keep the last known ones rather than fail the refresh.
      if (!isLocalFailure(error)) throw error;
      return cached?.names ?? new Map();
    }
  }

  async function moviesFor(http: HttpClient, movieIds: ReadonlySet<string>) {
    const movies = new Map<string, Movie>();
    for (const raw of await http.getJson(`${API}/movie`, ItemsSchema)) {
      const movie = MovieSchema.safeParse(raw);
      if (movie.success) movies.set(movie.data.id, movie.data);
    }
    for (const id of movieIds) {
      if (movies.has(id)) continue;
      try {
        movies.set(id, await http.getJson(`${API}/movie/${encodeURIComponent(id)}`, MovieSchema));
      } catch (error) {
        if (!isLocalFailure(error)) throw error;
      }
    }
    return movies;
  }

  return {
    id: 'forum',
    async fetchScreenings({ now, http, registry }: AdapterContext): Promise<AdapterResult> {
      const result: AdapterResult = { screenings: [], skipped: [] };
      const today = todayIn(now);
      const range = `dateTimeFrom=${today}T00:00:00&dateTimeTo=${addDays(today, DAYS_AHEAD + 1)}T00:00:00`;

      const screenings: Screening[] = [];
      for (const region of await http.getJson(`${API}/region`, RegionsSchema)) {
        const url = `${API}/region/${encodeURIComponent(region.id)}/screening?${range}`;
        for (const raw of await http.getJson(url, ItemsSchema)) {
          const screening = ScreeningSchema.safeParse(raw);
          if (screening.success) {
            screenings.push(screening.data);
          } else {
            result.skipped.push({
              reason: 'screening without id, movie or start time',
              raw: JSON.stringify(raw).slice(0, 500),
            });
          }
        }
      }

      const movies = await moviesFor(http, new Set(screenings.map((item) => item.movieId)));
      const cinemaKeys = [...new Set(screenings.map((item) => item.cinemaId))].filter(
        (key) => registry.findBySourceKey('forum', key) !== undefined,
      );
      const halls = new Map<string, Halls['names']>();
      for (const key of cinemaKeys) halls.set(key, await hallsOf(http, key, now));

      for (const screening of screenings) {
        const cinema = registry.findBySourceKey('forum', screening.cinemaId);
        const movie = movies.get(screening.movieId);
        if (!cinema || !movie) {
          result.skipped.push({
            reason: cinema ? 'movie not found' : 'unknown cinema',
            raw: JSON.stringify(screening).slice(0, 500),
          });
          continue;
        }
        result.screenings.push(toSourceScreening(screening, movie, cinema.id, halls));
      }
      return result;
    },
  };
}

function toSourceScreening(
  screening: Screening,
  movie: Movie,
  cinemaId: string,
  halls: ReadonlyMap<string, ReadonlyMap<string, string>>,
): SourceScreening {
  const title = cleanTitle(movie.title) ?? movie.title;
  const duration = movie.duration ?? null;
  const dubbed =
    screening.speakingType === 'DUB' ||
    DUBBED_NOTE.test(movie.title) ||
    DUBBED_NOTE.test(movie.originalTitle ?? '');
  return {
    sourceScreeningId: screening.id,
    cinemaId,
    startsAt: new Date(screening.screeningTimeFrom),
    title,
    originalTitle: cleanTitle(movie.originalTitle),
    englishTitle: null,
    year: yearOf(movie.yearOfProduction),
    durationMinutes:
      duration !== null && Number.isInteger(duration) && duration > 0 ? duration : null,
    ageRating: ageRatingOf(movie.ratings[0]?.value?.split('.')[0]),
    genres: movie.genres.map((genre) => genre.name.trim()).filter((name) => name.length > 0),
    posterUrl: posterOf(movie.posters),
    hall: (screening.screenId && halls.get(screening.cinemaId)?.get(screening.screenId)) || null,
    format: formatOf(screening.printType),
    spokenLanguage: languageOf(screening.language),
    subtitleLanguage: languageOf(screening.subtitles),
    isDubbed: dubbed || (screening.speakingType === 'ORG' ? false : null),
    ticketUrl: `${SITE}/lt/ekranas/?id=${encodeURIComponent(screening.id)}&cid=${encodeURIComponent(screening.cinemaId)}`,
  };
}

export const forumAdapter = createForumAdapter();
