import { load, type CheerioAPI } from 'cheerio';
import { SourceRequestError } from '../../lib/errors.ts';
import { instantFromLocal } from '../../lib/time.ts';
import { absoluteUrl, ageRatingOf, dubbingOf, formatOf, languageOf, minutesOf } from '../parse.ts';
import type {
  AdapterContext,
  AdapterResult,
  SourceAdapter,
  SourceId,
  SourceScreening,
} from '../types.ts';

/**
 * Cinemas on the shared Fliko site template (Atlantis, Garsas). `/filmai`
 * lists the movies; each `/filmai/{slug}` page lists its screenings under
 * `<time datetime="YYYY-MM-DD">` day headers, with local `HH:MM` times on
 * `/kasa/seansas/{id}` links. Only these server-rendered pages are read: each site's `back.*`
 * backend disallows crawling and is never called.
 */
type FlikoOptions = {
  id: SourceId;
  /** e.g. `https://atlantiscinemas.lt` */
  baseUrl: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const SESSION_LINK = /^\/kasa\/seansas\/([\w-]+)$/;

/** Movie page links on `/filmai`, in page order, once each. */
function moviePages($: CheerioAPI, baseUrl: string): string[] {
  const hrefs = $('a[href^="/filmai/"]')
    .map((_, link) => $(link).attr('href') ?? '')
    .get()
    .filter((href) => /^\/filmai\/[\w-]+$/.test(href));
  return [...new Set(hrefs)].map((href) => absoluteUrl(href, baseUrl));
}

type Movie = Pick<
  SourceScreening,
  'title' | 'originalTitle' | 'durationMinutes' | 'ageRating' | 'genres' | 'posterUrl'
>;

/** Title (h1), original title (the h2 after it), and "N-16 · Komedija · 90 min" details. */
function movieOf($: CheerioAPI, pageUrl: string): Movie | null {
  const heading = $('h1').first();
  const title = heading.text().trim();
  if (title === '') return null;
  const details = $('.middot-separator')
    .map((_, item) => $(item).text().trim())
    .get();
  const poster = $('img[alt]')
    .filter((_, image) => $(image).attr('alt')?.trim() === title)
    .first()
    .attr('src');
  return {
    title,
    originalTitle: heading.next('h2').text().trim() || null,
    durationMinutes: details.map(minutesOf).find((minutes) => minutes !== null) ?? null,
    ageRating: details.map(ageRatingOf).find((rating) => rating !== null) ?? null,
    genres: details.filter(
      (item) => minutesOf(item) === null && ageRatingOf(item) === null && item !== 'Nenurodyta',
    ),
    posterUrl: poster ? absoluteUrl(poster, pageUrl) : null,
  };
}

type Labels = Pick<SourceScreening, 'format' | 'spokenLanguage' | 'subtitleLanguage'> & {
  dubbed: boolean;
};

/** Session labels: "EN", "LT DUB" (dubbed), "Lietuvių sub.", and possibly a format. */
function labelsOf(texts: string[]): Labels {
  const labels: Labels = {
    format: null,
    spokenLanguage: null,
    subtitleLanguage: null,
    dubbed: false,
  };
  for (const text of texts) {
    if (/\bsub\.?$/i.test(text)) {
      labels.subtitleLanguage ??= languageOf(text);
    } else if (/^(2D|3D|IMAX|4DX|ScreenX)\b/i.test(text)) {
      labels.format ??= formatOf(text);
    } else {
      const dubbed = /\bDUB\b/i.test(text);
      const language = languageOf(text.replace(/\bDUB\b/i, ''));
      labels.spokenLanguage ??= language;
      if (dubbed && language === 'lt') labels.dubbed = true;
    }
  }
  return labels;
}

/** Screenings on a movie page; the desktop and mobile layouts repeat each one. */
function screeningsOf(
  $: CheerioAPI,
  movie: Movie,
  cinemaId: string,
  baseUrl: string,
): SourceScreening[] {
  const screenings = new Map<string, SourceScreening>();
  let date: string | null = null;
  $('time').each((_, element) => {
    const value = $(element).attr('datetime') ?? '';
    if (DATE.test(value)) {
      date = value;
      return;
    }
    const link = $(element).closest('a');
    const id = SESSION_LINK.exec(link.attr('href') ?? '')?.[1];
    if (!TIME.test(value) || date === null || id === undefined || screenings.has(id)) return;

    const info = link.children('div');
    const labels = labelsOf(
      info
        .children('div')
        .children('span')
        .map((_, span) => $(span).text().trim())
        .get(),
    );
    // The last plain line is the hall; the first one is the free seat count.
    const hall = info
      .children('span')
      .map((_, span) => $(span).text().trim())
      .get()
      .filter((text) => !/\bviet/i.test(text))
      .pop();
    screenings.set(id, {
      sourceScreeningId: id,
      cinemaId,
      startsAt: instantFromLocal(date, value),
      ...movie,
      englishTitle: null,
      year: null,
      hall: hall || null,
      format: labels.format,
      spokenLanguage: labels.spokenLanguage,
      subtitleLanguage: labels.subtitleLanguage,
      isDubbed: dubbingOf({ ...movie, ...labels, marked: labels.dubbed }),
      ticketUrl: absoluteUrl(`/kasa/seansas/${id}`, baseUrl),
    });
  });
  return [...screenings.values()];
}

export function createFlikoAdapter(options: FlikoOptions): SourceAdapter {
  return {
    id: options.id,
    async fetchScreenings({ http, registry }: AdapterContext): Promise<AdapterResult> {
      const cinema = registry.findBySourceKey(options.id, 'main');
      if (!cinema) throw new Error(`${options.id} is missing from the cinema registry`);

      const listUrl = `${options.baseUrl}/filmai`;
      const result: AdapterResult = { screenings: [], skipped: [] };
      for (const pageUrl of moviePages(load(await http.getText(listUrl)), options.baseUrl)) {
        let page: string;
        try {
          page = await http.getText(pageUrl);
        } catch (error) {
          // A movie taken down since the list was read; any other failure fails the refresh.
          if (error instanceof SourceRequestError && error.status === 404) {
            result.skipped.push({ reason: 'movie page not found', raw: pageUrl });
            continue;
          }
          throw error;
        }
        const $ = load(page);
        const movie = movieOf($, pageUrl);
        if (movie === null) {
          result.skipped.push({ reason: 'movie page without a title', raw: pageUrl });
          continue;
        }
        result.screenings.push(...screeningsOf($, movie, cinema.id, options.baseUrl));
      }
      return result;
    },
  };
}

export const atlantisAdapter = createFlikoAdapter({
  id: 'atlantis',
  baseUrl: 'https://atlantiscinemas.lt',
});
export const garsasAdapter = createFlikoAdapter({
  id: 'garsas',
  baseUrl: 'https://bilietai.garsas.lt',
});
