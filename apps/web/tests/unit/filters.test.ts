import { describe, expect, test } from 'vitest';
import {
  applyFilters,
  filterOptions,
  hasFilters,
  noFilters,
  parseFilters,
  toSearchParams,
  type Filters,
} from '../../src/lib/filters.ts';
import { screening } from '../helpers/mock-api.ts';

const cinema = (id: string, name: string) => ({ id, name, cityId: 'vilnius', cityName: 'Vilnius' });

const original = screening({ id: 'a', format: '3D', spokenLanguage: 'en', isDubbed: false });
const dubbed = screening({
  id: 'b',
  cinema: cinema('vue-vilnius', 'Vue Vilnius'),
  format: '2D',
  spokenLanguage: 'lt',
  subtitleLanguage: null,
  isDubbed: true,
});
const unknown = screening({
  id: 'c',
  cinema: cinema('skalvija', 'Skalvija'),
  format: null,
  spokenLanguage: null,
  subtitleLanguage: null,
  isDubbed: null,
});
// The dubbing flag is missing, but the spoken language says it is not Lithuanian.
const englishUnflagged = screening({
  id: 'd',
  format: 'IMAX',
  spokenLanguage: 'en',
  isDubbed: null,
});
const all = [original, dubbed, unknown, englishUnflagged];

const ids = (filters: Partial<Filters>) =>
  applyFilters(all, { ...noFilters, ...filters }).map((item) => item.id);

describe('applyFilters', () => {
  test('without filters keeps everything', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
  });

  test('keeps screenings at the chosen cinemas', () => {
    expect(ids({ cinemas: ['vue-vilnius', 'skalvija'] })).toEqual(['b', 'c']);
  });

  test('keeps screenings in the chosen formats; an unknown format matches no format filter', () => {
    expect(ids({ formats: ['3D'] })).toEqual(['a']);
    expect(ids({ formats: ['3D', 'IMAX'] })).toEqual(['a', 'd']);
  });

  test('"original" keeps screenings not dubbed into Lithuanian; unknown audio is left out', () => {
    expect(ids({ audio: 'original' })).toEqual(['a', 'd']);
  });

  test('"dubbed" keeps only screenings known to be dubbed', () => {
    expect(ids({ audio: 'dubbed' })).toEqual(['b']);
  });

  test('combines filters', () => {
    expect(ids({ cinemas: ['apollo-akropolis'], formats: ['3D'], audio: 'original' })).toEqual([
      'a',
    ]);
    expect(ids({ cinemas: ['vue-vilnius'], audio: 'original' })).toEqual([]);
  });
});

describe('URL parameters', () => {
  test('reads cinema, format and audio, ignoring unknown values', () => {
    expect(
      parseFilters(
        new URLSearchParams('cinema=skalvija,vue-vilnius&format=3D,4K,IMAX&audio=dubbed&date=x'),
      ),
    ).toEqual({ cinemas: ['skalvija', 'vue-vilnius'], formats: ['3D', 'IMAX'], audio: 'dubbed' });
    expect(parseFilters(new URLSearchParams('audio=loud&cinema='))).toEqual(noFilters);
  });

  test('ignores format=2D, which is no longer a filter', () => {
    expect(parseFilters(new URLSearchParams('format=2D'))).toEqual(noFilters);
    expect(parseFilters(new URLSearchParams('format=2D,IMAX')).formats).toEqual(['IMAX']);
  });

  test('writes the filters and keeps the other parameters', () => {
    const params = toSearchParams(
      { cinemas: ['skalvija', 'vue-vilnius'], formats: ['3D'], audio: 'original' },
      new URLSearchParams('date=2026-10-31&format=IMAX'),
    );
    expect(params.toString()).toBe(
      'date=2026-10-31&format=3D&cinema=skalvija%2Cvue-vilnius&audio=original',
    );
    expect(toSearchParams(noFilters, params).toString()).toBe('date=2026-10-31');
  });

  test('round-trips', () => {
    const filters: Filters = { cinemas: ['skalvija'], formats: ['4DX'], audio: null };
    expect(parseFilters(toSearchParams(filters, new URLSearchParams()))).toEqual(filters);
  });
});

test('hasFilters tells whether any filter is set', () => {
  expect(hasFilters(noFilters)).toBe(false);
  expect(hasFilters({ ...noFilters, audio: 'dubbed' })).toBe(true);
});

test('filterOptions lists only values present in the list, plus any already selected', () => {
  expect(filterOptions(all, noFilters)).toEqual({
    cinemas: [
      { id: 'apollo-akropolis', name: 'Apollo Akropolis' },
      { id: 'skalvija', name: 'Skalvija' },
      { id: 'vue-vilnius', name: 'Vue Vilnius' },
    ],
    formats: ['3D', 'IMAX'],
    audio: ['original', 'dubbed'],
  });
  expect(
    filterOptions([original], { cinemas: ['forum-vingis'], formats: ['4DX'], audio: 'dubbed' }),
  ).toEqual({
    cinemas: [
      { id: 'apollo-akropolis', name: 'Apollo Akropolis' },
      { id: 'forum-vingis', name: 'forum-vingis' },
    ],
    formats: ['3D', '4DX'],
    audio: ['original', 'dubbed'],
  });
});
