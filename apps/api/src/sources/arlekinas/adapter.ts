import { z } from 'zod';
import { SourceRequestError, SourceResponseError } from '../../lib/errors.ts';
import type { HttpClient } from '../../lib/polite-http.ts';
import { addDays, instantFromLocal, todayIn } from '../../lib/time.ts';
import { ageRatingOf, dubbingOf, languageOf } from '../parse.ts';
import type { AdapterContext, AdapterResult, SourceAdapter } from '../types.ts';

/**
 * Kino teatras Arlekinas. The site reads its schedule from its own JSON API, whose robots.txt
 * allows everything: `posts/filter` lists films with their showings (local times) for a date
 * range, and only each film's `posts/find/{slug}` states its languages, age rating and genres.
 * The checkout pages are never requested; tickets link to the film's page, which sells them.
 */
const SITE = 'https://kinasarlekinas.lt';
const API = 'https://api.kinasarlekinas.lt/api';
/** The programme is published about three weeks ahead; this only has to reach past that. */
const DAYS_AHEAD = 90;

const ListSchema = z.object({ data: z.array(z.unknown()) });

const FilmSchema = z.object({
  title: z.string().trim().min(1),
  title_localized: z.string().nullish(),
  year: z.number().int().min(1888).max(2100).nullable().catch(null),
  duration: z.number().int().positive().nullable().catch(null),
  slug_full: z.string().min(1),
  media: z
    .object({ cover: z.object({ url: z.url({ protocol: /^https?$/ }) }).nullish() })
    .nullish()
    .catch(null),
  timeSheets: z.object({ data: z.array(z.unknown()) }),
});
type Film = z.infer<typeof FilmSchema>;

const SessionSchema = z.object({
  id: z.number().int(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time_start: z.string().regex(/^\d{2}:\d{2}$/),
});

const FilmPageSchema = z.object({
  data: z.object({
    attributes: z.array(z.object({ group_name: z.string(), title: z.string() })),
  }),
});
type Attribute = z.infer<typeof FilmPageSchema>['data']['attributes'][number];

const valuesOf = (attributes: readonly Attribute[], group: string): string[] =>
  attributes.filter((attribute) => attribute.group_name === group).map(({ title }) => title);

function languagesOf(attributes: readonly Attribute[], group: string): string[] {
  return valuesOf(attributes, group)
    .map(languageOf)
    .filter((language) => language !== null);
}

/**
 * A film's details, or none when its page can't be read: the showings come from the list, and
 * dropping them would empty the cinema if this answer's form ever changed, because a refresh that
 * succeeds replaces all of a source's screenings. Null means the film was taken down since the
 * list was read. Any other failure fails the refresh.
 */
async function attributesOf(
  film: Film,
  http: HttpClient,
  skipped: AdapterResult['skipped'],
): Promise<Attribute[] | null> {
  const pageUrl = `${API}/posts/find/${film.slug_full}`;
  try {
    return (await http.getJson(pageUrl, FilmPageSchema)).data.attributes;
  } catch (error) {
    if (error instanceof SourceResponseError) {
      skipped.push({ reason: 'film page unreadable', raw: pageUrl });
      return [];
    }
    if (error instanceof SourceRequestError && error.status === 404) {
      skipped.push({ reason: 'film page not found', raw: pageUrl });
      return null;
    }
    throw error;
  }
}

function screeningsOf(
  film: Film,
  attributes: readonly Attribute[],
  cinemaId: string,
  result: AdapterResult,
): void {
  const [spokenLanguage = null] = languagesOf(attributes, 'Kalba');
  // Many films list English and Lithuanian subtitles, in either order.
  const subtitles = languagesOf(attributes, 'Subtitrai');
  const subtitleLanguage = subtitles.includes('lt') ? 'lt' : (subtitles[0] ?? null);

  for (const raw of film.timeSheets.data) {
    const session = SessionSchema.safeParse(raw);
    if (!session.success) {
      result.skipped.push({ reason: 'unusable showing', raw: JSON.stringify(raw) });
      continue;
    }
    result.screenings.push({
      sourceScreeningId: String(session.data.id),
      cinemaId,
      startsAt: instantFromLocal(session.data.date, session.data.time_start),
      title: film.title,
      originalTitle: film.title_localized?.trim() || null,
      englishTitle: null,
      year: film.year,
      durationMinutes: film.duration,
      ageRating: ageRatingOf(valuesOf(attributes, 'Amžiaus cenzas')[0]),
      genres: valuesOf(attributes, 'Žanras'),
      posterUrl: film.media?.cover?.url ?? null,
      hall: null,
      format: null,
      spokenLanguage,
      subtitleLanguage,
      // `title_localized` can be just an English name, so it can't show a film is foreign.
      isDubbed: dubbingOf({
        title: film.title,
        originalTitle: null,
        spokenLanguage,
        subtitleLanguage,
        marked: /dubliuot|įgarsint/i.test(film.title),
      }),
      ticketUrl: `${SITE}/movie/${film.slug_full}`,
    });
  }
}

export const arlekinasAdapter: SourceAdapter = {
  id: 'arlekinas',
  async fetchScreenings({ now, http, registry }: AdapterContext): Promise<AdapterResult> {
    const cinema = registry.findBySourceKey('arlekinas', 'main');
    if (!cinema) throw new Error('Arlekinas is missing from the cinema registry');

    const today = todayIn(now);
    const listUrl = `${API}/posts/filter?latest=1&post_time_sheet_date=${today}&post_time_sheet_date_to=${addDays(today, DAYS_AHEAD)}`;
    const { data: films } = await http.getJson(listUrl, ListSchema);

    const result: AdapterResult = { screenings: [], skipped: [] };
    for (const raw of films) {
      const film = FilmSchema.safeParse(raw);
      if (!film.success) {
        result.skipped.push({
          reason: 'film without title or showings',
          raw: JSON.stringify(raw).slice(0, 500),
        });
        continue;
      }
      if (film.data.timeSheets.data.length === 0) continue;
      const attributes = await attributesOf(film.data, http, result.skipped);
      if (attributes !== null) screeningsOf(film.data, attributes, cinema.id, result);
    }
    return result;
  },
};
