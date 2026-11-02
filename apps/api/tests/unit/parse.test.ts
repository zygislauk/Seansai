import { describe, expect, test } from 'vitest';
import {
  absoluteUrl,
  ageRatingOf,
  dubbingOf,
  formatOf,
  hoursAndMinutesOf,
  languageOf,
  minutesOf,
} from '../../src/sources/parse.ts';

describe('formatOf', () => {
  test.each([
    ['2D', null],
    ['3D', null],
    ['imax', 'IMAX'],
    ['IMAX 3D', 'IMAX'],
    ['4DX', '4DX'],
    ['ScreenX', 'ScreenX'],
    ['VR', 'other'],
  ])('maps "%s" to %s', (label, format) => {
    expect(formatOf(label)).toBe(format);
  });

  test('is unknown without a label', () => {
    expect(formatOf('')).toBeNull();
    expect(formatOf(null)).toBeNull();
  });
});

describe('languageOf', () => {
  test.each([
    ['Anglų k.', 'en'],
    ['Lietuvių sub.', 'lt'],
    ['Lietuvių', 'lt'],
    ['Ukrainiečių k.', 'uk'],
    ['Lithuanian', 'lt'],
    ['Korean', 'ko'],
    ['EN', 'en'],
    ['lt', 'lt'],
  ])('reads "%s" as %s', (name, code) => {
    expect(languageOf(name)).toBe(code);
  });

  test('is unknown for empty or unrecognised names', () => {
    expect(languageOf('')).toBeNull();
    expect(languageOf(null)).toBeNull();
    expect(languageOf('Klingonų k.')).toBeNull();
    expect(languageOf('NO SUBT.')).toBeNull();
  });
});

describe('ageRatingOf', () => {
  test.each([
    ['N13', 'N13'],
    ['N-13', 'N13'],
    ['N-16', 'N16'],
    ['V', 'V'],
    ['18', 'N18'],
  ])('normalises "%s" to %s', (text, rating) => {
    expect(ageRatingOf(text)).toBe(rating);
  });

  test('is unknown for placeholders', () => {
    expect(ageRatingOf('-')).toBeNull();
    expect(ageRatingOf('')).toBeNull();
    expect(ageRatingOf(undefined)).toBeNull();
  });
});

describe('durations', () => {
  test('reads minutes from "90 min." and "90 min"', () => {
    expect(minutesOf('90 min.')).toBe(90);
    expect(minutesOf('Komedija · 104 min')).toBe(104);
    expect(minutesOf('')).toBeNull();
  });

  test('reads "H.MM" as hours and minutes', () => {
    expect(hoursAndMinutesOf('1.58')).toBe(118);
    expect(hoursAndMinutesOf('2.05')).toBe(125);
    expect(hoursAndMinutesOf('abc')).toBeNull();
  });
});

describe('dubbingOf', () => {
  const base = { title: 'Katinas su skrybele', originalTitle: 'The Cat in the Hat' };

  test('an explicit dubbing marker wins', () => {
    expect(dubbingOf({ ...base, spokenLanguage: null, subtitleLanguage: null, marked: true })).toBe(
      true,
    );
  });

  test('a foreign film spoken in Lithuanian is dubbed', () => {
    expect(dubbingOf({ ...base, spokenLanguage: 'lt', subtitleLanguage: null })).toBe(true);
  });

  test('a Lithuanian film in Lithuanian is not dubbed', () => {
    expect(
      dubbingOf({
        title: 'Instruktorius',
        originalTitle: 'Instruktorius',
        spokenLanguage: 'lt',
        subtitleLanguage: null,
      }),
    ).toBe(false);
  });

  test('another spoken language, or subtitles, means the original version', () => {
    expect(dubbingOf({ ...base, spokenLanguage: 'en', subtitleLanguage: 'lt' })).toBe(false);
    expect(dubbingOf({ ...base, spokenLanguage: null, subtitleLanguage: 'lt' })).toBe(false);
  });

  test('is unknown when nothing is said about the language', () => {
    expect(dubbingOf({ ...base, spokenLanguage: null, subtitleLanguage: null })).toBeNull();
    expect(
      dubbingOf({
        title: 'Kopa',
        originalTitle: null,
        spokenLanguage: 'lt',
        subtitleLanguage: null,
      }),
    ).toBeNull();
  });
});

describe('absoluteUrl', () => {
  test('resolves a relative link against the site', () => {
    expect(absoluteUrl('/kasa/seansas/abc', 'https://atlantiscinemas.lt/filmai/x')).toBe(
      'https://atlantiscinemas.lt/kasa/seansas/abc',
    );
    expect(absoluteUrl('https://other.lt/a', 'https://atlantiscinemas.lt')).toBe(
      'https://other.lt/a',
    );
  });
});
