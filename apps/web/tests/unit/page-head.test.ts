import type { MovieDetailResponse } from '@seansai/shared';
import { describe, expect, test } from 'vitest';
import { cities as registryCities } from '../../../api/src/registry/cities.ts';
import { cityLocatives } from '../../src/i18n/lt.ts';
import { pageHead } from '../../src/lib/page-head.ts';
import { SITE_URL } from '../../src/lib/site.ts';
import { diggerDetail } from '../helpers/mock-api.ts';

const DESCRIPTION_LIMIT = 155;

const cinema = (id: string, name: string, cityId: string, cityName: string) => ({
  id,
  name,
  cityId,
  cityName,
});

const detail = (overrides: Partial<MovieDetailResponse['movie']> = {}, rest = {}) =>
  ({
    ...diggerDetail,
    movie: { ...diggerDetail.movie, ...overrides },
    ...rest,
  }) satisfies MovieDetailResponse;

const movieHead = (data: MovieDetailResponse, lang: 'lt' | 'en' = 'lt', city = 'all') =>
  pageHead({ kind: 'movie', detail: data, city }, lang);

describe('a movie page', () => {
  test('names the movie, its year and what the page offers, in the page’s language', () => {
    expect(movieHead(detail()).title).toBe('Kasėjas (2026) – seansai');
    expect(movieHead(detail(), 'en').title).toBe('Kasėjas (2026) – screenings');
  });

  test('leaves out a year it doesn’t know', () => {
    expect(movieHead(detail({ year: null })).title).toBe('Kasėjas – seansai');
  });

  test('says what, when and where in the description', () => {
    expect(movieHead(detail()).description).toBe(
      'Filmo „Kasėjas (2026)“ seansai Lietuvoje. Žanras: drama. ' +
        'Artimiausias seansas: spalio 30 d., penktadienis. Kur: Vilnius.',
    );
    expect(movieHead(detail(), 'en').description).toBe(
      'Screenings of Kasėjas (2026) in Lithuania. ' +
        'Next screening: Friday 30 October. Where: Vilnius.',
    );
  });

  test('English descriptions leave out genres, which the data only has in Lithuanian', () => {
    expect(movieHead(detail({ genres: ['komedija'] }), 'en').description).not.toContain('komedija');
  });

  test('writes genres in one form, without repeats', () => {
    expect(movieHead(detail({ genres: ['Siaubo', 'siaubo', 'drama'] })).description).toContain(
      'Žanras: siaubo, drama.',
    );
  });

  test('leaves out genres, dates and places it doesn’t know', () => {
    const { description } = movieHead(
      detail({ genres: [], year: null }, { screeningDates: [], showingAt: [] }),
    );

    expect(description).toBe('Filmo „Kasėjas“ seansai Lietuvoje.');
  });

  test('within a city, names its cinemas instead of the city', () => {
    expect(movieHead(detail(), 'en', 'vilnius').description).toContain(
      'Where: Apollo Akropolis, Skalvija, Vue Vilnius.',
    );
  });

  test('stays within about 155 characters, however many places', () => {
    const everywhere = [
      'Vilnius',
      'Kaunas',
      'Klaipėda',
      'Šiauliai',
      'Panevėžys',
      'Marijampolė',
      'Gargždai',
    ].map((name) => cinema(name, `Kinas ${name}`, name, name));

    const { description } = movieHead(
      detail(
        { title: 'Labai ilgas filmo pavadinimas su paantrašte', genres: ['drama', 'komedija'] },
        { showingAt: everywhere },
      ),
    );

    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    expect(description).toContain('Vilnius');
    expect(description).toMatch(/ir kt\.$/);
  });

  test('gives up genres before when and where', () => {
    const { description } = movieHead(
      detail({
        title: 'Labai labai ilgas filmo pavadinimas su paantrašte',
        genres: ['drama', 'komedija', 'mokslinė fantastika', 'nuotykių'],
      }),
    );

    expect(description).not.toContain('Žanras');
    expect(description).toContain('Kur: Vilnius.');
  });

  test('gives up its opening before when and where, for a long title', () => {
    const title = '90-ųjų kioskas pristato: Jubiliejiniai filmai „Mulen Ružas“';

    const { description } = movieHead(detail({ title, year: 2001 }));

    expect(description).toMatch(
      /^90-ųjų kioskas .*\(2001\)\. Artimiausias seansas: .* Kur: Vilnius\.$/,
    );
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
  });

  test('cuts a title too long to fit at a word', () => {
    const { description } = movieHead(detail({ title: 'žodis '.repeat(50).trim() }));

    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    expect(description).toMatch(/žodis…$/);
  });

  test('two movies have different titles and descriptions', () => {
    const one = movieHead(detail());
    const other = movieHead(detail({ title: 'Zuikis' }));

    expect(one.title).not.toBe(other.title);
    expect(one.description).not.toBe(other.description);
  });

  test('two records with the same title and year stay the same, so the build reports them', () => {
    expect(movieHead(detail({ id: 'a' })).title).toBe(movieHead(detail({ id: 'b' })).title);
  });

  test('asks for nothing special from search engines', () => {
    expect(movieHead(detail()).robots).toBeNull();
  });
});

describe('the general list', () => {
  test('has a title and description in each language', () => {
    expect(pageHead({ kind: 'list' }, 'lt')).toMatchObject({
      title: 'Kino seansai visoje Lietuvoje – Seansai',
      description: 'Visų Lietuvos kino teatrų seansai vienoje vietoje.',
      robots: null,
    });
    expect(pageHead({ kind: 'list' }, 'en')).toMatchObject({
      title: 'Cinema screenings across Lithuania – Seansai',
      description: 'Screenings at every cinema in Lithuania, all in one place.',
      robots: null,
    });
  });
});

describe('a city page', () => {
  const cityHead = (lang: 'lt' | 'en', cityId = 'vilnius', name = 'Vilnius') =>
    pageHead({ kind: 'city', cityId, name }, lang);

  test('names the city in Lithuanian, in the form the sentence needs', () => {
    expect(cityHead('lt').title).toBe('Kino seansai Vilniuje');
    expect(cityHead('lt').description).toContain('Vilniuje');
    expect(cityHead('lt', 'klaipeda', 'Klaipėda').title).toBe('Kino seansai Klaipėdoje');
  });

  test('names the city in English', () => {
    expect(cityHead('en').title).toBe('Cinema screenings in Vilnius');
    expect(cityHead('en', 'klaipeda', 'Klaipeda').description).toContain('Klaipeda');
  });

  test('a city with no Lithuanian form yet still reads correctly', () => {
    expect(cityHead('lt', 'alytus', 'Alytus').title).toBe('Kino seansai: Alytus');
    expect(cityHead('lt', 'alytus', 'Alytus').description).toContain('Alytus');
  });

  test('every city in the registry has its Lithuanian form', () => {
    expect(registryCities.map(({ id }) => id).filter((id) => !(id in cityLocatives))).toEqual([]);
  });

  test('is its own preferred address, in both languages', () => {
    expect(cityHead('en').canonical).toBe(`${SITE_URL}/en/city/vilnius`);
    expect(cityHead('lt').alternates).toEqual([
      { hreflang: 'lt', href: `${SITE_URL}/lt/city/vilnius` },
      { hreflang: 'en', href: `${SITE_URL}/en/city/vilnius` },
      { hreflang: 'x-default', href: `${SITE_URL}/lt/city/vilnius` },
    ]);
  });

  test('descriptions fit where search results cut them off', () => {
    for (const lang of ['lt', 'en'] as const) {
      for (const { id, nameLt } of registryCities) {
        expect(cityHead(lang, id, nameLt).description.length).toBeLessThanOrEqual(
          DESCRIPTION_LIMIT,
        );
      }
    }
  });
});

describe('the list with a city in its address', () => {
  test('names the city page as its preferred address', () => {
    expect(pageHead({ kind: 'list', city: 'vilnius' }, 'lt').canonical).toBe(
      `${SITE_URL}/lt/city/vilnius`,
    );
  });

  test('all of Lithuania is the plain list', () => {
    expect(pageHead({ kind: 'list', city: 'all' }, 'en').canonical).toBe(`${SITE_URL}/en/`);
  });

  test('with no city it names itself', () => {
    expect(pageHead({ kind: 'list', city: null }, 'lt').canonical).toBe(`${SITE_URL}/lt/`);
  });
});

describe('the not-found page', () => {
  test('asks not to be listed', () => {
    expect(pageHead({ kind: 'notFound' }, 'en')).toMatchObject({
      title: 'Page not found – Seansai',
      description: 'This page does not exist. The link may be out of date.',
      robots: 'noindex',
    });
  });
});

describe('preferred addresses and language links', () => {
  const SITE = 'https://seansai.vercel.app';
  const linksTo = (path: (lang: string) => string) => [
    { hreflang: 'lt', href: `${SITE}${path('lt')}` },
    { hreflang: 'en', href: `${SITE}${path('en')}` },
    { hreflang: 'x-default', href: `${SITE}${path('lt')}` },
  ];

  test('the list prefers its own address, in each language', () => {
    expect(pageHead({ kind: 'list' }, 'lt').canonical).toBe(`${SITE}/lt/`);
    expect(pageHead({ kind: 'list' }, 'en').canonical).toBe(`${SITE}/en/`);
  });

  test('a movie prefers its own address, in each language', () => {
    expect(movieHead(detail()).canonical).toBe(`${SITE}/lt/movie/digger-2026`);
    expect(movieHead(detail(), 'en').canonical).toBe(`${SITE}/en/movie/digger-2026`);
  });

  test('every version names the same set of language links, with Lithuanian as the default', () => {
    const list = linksTo((lang) => `/${lang}/`);
    expect(pageHead({ kind: 'list' }, 'lt').alternates).toEqual(list);
    expect(pageHead({ kind: 'list' }, 'en').alternates).toEqual(list);

    const movie = linksTo((lang) => `/${lang}/movie/digger-2026`);
    expect(movieHead(detail()).alternates).toEqual(movie);
    expect(movieHead(detail(), 'en').alternates).toEqual(movie);
  });

  test('percent-encodes a movie id with non-ASCII letters', () => {
    const head = movieHead(detail({ id: 'was-marielle-weiß' }));

    expect(head.canonical).toBe(`${SITE}/lt/movie/was-marielle-wei%C3%9F`);
    expect(head.alternates[1]?.href).toBe(`${SITE}/en/movie/was-marielle-wei%C3%9F`);
  });

  test('a not-found page prefers nothing', () => {
    const head = pageHead({ kind: 'notFound' }, 'lt');

    expect(head.canonical).toBeNull();
    expect(head.alternates).toEqual([]);
  });
});

describe('link previews', () => {
  const DEFAULT_IMAGE = `${SITE_URL}/og-default.png`;
  const POSTER = 'https://cinema.example/poster.jpg';

  test('a movie with a poster shows it, named by the movie’s title', () => {
    const head = movieHead(detail({ posterUrl: POSTER }));

    expect(head.image).toBe(POSTER);
    expect(head.imageAlt).toBe('Kasėjas');
  });

  test('a movie without a poster uses the general image, named by the site', () => {
    const head = movieHead(detail({ posterUrl: null }));

    expect(head.image).toBe(DEFAULT_IMAGE);
    expect(head.imageAlt).toBe('Seansai');
  });

  test('a movie is a movie, and other pages are websites', () => {
    expect(movieHead(detail()).type).toBe('video.movie');
    expect(pageHead({ kind: 'list' }, 'lt').type).toBe('website');
    expect(pageHead({ kind: 'city', cityId: 'vilnius', name: 'Vilnius' }, 'lt').type).toBe(
      'website',
    );
    expect(pageHead({ kind: 'notFound' }, 'lt').type).toBe('website');
  });

  test.each([
    ['the general list', { kind: 'list' }],
    ['a city', { kind: 'city', cityId: 'vilnius', name: 'Vilnius' }],
    ['the not-found page', { kind: 'notFound' }],
  ] as const)('%s uses the general image', (_, page) => {
    const head = pageHead(page, 'en');

    expect(head.image).toBe(DEFAULT_IMAGE);
    expect(head.imageAlt).toBe('Seansai');
  });
});
