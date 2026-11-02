import { describe, expect, test } from 'vitest';
import { cinamonAdapter, cinamonLimitations } from '../../src/sources/cinamon/adapter.ts';
import { findScreening, runOnFixtures } from '../helpers/adapters.ts';

/** Capture instant of the Cinamon fixture (tests/fixtures/README.md). */
const NOW = new Date('2026-10-30T17:41:11Z');

describe('Cinamon Mega (page API, today only)', () => {
  test('reads the sessions of the Mega page', async () => {
    const { screenings, skipped, requests } = await runOnFixtures(cinamonAdapter, NOW);

    expect(requests).toEqual([
      'https://cinamonkino.com/api/page/home?cinema_id=77139293&timezone=Europe/Vilnius&locale=lt',
    ]);
    expect(screenings).toHaveLength(6);
    expect(skipped).toEqual([]);
  });

  test('parses "YYYY-MM-DD HH:MM:SS" as Vilnius time and maps hall, film and attributes', async () => {
    const { screenings } = await runOnFixtures(cinamonAdapter, NOW);

    expect(findScreening(screenings, '2027030298')).toEqual({
      sourceScreeningId: '2027030298',
      cinemaId: 'cinamon-mega',
      startsAt: new Date('2026-10-30T18:00:00Z'),
      title: 'Kita mamytė',
      originalTitle: 'Other Mommy',
      englishTitle: 'Other Mommy',
      year: null,
      durationMinutes: 93,
      ageRating: 'N16',
      genres: ['Siaubo'],
      posterUrl: 'https://cinamonkino.com/api/page/film-poster?film_id=1413004104',
      hall: 'Sale 2',
      format: null,
      spokenLanguage: 'en',
      subtitleLanguage: 'lt',
      isDubbed: false,
      // The data has no per-session link (the site opens sessions in its own script), so the
      // link is the cinema's schedule page (FR-009 fallback).
      ticketUrl: 'https://cinamonkino.com/mega/repertuaras/lt',
    });
  });

  test('reads "NO SUBT." as no subtitles', async () => {
    const { screenings } = await runOnFixtures(cinamonAdapter, NOW);

    expect(findScreening(screenings, '700368435')).toMatchObject({
      title: 'Instruktorius',
      spokenLanguage: 'lt',
      subtitleLanguage: null,
      isDubbed: false,
    });
  });

  test('declares that it only knows today’s sessions', () => {
    expect(cinamonLimitations).toEqual(['today-only']);
  });
});
