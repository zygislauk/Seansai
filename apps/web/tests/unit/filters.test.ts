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

const apollo3d = screening({ id: 'a', format: '3D' });
const vue2d = screening({ id: 'b', cinema: cinema('vue-vilnius', 'Vue Vilnius'), format: '2D' });
const unknownFormat = screening({ id: 'c', cinema: cinema('skalvija', 'Skalvija'), format: null });
const apolloImax = screening({ id: 'd', format: 'IMAX' });
const all = [apollo3d, vue2d, unknownFormat, apolloImax];

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

  test('combines filters', () => {
    expect(ids({ cinemas: ['apollo-akropolis'], formats: ['3D'] })).toEqual(['a']);
    expect(ids({ cinemas: ['vue-vilnius'], formats: ['IMAX'] })).toEqual([]);
  });
});

describe('URL parameters', () => {
  test('reads cinema and format, ignoring unknown values and the retired audio filter', () => {
    expect(
      parseFilters(
        new URLSearchParams('cinema=skalvija,vue-vilnius&format=3D,4K,IMAX&audio=dubbed&date=x'),
      ),
    ).toEqual({ cinemas: ['skalvija', 'vue-vilnius'], formats: ['3D', 'IMAX'] });
    expect(parseFilters(new URLSearchParams('audio=original&cinema='))).toEqual(noFilters);
  });

  test('ignores format=2D, which is no longer a filter', () => {
    expect(parseFilters(new URLSearchParams('format=2D'))).toEqual(noFilters);
    expect(parseFilters(new URLSearchParams('format=2D,IMAX')).formats).toEqual(['IMAX']);
  });

  test('writes the filters and keeps the other parameters, dropping the retired audio', () => {
    const params = toSearchParams(
      { cinemas: ['skalvija', 'vue-vilnius'], formats: ['3D'] },
      new URLSearchParams('date=2026-10-31&format=IMAX&audio=dubbed'),
    );
    expect(params.toString()).toBe('date=2026-10-31&format=3D&cinema=skalvija%2Cvue-vilnius');
    expect(toSearchParams(noFilters, params).toString()).toBe('date=2026-10-31');
  });

  test('round-trips', () => {
    const filters: Filters = { cinemas: ['skalvija'], formats: ['4DX'] };
    expect(parseFilters(toSearchParams(filters, new URLSearchParams()))).toEqual(filters);
  });
});

test('hasFilters tells whether any filter is set', () => {
  expect(hasFilters(noFilters)).toBe(false);
  expect(hasFilters({ ...noFilters, formats: ['IMAX'] })).toBe(true);
});

test('filterOptions lists only values present in the list, plus any already selected', () => {
  expect(filterOptions(all, noFilters)).toEqual({
    cinemas: [
      { id: 'apollo-akropolis', name: 'Apollo Akropolis' },
      { id: 'skalvija', name: 'Skalvija' },
      { id: 'vue-vilnius', name: 'Vue Vilnius' },
    ],
    formats: ['3D', 'IMAX'],
  });
  expect(filterOptions([apollo3d], { cinemas: ['forum-vingis'], formats: ['4DX'] })).toEqual({
    cinemas: [
      { id: 'apollo-akropolis', name: 'Apollo Akropolis' },
      { id: 'forum-vingis', name: 'forum-vingis' },
    ],
    formats: ['3D', '4DX'],
  });
});
