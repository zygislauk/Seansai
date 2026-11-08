import { describe, expect, test } from 'vitest';
import { cinamonAdapter } from '../../src/sources/cinamon/adapter.ts';
import { findScreening, runOnBodies, runOnFixtures } from '../helpers/adapters.ts';

/** Capture instant of the Cinamon fixture (tests/fixtures/README.md). */
const NOW = new Date('2026-10-30T17:41:11Z');
const API = 'https://cinamonkino.com/api';
const HOME = `${API}/page/home?cinema_id=77139293&timezone=Europe/Vilnius&locale=lt`;
const dateUrl = (date: string) =>
  `${API}/schedule?cinema_id=77139293&timezone=Europe/Vilnius&locale=lt&date=${date}&include=film.genre,screen,relatedAttributes,seatsLeft`;

describe('Cinamon Mega (the API its site loads)', () => {
  test('reads today from the home page, then each later calendar date up to today + 90', async () => {
    const { screenings, skipped, requests } = await runOnFixtures(cinamonAdapter, NOW);

    // The calendar runs from 2026-10-30 to 2027-03-14; 2027-01-31 and 2027-03-14 are beyond
    // 2027-01-28, the last listed date.
    const later = [
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-07',
      '2026-11-08',
      '2026-11-12',
      '2026-11-13',
      '2026-11-18',
      '2026-12-05',
      '2026-12-06',
      '2026-12-15',
      '2026-12-16',
      '2026-12-17',
      '2026-12-18',
    ];
    expect(requests).toEqual([HOME, ...later.map(dateUrl)]);
    // Today's 6 sessions plus the one saved later date (2026-12-16); the fixture holds no other
    // date, and a date that answers "not found" is skipped.
    expect(screenings).toHaveLength(7);
    expect(skipped).toHaveLength(later.length - 1);
    expect(skipped[0]).toEqual({ reason: 'date not found', raw: dateUrl('2026-10-31') });
  });

  test('maps a later date’s session like today’s', async () => {
    const { screenings } = await runOnFixtures(cinamonAdapter, NOW);

    expect(findScreening(screenings, '297594434')).toEqual({
      sourceScreeningId: '297594434',
      cinemaId: 'cinamon-mega',
      startsAt: new Date('2026-12-16T16:30:00Z'),
      title: 'Kopa: Trečia dalis',
      originalTitle: 'Dune: Part Three',
      englishTitle: 'Dune: Part Three',
      year: null,
      durationMinutes: 150,
      ageRating: 'N13',
      genres: ['Mokslinė fantastika'],
      posterUrl: 'https://cinamonkino.com/api/page/film-poster?film_id=872325774',
      hall: 'KOSMOS Sale',
      format: '2D',
      spokenLanguage: 'en',
      subtitleLanguage: null,
      isDubbed: false,
      ticketUrl: 'https://cinamonkino.com/mega/repertuaras/lt',
    });
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
      format: '2D',
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
});

describe('Cinamon Mega edge cases', () => {
  const session = (pid: number, showtime: string) => ({
    pid,
    showtime,
    screen_name: 'Sale 1',
    film: { name: 'Kopa: Trečia dalis' },
  });
  const home = (dates: string[]) =>
    JSON.stringify({
      sessions: { a: [session(1, '2026-10-30 20:00:00')] },
      calendar_dates: dates,
    });

  test('a session listed on both today’s page and its date is kept once', async () => {
    const { screenings } = await runOnBodies(
      cinamonAdapter,
      {
        [HOME]: home(['2026-10-30', '2026-10-31']),
        [dateUrl('2026-10-31')]: JSON.stringify([
          session(1, '2026-10-30 20:00:00'),
          session(2, '2026-10-31 18:00:00'),
        ]),
      },
      NOW,
    );

    expect(screenings.map((item) => item.sourceScreeningId)).toEqual(['1', '2']);
  });

  test('a date that answers with something other than sessions fails the refresh', async () => {
    const bodies = { [HOME]: home(['2026-10-31']), [dateUrl('2026-10-31')]: '{"error":"x"}' };

    // A failed refresh keeps the previous data (FR-015) rather than losing the later dates.
    await expect(runOnBodies(cinamonAdapter, bodies, NOW)).rejects.toThrow(dateUrl('2026-10-31'));
  });
});
