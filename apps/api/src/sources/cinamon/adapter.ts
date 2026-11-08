import { z } from 'zod';
import { SourceRequestError } from '../../lib/errors.ts';
import { instantFromLocal, todayIn } from '../../lib/time.ts';
import { lastListedDate } from '../horizon.ts';
import { ageRatingOf, dubbingOf, formatOf, languageOf } from '../parse.ts';
import type { AdapterContext, AdapterResult, SourceAdapter, SourceScreening } from '../types.ts';

/**
 * Cinamon Mega (Kaunas), through the API its own site loads. Runs with the owner-approved
 * robots.txt override (research.md §1b); any sign of blocking raises SourceBlockedError in the
 * HTTP client, which ends this cycle for the source without retrying.
 *
 * The home page's answer holds today's remaining sessions and `calendar_dates`, every date with
 * sessions; each later date's sessions come from `schedule?date=`, the request the site's
 * schedule page makes when a date is picked. Sessions carry no link of their own, so tickets link
 * to the cinema's schedule page (FR-009).
 */
const CINEMA_PID = '77139293';
const API = 'https://cinamonkino.com/api';
const PARAMS = `cinema_id=${CINEMA_PID}&timezone=Europe/Vilnius&locale=lt`;
const HOME_URL = `${API}/page/home?${PARAMS}`;
const dateUrl = (date: string) =>
  `${API}/schedule?${PARAMS}&date=${date}&include=film.genre,screen,relatedAttributes,seatsLeft`;
const SCHEDULE_PAGE = 'https://cinamonkino.com/mega/repertuaras/lt';

const AttributeSchema = z.object({
  short_name: z.string().nullish(),
  css_class: z.string().nullish(),
  category: z.string().nullish(),
});

const SessionSchema = z.object({
  pid: z.union([z.string(), z.number()]).transform(String),
  showtime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/),
  screen_name: z.string().nullish(),
  is_3d: z.boolean().default(false),
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

const HomeSchema = z.object({
  sessions: z.record(z.string(), z.array(z.unknown())),
  calendar_dates: z.array(z.string()).default([]),
});
const DaySessionsSchema = z.array(z.unknown());

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
    format: session.is_3d ? '3D' : formatOf(attribute(session, 'movie-type')),
    spokenLanguage,
    subtitleLanguage,
    isDubbed: dubbingOf({ title, originalTitle, spokenLanguage, subtitleLanguage }),
    ticketUrl: SCHEDULE_PAGE,
  };
}

export const cinamonAdapter: SourceAdapter = {
  id: 'cinamon',
  async fetchScreenings({ now, http, registry }: AdapterContext): Promise<AdapterResult> {
    const cinema = registry.findBySourceKey('cinamon', CINEMA_PID);
    if (!cinema) throw new Error('Cinamon Mega is missing from the cinema registry');

    const home = await http.getJson(HOME_URL, HomeSchema);
    const sessions = Object.values(home.sessions).flat();
    const result: AdapterResult = { screenings: [], skipped: [] };

    const today = todayIn(now);
    const lastDate = lastListedDate(now);
    const laterDates = [...new Set(home.calendar_dates)]
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date > today && date <= lastDate)
      .sort();
    for (const date of laterDates) {
      try {
        sessions.push(...(await http.getJson(dateUrl(date), DaySessionsSchema)));
      } catch (error) {
        // A date dropped since the calendar was read; any other failure fails the refresh.
        if (error instanceof SourceRequestError && error.status === 404) {
          result.skipped.push({ reason: 'date not found', raw: dateUrl(date) });
          continue;
        }
        throw error;
      }
    }

    const seen = new Set<string>();
    for (const raw of sessions) {
      const session = SessionSchema.safeParse(raw);
      if (!session.success) {
        result.skipped.push({ reason: 'unusable session', raw: JSON.stringify(raw).slice(0, 500) });
      } else if (!seen.has(session.data.pid)) {
        seen.add(session.data.pid);
        result.screenings.push(toScreening(session.data, cinema.id));
      }
    }
    return result;
  },
};
