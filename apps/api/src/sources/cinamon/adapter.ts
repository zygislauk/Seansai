import { z } from 'zod';
import { instantFromLocal } from '../../lib/time.ts';
import { ageRatingOf, dubbingOf, formatOf, languageOf } from '../parse.ts';
import type {
  AdapterContext,
  AdapterResult,
  SourceAdapter,
  SourceLimitation,
  SourceScreening,
} from '../types.ts';

/**
 * Cinamon Mega (Kaunas), through the page API its own site loads. Runs with the owner-approved
 * robots.txt override (research.md §1b); any sign of blocking raises SourceBlockedError in the
 * HTTP client, which ends this cycle for the source without retrying.
 *
 * Mode `page-state` (tests/fixtures/README.md): the API holds only today's remaining sessions,
 * and no per-session link, so tickets link to the cinema's schedule page (FR-009).
 */
const CINEMA_PID = '77139293';
const URL = `https://cinamonkino.com/api/page/home?cinema_id=${CINEMA_PID}&timezone=Europe/Vilnius&locale=lt`;
const SCHEDULE_PAGE = 'https://cinamonkino.com/mega/repertuaras/lt';

export const cinamonLimitations: readonly SourceLimitation[] = ['today-only'];

const AttributeSchema = z.object({
  short_name: z.string().nullish(),
  css_class: z.string().nullish(),
  category: z.string().nullish(),
});

const SessionSchema = z.object({
  pid: z.union([z.string(), z.number()]).transform(String),
  showtime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/),
  screen_name: z.string().nullish(),
  relatedAttributes: z.array(AttributeSchema).default([]),
  film: z.object({
    name: z.string().trim().min(1),
    original_name: z.string().nullish(),
    name_translations: z.object({ en: z.object({ text: z.string() }).nullish() }).nullish(),
    runtime: z.number().int().positive().nullish(),
    rating: z.string().nullish(),
    poster: z.string().nullish(),
    genre: z.object({ name: z.string() }).nullish(),
  }),
});
type Session = z.infer<typeof SessionSchema>;

const BodySchema = z.object({ sessions: z.record(z.string(), z.array(z.unknown())) });

/** The label of the first attribute in a category, e.g. "EN" for the audio language. */
function attribute(session: Session, kind: 'movie-type' | 'audio-language' | 'subtitle-language') {
  const category = kind.replace('-', '_');
  return session.relatedAttributes.find(
    (item) => item.css_class === kind || item.category === category,
  )?.short_name;
}

function toScreening(session: Session, cinemaId: string): SourceScreening {
  const { film } = session;
  const [date = '', time = ''] = session.showtime.split(' ');
  const title = film.name;
  const originalTitle = film.original_name?.trim() || null;
  const spokenLanguage = languageOf(attribute(session, 'audio-language'));
  const subtitleLanguage = languageOf(attribute(session, 'subtitle-language'));
  return {
    sourceScreeningId: session.pid,
    cinemaId,
    startsAt: instantFromLocal(date, time),
    title,
    originalTitle,
    englishTitle: film.name_translations?.en?.text.trim() || null,
    year: null,
    durationMinutes: film.runtime ?? null,
    ageRating: ageRatingOf(film.rating),
    genres: film.genre ? [film.genre.name] : [],
    posterUrl: film.poster || null,
    hall: session.screen_name?.trim() || null,
    format: formatOf(attribute(session, 'movie-type')),
    spokenLanguage,
    subtitleLanguage,
    isDubbed: dubbingOf({ title, originalTitle, spokenLanguage, subtitleLanguage }),
    ticketUrl: SCHEDULE_PAGE,
  };
}

export const cinamonAdapter: SourceAdapter = {
  id: 'cinamon',
  limitations: cinamonLimitations,
  async fetchScreenings({ http, registry }: AdapterContext): Promise<AdapterResult> {
    const cinema = registry.findBySourceKey('cinamon', CINEMA_PID);
    if (!cinema) throw new Error('Cinamon Mega is missing from the cinema registry');

    const { sessions } = await http.getJson(URL, BodySchema);
    const result: AdapterResult = { screenings: [], skipped: [] };
    for (const raw of Object.values(sessions).flat()) {
      const session = SessionSchema.safeParse(raw);
      if (session.success) result.screenings.push(toScreening(session.data, cinema.id));
      else
        result.skipped.push({ reason: 'unusable session', raw: JSON.stringify(raw).slice(0, 500) });
    }
    return result;
  },
};
