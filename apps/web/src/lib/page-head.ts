import type { CinemaSummary, Lang, MovieDetailResponse } from '@seansai/shared';
import { createTranslator, type Translator } from '../i18n/index.tsx';
import { cityLocatives } from '../i18n/lt.ts';
import { SITE_URL } from './site.ts';

/** For a shared link with no poster of its own, named by the site, as the image shows its name. */
const GENERAL_PREVIEW = { image: `${SITE_URL}/og-default.png`, imageAlt: 'Seansai' };

/** About what search results show before cutting a description off. */
const DESCRIPTION_LIMIT = 155;

/** What a page says about itself (data-model.md). */
export type PageHead = {
  title: string;
  description: string;
  robots: 'noindex' | null;
  /** Full address of the preferred page, whatever options the address has (FR-012). */
  canonical: string | null;
  alternates: Array<{ hreflang: Lang | 'x-default'; href: string }>;
  /** What a shared link's preview shows (FR-017). */
  image: string;
  imageAlt: string;
  type: 'video.movie' | 'website';
};

export type HeadPage =
  /** `city` is the `?city=` in the address, never the remembered one: that isn't the address's. */
  | { kind: 'list'; city?: string | null }
  | { kind: 'city'; cityId: string; name: string }
  | { kind: 'movie'; detail: MovieDetailResponse; city: string }
  | { kind: 'notFound' };

/** City names for all of Lithuania, cinema names within a city. */
function placeNames(showingAt: readonly CinemaSummary[], city: string): string[] {
  return [...new Set(showingAt.map((cinema) => (city === 'all' ? cinema.cityName : cinema.name)))];
}

/** When and where the movie is next showing (FR-005), or null when it has no screening left. */
export function nextShowing(
  detail: MovieDetailResponse,
  city: string,
  t: Translator,
  maxPlaces = Infinity,
): string | null {
  const date = detail.screeningDates[0];
  const places = placeNames(detail.showingAt, city);
  if (date === undefined || places.length === 0) return null;
  const named = places.slice(0, maxPlaces).join(', ');
  return t.t('movie.nextShowing', {
    date: t.formatDate(date),
    places: places.length > maxPlaces ? t.t('movie.morePlaces', { places: named }) : named,
  });
}

function cutAtWord(text: string): string {
  const cut = text.slice(0, DESCRIPTION_LIMIT - 1);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** As much as fits: genres go first, as when and where is what the page is for, then places. */
function movieDescription(detail: MovieDetailResponse, name: string, city: string, t: Translator) {
  const about = t.t('head.movieDescription', { name });
  // The sources only state genres in Lithuanian, with varying capitals.
  const genres = [...new Set(detail.movie.genres.map((genre) => genre.toLocaleLowerCase('lt')))];
  const withGenres =
    t.lang === 'lt' && genres.length > 0
      ? `${about} ${t.t('head.genres', { genres: genres.join(', ') })}`
      : about;

  for (const opening of [withGenres, about, `${name}.`]) {
    for (let places = detail.showingAt.length; places > 0; places--) {
      const text = `${opening} ${nextShowing(detail, city, t, places) ?? ''}`.trim();
      if (text.length <= DESCRIPTION_LIMIT) return text;
    }
  }
  for (const opening of [withGenres, about]) {
    if (opening.length <= DESCRIPTION_LIMIT) return opening;
  }
  return cutAtWord(about);
}

/** The same set on both language versions, with Lithuanian as the default. */
function addresses(path: string, lang: Lang): Pick<PageHead, 'canonical' | 'alternates'> {
  const address = (version: Lang) => `${SITE_URL}/${version}/${path}`;
  return {
    canonical: address(lang),
    alternates: [
      { hreflang: 'lt', href: address('lt') },
      { hreflang: 'en', href: address('en') },
      { hreflang: 'x-default', href: address('lt') },
    ],
  };
}

/** Lithuanian needs the city's locative, and a city without one gets a sentence that needs none. */
function cityText(
  cityId: string,
  name: string,
  t: Translator,
  withForm: 'head.cityTitle' | 'head.cityDescription',
  withoutForm: 'head.cityTitleNoForm' | 'head.cityDescriptionNoForm',
): string {
  const place = t.lang === 'lt' ? cityLocatives[cityId] : name;
  return place === undefined ? t.t(withoutForm, { place: name }) : t.t(withForm, { place });
}

/** The title and heading of a city's page. */
export function cityTitle(cityId: string, name: string, t: Translator): string {
  return cityText(cityId, name, t, 'head.cityTitle', 'head.cityTitleNoForm');
}

const cityPath = (cityId: string) => `city/${encodeURIComponent(cityId)}`;

/** Pure, so the snapshot and the running app say the same about a page. */
export function pageHead(page: HeadPage, lang: Lang): PageHead {
  const t = createTranslator(lang);
  switch (page.kind) {
    case 'list':
      return {
        title: t.t('head.listTitle'),
        description: t.t('head.listDescription'),
        robots: null,
        ...addresses(page.city && page.city !== 'all' ? cityPath(page.city) : '', lang),
        ...GENERAL_PREVIEW,
        type: 'website',
      };
    case 'city':
      return {
        title: cityTitle(page.cityId, page.name, t),
        description: cityText(
          page.cityId,
          page.name,
          t,
          'head.cityDescription',
          'head.cityDescriptionNoForm',
        ),
        robots: null,
        ...addresses(cityPath(page.cityId), lang),
        ...GENERAL_PREVIEW,
        type: 'website',
      };
    case 'movie': {
      const { title, year, posterUrl } = page.detail.movie;
      const name = year === null ? title : `${title} (${String(year)})`;
      return {
        title: t.t('head.movieTitle', { name }),
        description: movieDescription(page.detail, name, page.city, t),
        robots: null,
        ...addresses(`movie/${encodeURIComponent(page.detail.movie.id)}`, lang),
        ...(posterUrl === null ? GENERAL_PREVIEW : { image: posterUrl, imageAlt: title }),
        type: 'video.movie',
      };
    }
    case 'notFound':
      return {
        title: t.t('head.notFoundTitle'),
        description: t.t('notFound.body'),
        robots: 'noindex',
        canonical: null,
        alternates: [],
        ...GENERAL_PREVIEW,
        type: 'website',
      };
  }
}
