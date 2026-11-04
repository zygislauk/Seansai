import { z } from 'zod';
import { SourceRequestError } from '../../lib/errors.ts';
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
  media: z.object({ cover: z.object({ url: z.string() }).nullish() }).nullish(),
  timeSheets: z.object({ data: z.array(z.unknown()) }),
});

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
      const parsed = FilmSchema.safeParse(raw);
      if (!parsed.success) {
        result.skipped.push({
          reason: 'film without title or showings',
          raw: JSON.stringify(raw).slice(0, 500),
        });
        continue;
      }
      const film = parsed.data;

      const pageUrl = `${API}/posts/find/${film.slug_full}`;
      let attributes: Attribute[];
      try {
        ({ attributes } = (await http.getJson(pageUrl, FilmPageSchema)).data);
      } catch (error) {
        // A film taken down since the list was read; any other failure fails the refresh.
        if (error instanceof SourceRequestError && error.status === 404) {
          result.skipped.push({ reason: 'film page not found', raw: pageUrl });
          continue;
        }
        throw error;
      }

      const [spokenLanguage = null] = languagesOf(attributes, 'Kalba');
      // Many films list English and Lithuanian subtitles, in either order.
      const subtitles = languagesOf(attributes, 'Subtitrai');
      const subtitleLanguage = subtitles.includes('lt') ? 'lt' : (subtitles[0] ?? null);

      for (const rawSession of film.timeSheets.data) {
        const session = SessionSchema.safeParse(rawSession);
        if (!session.success) {
          result.skipped.push({ reason: 'unusable showing', raw: JSON.stringify(rawSession) });
          continue;
        }
        result.screenings.push({
          sourceScreeningId: String(session.data.id),
          cinemaId: cinema.id,
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
          }),
          ticketUrl: `${SITE}/movie/${film.slug_full}`,
        });
      }
    }
    return result;
  },
};
