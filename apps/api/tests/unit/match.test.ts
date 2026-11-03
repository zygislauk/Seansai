import { describe, expect, test } from 'vitest';
import type { MovieIdentity } from '../../src/db/repository.ts';
import {
  loadAliases,
  MAX_MOVIE_ID_BYTES,
  movieIdOf,
  resolveMovie,
  type Alias,
  type Listing,
} from '../../src/matching/match.ts';
import { matchKeyOf } from '../../src/matching/normalize.ts';

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    title: 'Kasėjas',
    originalTitle: 'Digger',
    englishTitle: null,
    year: 2026,
    durationMinutes: 101,
    ageRating: 'N13',
    genres: ['drama'],
    posterUrl: null,
    ...overrides,
  };
}

/** Existing movies list every title they are known by. */
function movie(identity: Omit<MovieIdentity, 'keys'> & { keys?: string[] }): MovieIdentity {
  return { keys: [identity.matchKey], ...identity };
}

const digger = movie({ id: 'digger-2026', matchKey: 'digger', year: 2026, durationMinutes: 101 });

describe('resolveMovie', () => {
  test('creates a new movie with a stable id from match key and year', () => {
    const result = resolveMovie(listing(), [], []);

    expect(result.movie).toMatchObject({
      id: 'digger-2026',
      title: 'Kasėjas',
      originalTitle: 'Digger',
      matchKey: 'digger',
      year: 2026,
    });
    expect(result.reviews).toEqual([]);
  });

  test('omits the year from the id when it is unknown', () => {
    const result = resolveMovie(
      listing({ originalTitle: null, title: 'Kopa. Antra dalis', year: null }),
      [],
      [],
    );

    expect(result.movie.id).toBe('kopa-antra-dalis');
  });

  test('matches confidently when match keys and production years are equal', () => {
    const result = resolveMovie(
      listing({ title: 'KASĖJAS (LT sub.)', durationMinutes: 140 }),
      [digger],
      [],
    );

    expect(result.movie.id).toBe('digger-2026');
    expect(result.reviews).toEqual([]);
  });

  test('matches confidently when one year is missing and durations differ by at most 15 minutes', () => {
    const result = resolveMovie(listing({ year: null, durationMinutes: 116 }), [digger], []);

    expect(result.movie.id).toBe('digger-2026');
    expect(result.reviews).toEqual([]);
  });

  test('a Sunday series listing joins the film, and a new one is stored without the label', () => {
    const series = listing({
      title: 'Šeimų sekmadienis: Kasėjas (dubliuotas)',
      originalTitle: 'Šeimų sekmadienis: Digger (2026)',
    });

    expect(resolveMovie(series, [digger], []).movie.id).toBe('digger-2026');
    expect(resolveMovie(series, [], []).movie).toMatchObject({
      id: 'digger-2026',
      title: 'Kasėjas (dubliuotas)',
      originalTitle: 'Digger (2026)',
    });
    expect(
      resolveMovie(listing({ title: 'Kasėjas | Sekmadienis su vaikais' }), [], []).movie.title,
    ).toBe('Kasėjas');
    expect(
      resolveMovie(listing({ englishTitle: 'Šeimų sekmadienis: Digger' }), [], []).movie
        .englishTitle,
    ).toBe('Digger');
  });

  test('keeps listings separate when one year is missing and durations differ by more than 15 minutes', () => {
    const result = resolveMovie(listing({ year: null, durationMinutes: 117 }), [digger], []);

    expect(result.movie.id).toBe('digger');
    expect(result.reviews).toEqual([
      expect.objectContaining({ matchKey: 'digger', movieIdA: 'digger-2026', movieIdB: 'digger' }),
    ]);
  });

  test('matches when one year is missing and a duration is unknown, as nothing contradicts it', () => {
    const result = resolveMovie(listing({ year: null, durationMinutes: null }), [digger], []);

    expect(result.movie.id).toBe('digger-2026');
    expect(result.reviews).toEqual([]);
  });

  test('names a new movie after its English title and keeps every title as a key', () => {
    const result = resolveMovie(
      listing({ title: 'Instruktorius', originalTitle: 'Instructor', englishTitle: 'Instructor' }),
      [],
      [],
    );

    expect(result.movie).toMatchObject({ id: 'instructor-2026', englishTitle: 'Instructor' });
    expect(result.keys).toEqual(['instructor', 'instruktorius']);
  });

  test('matches through any shared title: the same Lithuanian title, different originals', () => {
    // Apollo knows the English title; Vue only the Lithuanian original.
    const apollo = movie({
      id: 'instructor-2026',
      matchKey: 'instructor',
      keys: ['instructor', 'instruktorius'],
      year: 2026,
      durationMinutes: 90,
    });

    const result = resolveMovie(
      listing({
        title: 'Instruktorius',
        originalTitle: 'Instruktorius',
        year: null,
        durationMinutes: 90,
      }),
      [apollo],
      [],
    );

    expect(result.movie.id).toBe('instructor-2026');
    expect(result.keys).toEqual(['instruktorius']);
  });

  test('a Lithuanian title alone (Romuva) joins the movie with that title', () => {
    const odyssey = movie({
      id: 'odyssey-2026',
      matchKey: 'odyssey',
      keys: ['odyssey', 'odiseja'],
      year: 2026,
      durationMinutes: 172,
    });

    const result = resolveMovie(
      listing({ title: 'Odisėja', originalTitle: null, year: null, durationMinutes: null }),
      [odyssey],
      [],
    );

    expect(result.movie.id).toBe('odyssey-2026');
  });

  test('"The Uprising" and "Uprising" are the same title', () => {
    const uprising = movie({
      id: 'uprising-2026',
      matchKey: 'uprising',
      year: 2026,
      durationMinutes: 127,
    });

    const result = resolveMovie(
      listing({ title: 'Sukilimas', originalTitle: 'The Uprising', durationMinutes: 127 }),
      [uprising],
      [],
    );

    expect(result.movie.id).toBe('uprising-2026');
  });

  test('a shared title does not override a year conflict', () => {
    const result = resolveMovie(
      listing({ title: 'Kasėjas', originalTitle: 'Kasėjas', year: 1990 }),
      [
        movie({
          id: 'digger-2026',
          matchKey: 'digger',
          keys: ['digger', 'kasejas'],
          year: 2026,
          durationMinutes: 101,
        }),
      ],
      [],
    );

    expect(result.movie.id).toBe('kasejas-1990');
    expect(result.reviews).toHaveLength(1);
  });

  test('keeps a remake with a different year separate and logs it for review', () => {
    const dune1984 = movie({
      id: 'dune-1984',
      matchKey: 'dune',
      year: 1984,
      durationMinutes: 137,
    });

    const result = resolveMovie(
      listing({ title: 'Kopa', originalTitle: 'Dune', year: 2021, durationMinutes: 155 }),
      [dune1984],
      [],
    );

    expect(result.movie.id).toBe('dune-2021');
    expect(result.reviews).toEqual([
      {
        matchKey: 'dune',
        movieIdA: 'dune-1984',
        movieIdB: 'dune-2021',
        reason: 'year 1984 vs 2021',
      },
    ]);
  });

  test('never merges a film with its sequel', () => {
    const kopa = movie({ id: 'kopa', matchKey: 'kopa', year: null, durationMinutes: null });

    const result = resolveMovie(
      listing({ title: 'Kopa. Antra dalis', originalTitle: null, year: null }),
      [kopa],
      [],
    );

    expect(result.movie.id).toBe('kopa-antra-dalis');
    expect(result.reviews).toEqual([]);
  });

  test('treats two listings without a year as the same movie', () => {
    const skalvijaKopa = movie({
      id: 'kopa',
      matchKey: 'kopa',
      year: null,
      durationMinutes: null,
    });

    const result = resolveMovie(
      listing({ title: 'Kopa', originalTitle: null, year: null, durationMinutes: null }),
      [skalvijaKopa],
      [],
    );

    expect(result.movie.id).toBe('kopa');
  });

  test('does not guess when more than one existing movie would match', () => {
    const candidates = [
      movie({ id: 'pinocchio-2022', matchKey: 'pinocchio', year: 2022, durationMinutes: 115 }),
      movie({ id: 'pinocchio-2019', matchKey: 'pinocchio', year: 2019, durationMinutes: 120 }),
    ];

    const result = resolveMovie(
      listing({ title: 'Pinokis', originalTitle: 'Pinocchio', year: null, durationMinutes: 117 }),
      candidates,
      [],
    );

    expect(result.movie.id).toBe('pinocchio');
    expect(result.reviews.map((review) => review.movieIdA).sort()).toEqual([
      'pinocchio-2019',
      'pinocchio-2022',
    ]);
  });

  describe('alias file', () => {
    test("the real file merges Garsas's Sunday showing of The Cat in the Hat into the film", () => {
      const film = {
        id: 'cat-in-the-hat-2026',
        matchKey: 'cat in the hat',
        year: 2026,
        durationMinutes: 91,
        keys: ['cat in the hat', 'katinas su skrybele'],
      };
      const sundayShowing = listing({
        title: 'Katinas su skrybėle | Sekmadienis su vaikais',
        originalTitle: 'The Cat in the Hat',
        englishTitle: null,
        year: null,
        durationMinutes: 108,
      });

      const result = resolveMovie(sundayShowing, [film], loadAliases());

      expect(result.movie.id).toBe('cat-in-the-hat-2026');
      expect(result.reviews).toEqual([]);
    });

    const dune1984 = movie({
      id: 'dune-1984',
      matchKey: 'dune',
      year: 1984,
      durationMinutes: 137,
    });
    const remake = listing({
      title: 'Kopa',
      originalTitle: 'Dune',
      year: 2021,
      durationMinutes: 155,
    });

    test('"merge" forces a merge the rules would not make', () => {
      const aliases: Alias[] = [
        { matchKey: 'dune', movieIdA: 'dune-1984', movieIdB: 'dune-2021', resolution: 'merge' },
      ];

      const result = resolveMovie(remake, [dune1984], aliases);

      expect(result.movie.id).toBe('dune-1984');
      expect(result.reviews).toEqual([]);
    });

    test('"keep-separate" keeps them apart without logging a review', () => {
      const aliases: Alias[] = [
        {
          matchKey: 'dune',
          movieIdA: 'dune-2021',
          movieIdB: 'dune-1984',
          resolution: 'keep-separate',
        },
      ];

      const result = resolveMovie(remake, [dune1984], aliases);

      expect(result.movie.id).toBe('dune-2021');
      expect(result.reviews).toEqual([]);
    });

    test('"keep-separate" also overrides a match the rules would make', () => {
      const aliases: Alias[] = [
        {
          matchKey: 'digger',
          movieIdA: 'digger-2026',
          movieIdB: 'digger',
          resolution: 'keep-separate',
        },
      ];

      const result = resolveMovie(listing({ year: null }), [digger], aliases);

      expect(result.movie.id).toBe('digger');
      expect(result.reviews).toEqual([]);
    });
  });
});

describe('movieIdOf', () => {
  test('joins the title and year, whatever their length up to the limit', () => {
    expect(movieIdOf('digger', 2026)).toBe('digger-2026');
    expect(movieIdOf('digger', null)).toBe('digger');
    const longest = 'a'.repeat(MAX_MOVIE_ID_BYTES);
    expect(movieIdOf(longest, null)).toBe(longest);
  });

  const longTitle = 'labai ilgas renginio pavadinimas '.repeat(10).trim();

  test('shortens only a longer one, within the limit, as a valid id', () => {
    const id = movieIdOf(longTitle, 2026);

    expect(Buffer.byteLength(id)).toBeLessThanOrEqual(MAX_MOVIE_ID_BYTES);
    expect(id).toMatch(/^labai-ilgas-renginio/);
    expect(id).toMatch(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u);
  });

  test('counts bytes, as letters outside Latin take more of a file name', () => {
    const id = movieIdOf('спеціальна операція '.repeat(20).trim(), null);

    expect(Buffer.byteLength(id)).toBeLessThanOrEqual(MAX_MOVIE_ID_BYTES);
    expect(id).toMatch(/^спеціальна/);
    expect(id).toMatch(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u);
  });

  test('stays the same each time, and differs for two long titles', () => {
    expect(movieIdOf(longTitle, 2026)).toBe(movieIdOf(longTitle, 2026));
    expect(movieIdOf(longTitle, 2026)).not.toBe(movieIdOf(`${longTitle} kita`, 2026));
    expect(movieIdOf(longTitle, 2026)).not.toBe(movieIdOf(longTitle, 2025));
  });
});

describe('a title with no letters or digits', () => {
  // The public API and every snapshot build reject an id that isn't made of letters and digits.
  const VALID_ID = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

  test.each([
    ['???', 2026],
    ['???', null],
    ['— …', 2026],
  ])('%s from %s still gets a usable id', (title, year) => {
    const key = matchKeyOf({ title, originalTitle: null, englishTitle: null });

    expect(movieIdOf(key, year)).toMatch(VALID_ID);
  });
});
