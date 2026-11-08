import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { SourceResponseError } from '../../lib/errors.ts';
import { todayIn } from '../../lib/time.ts';
import { cinemas } from '../../registry/cinemas.ts';
import { DAYS_AHEAD } from '../horizon.ts';
import { ageRatingOf, dubbingOf, formatOf, languageOf } from '../parse.ts';
import type {
  AdapterContext,
  AdapterResult,
  SourceAdapter,
  SourceId,
  SourceScreening,
} from '../types.ts';

/**
 * Markus Cinema System feed (Apollo, Pasaka): `Schedule/?area=&dt=dd.MM.yyyy&nrOfDays=` lists
 * every show of one theatre area for `nrOfDays` days counting today, so the listed days
 * (horizon.ts) take one more than DAYS_AHEAD. Apollo answers in JSON, Pasaka in XML; both carry the same
 * fields. The feed's own theatre ids differ from the area ids, so the venue is the area that
 * was requested.
 */

type McsOptions = {
  id: SourceId;
  /** e.g. `https://www.apollokinas.lt/xml/` */
  baseUrl: string;
  /** MCS theatre area ids, one per venue in the registry. */
  areaIds: readonly string[];
  /** Apollo's "original" titles are the international English titles, even for Lithuanian films. */
  originalTitleIsEnglish?: boolean;
};

/** XML gives every value as a string and empty elements as ''; JSON uses numbers and null. */
const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => (value === null || value === undefined ? '' : String(value).trim()));
const language = z
  .union([z.object({ ISOTwoLetterCode: text }), z.literal('')])
  .nullish()
  .transform((value) =>
    typeof value === 'object' && value !== null ? value.ISOTwoLetterCode : '',
  );
const images = z
  .union([
    z.object({ EventMediumImagePortrait: text, EventLargeImagePortrait: text }),
    z.literal(''),
  ])
  .nullish()
  .transform((value) =>
    typeof value === 'object' && value !== null
      ? value.EventMediumImagePortrait || value.EventLargeImagePortrait || ''
      : '',
  );

const ShowSchema = z.object({
  ID: text.pipe(z.string().min(1)),
  dttmShowStartUTC: text.pipe(z.iso.datetime()),
  Title: text.pipe(z.string().min(1)),
  OriginalTitle: text,
  ProductionYear: text,
  LengthInMinutes: text,
  RatingLabel: text,
  Genres: text,
  TheatreAuditorium: text,
  PresentationMethod: text,
  PresentationMethodAndLanguage: text,
  ShowURL: text,
  EventURL: text,
  SpokenLanguage: language,
  SubtitleLanguage1: language,
  Images: images,
});
type Show = z.infer<typeof ShowSchema>;

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === 'Show',
});

/** The raw show objects of a JSON or XML schedule. */
function showsOf(url: string, body: string): unknown[] {
  const trimmed = body.trimStart();
  try {
    if (trimmed.startsWith('{')) {
      const json = JSON.parse(trimmed) as { Shows?: unknown };
      if (Array.isArray(json.Shows)) return json.Shows as unknown[];
    } else if (trimmed.startsWith('<')) {
      const xml = xmlParser.parse(trimmed) as { Schedule?: { Shows?: { Show?: unknown[] } | '' } };
      const shows = xml.Schedule?.Shows;
      if (shows === '') return [];
      if (shows && Array.isArray(shows.Show)) return shows.Show;
    }
  } catch (error) {
    throw new SourceResponseError(url, 'schedule is not valid JSON or XML', { cause: error });
  }
  throw new SourceResponseError(url, 'no Shows list in the schedule');
}

/** `dd.MM.yyyy` of today in Vilnius, as the feed expects. */
function feedDate(now: Date): string {
  const [year, month, day] = todayIn(now).split('-');
  return `${day ?? ''}.${month ?? ''}.${year ?? ''}`;
}

const positive = (value: string): number | null => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};
const orNull = (value: string): string | null => (value === '' ? null : value);

/** "Monster Mia (2026)" → "Monster Mia": Pasaka appends the year to original titles. */
const withoutYear = (title: string): string =>
  title.replace(/\s*\(\s*(?:18|19|20)\d{2}\s*\)\s*$/, '').trim();

/**
 * Pasaka often leaves `SpokenLanguage` empty and writes "2D, Anglų", "2D, Dubliuotas lietuviškai"
 * or "2D, I" (įgarsinta, dubbed) instead.
 */
function presentationLanguage(value: string): { language: string | null; dubbed: boolean } {
  const [, first = ''] = value.split(',').map((part) => part.trim());
  if (first === 'I' || /dubliuot|įgarsint/i.test(first)) return { language: 'lt', dubbed: true };
  return { language: languageOf(first), dubbed: false };
}

function toScreening(
  show: Show,
  cinemaId: string,
  fallbackUrl: string,
  originalTitleIsEnglish: boolean,
): SourceScreening {
  const fromPresentation = presentationLanguage(show.PresentationMethodAndLanguage);
  const spokenLanguage = languageOf(show.SpokenLanguage) ?? fromPresentation.language;
  const subtitleLanguage = languageOf(show.SubtitleLanguage1);
  const originalTitle = orNull(withoutYear(show.OriginalTitle));
  return {
    sourceScreeningId: show.ID,
    cinemaId,
    startsAt: new Date(show.dttmShowStartUTC),
    title: show.Title,
    originalTitle,
    englishTitle: originalTitleIsEnglish ? originalTitle : null,
    year: positive(show.ProductionYear),
    durationMinutes: positive(show.LengthInMinutes),
    ageRating: ageRatingOf(show.RatingLabel),
    genres: show.Genres.split(',')
      .map((genre) => genre.trim())
      .filter((genre) => genre.length > 0),
    posterUrl: orNull(show.Images),
    hall: orNull(show.TheatreAuditorium.replace(/\s+/g, ' ')),
    format: formatOf(show.PresentationMethod),
    spokenLanguage,
    subtitleLanguage,
    isDubbed: dubbingOf({
      title: show.Title,
      originalTitle,
      spokenLanguage,
      subtitleLanguage,
      marked: fromPresentation.dubbed || /dubliuot|įgarsint/i.test(show.Title),
    }),
    ticketUrl: show.ShowURL || show.EventURL || fallbackUrl,
  };
}

export function createMcsAdapter(options: McsOptions): SourceAdapter {
  return {
    id: options.id,
    async fetchScreenings({ now, http, registry }: AdapterContext): Promise<AdapterResult> {
      const result: AdapterResult = { screenings: [], skipped: [] };
      for (const areaId of options.areaIds) {
        const url = `${options.baseUrl}Schedule/?area=${areaId}&dt=${feedDate(now)}&nrOfDays=${String(DAYS_AHEAD + 1)}`;
        const cinema = registry.findBySourceKey(options.id, areaId);
        const shows = showsOf(url, await http.getText(url));
        for (const raw of shows) {
          const show = ShowSchema.safeParse(raw);
          if (!show.success || !cinema) {
            const reason = cinema ? 'show without id, title or start time' : 'unknown area';
            result.skipped.push({ reason, raw: JSON.stringify(raw).slice(0, 500) });
            continue;
          }
          result.screenings.push(
            toScreening(
              show.data,
              cinema.id,
              cinema.websiteUrl,
              options.originalTitleIsEnglish ?? false,
            ),
          );
        }
      }
      return result;
    },
  };
}

/** The registry's venue keys for a source are its MCS area ids. */
const areaIdsOf = (sourceId: SourceId): string[] =>
  cinemas
    .filter((cinema) => cinema.sourceId === sourceId)
    .flatMap((cinema) => cinema.sourceVenueKeys);

export const apolloAdapter = createMcsAdapter({
  id: 'apollo',
  baseUrl: 'https://www.apollokinas.lt/xml/',
  areaIds: areaIdsOf('apollo'),
  originalTitleIsEnglish: true,
});

export const pasakaAdapter = createMcsAdapter({
  id: 'pasaka',
  baseUrl: 'https://bilietai.kinopasaka.lt/xml/',
  areaIds: areaIdsOf('pasaka'),
});
