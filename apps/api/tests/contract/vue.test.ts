import { describe, expect, test } from 'vitest';
import { vueAdapter } from '../../src/sources/vue/adapter.ts';
import { findScreening, runOnFixtures } from '../helpers/adapters.ts';

/** Capture instant of the Vue fixture (tests/fixtures/README.md). */
const NOW = new Date('2026-10-30T17:39:50Z');

describe('Vue (films with showings)', () => {
  test('reads every showing of cinema 1001', async () => {
    const { screenings, skipped, requests } = await runOnFixtures(vueAdapter, NOW);

    expect(requests).toEqual(['https://vuekinas.lt/data/filmswithshowings/1001']);
    expect(screenings).toHaveLength(242);
    expect(skipped).toEqual([]);
    expect(new Set(screenings.map((screening) => screening.cinemaId))).toEqual(
      new Set(['vue-vilnius']),
    );
  });

  test('reads date and time as Vilnius local time, ignoring the misleading "Z"', async () => {
    const { screenings } = await runOnFixtures(vueAdapter, NOW);

    // The feed says "2026-10-31T21:00:00Z" with "time": "21:00"; the screening is at 21:00 local.
    expect(findScreening(screenings, '213067')).toEqual({
      sourceScreeningId: '213067',
      cinemaId: 'vue-vilnius',
      startsAt: new Date('2026-10-31T19:00:00Z'),
      title: 'ABSOLIUTUS BLOGIS',
      originalTitle: 'Resident Evil',
      englishTitle: null,
      year: null,
      durationMinutes: 90,
      ageRating: 'N16',
      genres: ['Siaubo'],
      posterUrl: expect.stringMatching(/^https:\/\/media\.vuekinas\.lt\/.+residentevil/) as string,
      hall: '3 salė',
      format: null,
      spokenLanguage: null,
      subtitleLanguage: null,
      isDubbed: null,
      ticketUrl: 'https://vuekinas.lt/pirkti-bilieta/santrauka/1001/4324/213067',
    });
  });

  test('keeps a title without an original in brackets as published', async () => {
    const { screenings } = await runOnFixtures(vueAdapter, NOW);
    const titles = new Set(screenings.map((screening) => screening.title));

    expect(titles).toContain('KLYK! SIAUBO maratonas');
    expect(titles).toContain('Bado žaidynės: aukų dienai auštant');
  });
});
