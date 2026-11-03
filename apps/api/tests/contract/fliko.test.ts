import { describe, expect, test } from 'vitest';
import { atlantisAdapter, garsasAdapter } from '../../src/sources/fliko/adapter.ts';
import { findScreening, runOnFixtures } from '../helpers/adapters.ts';

/** Capture instants of the Fliko fixtures (tests/fixtures/README.md). */
const ATLANTIS_NOW = new Date('2026-10-30T17:45:40Z');
const GARSAS_NOW = new Date('2026-10-30T17:45:56Z');

describe('Fliko sites (server-rendered movie pages)', () => {
  test('reads the movie list, then each movie page, and never calls a back.* host', async () => {
    const { requests } = await runOnFixtures(atlantisAdapter, ATLANTIS_NOW);

    expect(requests[0]).toBe('https://atlantiscinemas.lt/filmai');
    expect(requests).toContain('https://atlantiscinemas.lt/filmai/kita-mamyte');
    expect(requests).toHaveLength(1 + 41);
    for (const url of requests) expect(new URL(url).host).toBe('atlantiscinemas.lt');
  });

  test('a movie page that is not found (not captured here) is skipped, not fatal', async () => {
    const { screenings, skipped } = await runOnFixtures(atlantisAdapter, ATLANTIS_NOW);

    // 8 of the 41 movie pages are captured; the rest answer 404 in fixture mode.
    expect(skipped).toHaveLength(33);
    expect(skipped[0]?.reason).toBe('movie page not found');
    // Desktop and mobile layouts repeat each screening; each is kept once.
    expect(screenings).toHaveLength(61);
    expect(new Set(screenings.map((screening) => screening.sourceScreeningId)).size).toBe(61);
  });

  test('a screening takes its date from the day header and its time from the button', async () => {
    const { screenings } = await runOnFixtures(atlantisAdapter, ATLANTIS_NOW);

    expect(findScreening(screenings, 'a310efdb-23cd-41af-aee2-c091dd5d2fee')).toEqual({
      sourceScreeningId: 'a310efdb-23cd-41af-aee2-c091dd5d2fee',
      cinemaId: 'atlantis',
      // 20:45 in Vilnius (UTC+2).
      startsAt: new Date('2026-10-30T18:45:00Z'),
      title: 'KITA MAMYTĖ',
      originalTitle: 'Other Mommy',
      englishTitle: null,
      year: null,
      durationMinutes: 93,
      ageRating: 'N16',
      genres: ['Siaubo'],
      posterUrl:
        'https://d1xb9mtck96gqs.cloudfront.net/9a9bce2d-4dea-4ce0-bb4e-0275a706305c/movies/poster/6357e2ad174b03a8627ea94faedb1f1a/c/IVxuae8ojToynswa-base.jpg',
      hall: 'Pirma salė',
      format: null,
      spokenLanguage: 'en',
      subtitleLanguage: 'lt',
      isDubbed: false,
      ticketUrl: 'https://atlantiscinemas.lt/kasa/seansas/a310efdb-23cd-41af-aee2-c091dd5d2fee',
    });
  });

  test('"LT DUB" means a Lithuanian-dubbed screening', async () => {
    const { screenings } = await runOnFixtures(atlantisAdapter, ATLANTIS_NOW);

    expect(findScreening(screenings, 'a310fe02-c724-45f0-a9a0-fa85ed94eb7a')).toMatchObject({
      title: 'MONSTRIUKĖ MIJA (dubliuota lietuviškai)',
      originalTitle: 'Monster Mia',
      spokenLanguage: 'lt',
      subtitleLanguage: null,
      isDubbed: true,
      startsAt: new Date('2026-10-31T10:15:00Z'),
    });
  });

  test('Garsas uses the same template, with its own host and halls', async () => {
    const { screenings, requests } = await runOnFixtures(garsasAdapter, GARSAS_NOW);

    expect(new Set(screenings.map((screening) => screening.cinemaId))).toEqual(new Set(['garsas']));
    for (const url of requests) expect(new URL(url).host).toBe('bilietai.garsas.lt');
    expect(screenings).toHaveLength(10);
    expect(findScreening(screenings, 'a3150129-7637-4789-9e5d-a312e5896fd3')).toMatchObject({
      cinemaId: 'garsas',
      startsAt: new Date('2026-11-01T17:30:00Z'),
      title: 'Protas ir jausmai',
      originalTitle: 'Sense and Sensibility',
      durationMinutes: 132,
      ageRating: 'N13',
      genres: ['Drama', 'Romantinis'],
      hall: 'Kino centro „Garsas“ salė',
      ticketUrl: 'https://bilietai.garsas.lt/kasa/seansas/a3150129-7637-4789-9e5d-a312e5896fd3',
    });
  });
});
