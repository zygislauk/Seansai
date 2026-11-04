import { describe, expect, test } from 'vitest';
import { SourceRequestError } from '../../src/lib/errors.ts';
import type { HttpClient } from '../../src/lib/polite-http.ts';
import { cinemaRegistry } from '../../src/registry/cinemas.ts';
import { arlekinasAdapter } from '../../src/sources/arlekinas/adapter.ts';
import { findScreening, runOnBodies, runOnFixtures } from '../helpers/adapters.ts';

/** Capture instant of the Arlekinas fixture (tests/fixtures/README.md). */
const NOW = new Date('2026-11-04T12:49:46Z');
const API = 'https://api.kinasarlekinas.lt/api';
const LIST = `${API}/posts/filter?latest=1&post_time_sheet_date=2026-11-04&post_time_sheet_date_to=2027-02-02`;

const session = { id: 1, date: '2026-11-06', time_start: '18:00' };
const film = {
  title: 'Filmas',
  title_localized: 'A Film',
  year: 2026,
  duration: 100,
  slug_full: 'filmas-1',
  media: { cover: { url: 'https://api.kinasarlekinas.lt/storage/1/cover.webp' } },
  timeSheets: { data: [session] },
};

function attributes(groups: Record<string, string[]>) {
  const entries = Object.entries(groups).flatMap(([group_name, titles]) =>
    titles.map((title) => ({ group_name, title })),
  );
  return JSON.stringify({ data: { attributes: entries } });
}

function bodies(listed: unknown[], details: Record<string, string> = {}) {
  return {
    [LIST]: JSON.stringify({ data: listed }),
    [`${API}/posts/find/filmas-1`]: attributes({}),
    ...details,
  };
}

describe('Arlekinas (the site’s JSON API)', () => {
  test('reads the 90-day list once, then each film’s page once', async () => {
    const { screenings, skipped, requests } = await runOnFixtures(arlekinasAdapter, NOW);

    expect(requests[0]).toBe(LIST);
    expect(requests).toHaveLength(26);
    expect(new Set(requests).size).toBe(26);
    expect(requests).toContain(`${API}/posts/find/carlis-ir-harper-825`);
    expect(screenings).toHaveLength(26);
    expect(skipped).toEqual([]);
  });

  test('reads local times as Vilnius time and links to the film page, not the checkout', async () => {
    const { screenings } = await runOnFixtures(arlekinasAdapter, NOW);

    expect(findScreening(screenings, '3016')).toEqual({
      sourceScreeningId: '3016',
      cinemaId: 'arlekinas',
      // 20:00 in Vilnius in winter (UTC+2).
      startsAt: new Date('2026-11-06T18:00:00Z'),
      title: 'Čarlis ir Harper',
      originalTitle: 'Charlie Harper',
      englishTitle: null,
      year: 2025,
      durationMinutes: 102,
      ageRating: 'N16',
      genres: ['romantinė drama'],
      posterUrl:
        'https://api.kinasarlekinas.lt/storage/2594/conversions/CharlieHarper_B1_LT_Preview-thumb.webp',
      hall: null,
      format: null,
      spokenLanguage: 'en',
      subtitleLanguage: 'lt',
      isDubbed: false,
      ticketUrl: 'https://kinasarlekinas.lt/movie/carlis-ir-harper-825',
    });
  });

  test('gives every showing of a film its own screening', async () => {
    const { screenings } = await runOnFixtures(arlekinasAdapter, NOW);

    expect(findScreening(screenings, '3002').title).toBe('Родичі');
    expect(findScreening(screenings, '3002').startsAt).toEqual(new Date('2026-11-05T16:00:00Z'));
    expect(findScreening(screenings, '3003').startsAt).toEqual(new Date('2026-11-07T12:00:00Z'));
    expect(findScreening(screenings, '3002').subtitleLanguage).toBe('en');
  });

  test('leaves unknown what a film’s page doesn’t state', async () => {
    const { screenings } = await runOnFixtures(arlekinasAdapter, NOW);

    const listed = screenings.find((screening) => screening.title === 'Zeitūno melodija');
    expect(listed).toMatchObject({
      ageRating: null,
      genres: [],
      spokenLanguage: null,
      subtitleLanguage: null,
      isDubbed: null,
    });
  });

  test('takes the first of several spoken languages', async () => {
    const { screenings } = await runOnFixtures(arlekinasAdapter, NOW);

    const listed = screenings.find((screening) => screening.title === 'Antraplanis vaidmuo');
    expect(listed?.spokenLanguage).toBe('ka');
  });

  test('prefers Lithuanian subtitles wherever they are listed', async () => {
    const page = attributes({ Subtitrai: ['anglų', 'lietuvių'] });
    const { screenings } = await runOnBodies(
      arlekinasAdapter,
      bodies([film], { [`${API}/posts/find/filmas-1`]: page }),
      NOW,
    );

    expect(screenings[0]?.subtitleLanguage).toBe('lt');
  });

  test('doesn’t call a Lithuanian-spoken film dubbed: its second title may just be in English', async () => {
    const page = attributes({ Kalba: ['lietuvių'] });
    const { screenings } = await runOnBodies(
      arlekinasAdapter,
      bodies([film], { [`${API}/posts/find/filmas-1`]: page }),
      NOW,
    );

    expect(screenings[0]?.spokenLanguage).toBe('lt');
    expect(screenings[0]?.isDubbed).toBeNull();
  });

  test('treats an impossible year or duration as unknown', async () => {
    const { screenings, skipped } = await runOnBodies(
      arlekinasAdapter,
      bodies([{ ...film, year: 0, duration: 0, title_localized: '', media: null }]),
      NOW,
    );

    expect(skipped).toEqual([]);
    expect(screenings[0]).toMatchObject({
      year: null,
      durationMinutes: null,
      originalTitle: null,
      posterUrl: null,
    });
  });

  test('skips a film without a title, and a showing without a readable time', async () => {
    const { screenings, skipped } = await runOnBodies(
      arlekinasAdapter,
      bodies([
        { slug_full: 'be-pavadinimo-2' },
        {
          ...film,
          timeSheets: {
            data: [
              { ...session, time_start: 'netrukus' },
              { ...session, id: 2 },
            ],
          },
        },
      ]),
      NOW,
    );

    expect(screenings.map((screening) => screening.sourceScreeningId)).toEqual(['2']);
    expect(skipped).toHaveLength(2);
  });

  test('skips a film whose page has gone since the list was read', async () => {
    const other = { ...film, slug_full: 'kitas-2', timeSheets: { data: [{ ...session, id: 2 }] } };
    const { screenings, skipped } = await runOnBodies(arlekinasAdapter, bodies([other, film]), NOW);

    expect(screenings.map((screening) => screening.sourceScreeningId)).toEqual(['1']);
    expect(skipped).toEqual([{ reason: 'film page not found', raw: `${API}/posts/find/kitas-2` }]);
  });

  test('fails the refresh when a film’s page fails in any other way', async () => {
    const http: HttpClient = {
      beginCycle: () => undefined,
      getText: (url) => Promise.reject(new SourceRequestError(url, 'timed out')),
      getJson: (url, schema) =>
        url === LIST
          ? Promise.resolve(schema.parse({ data: [film] }))
          : Promise.reject(new SourceRequestError(url, 'timed out')),
    };

    await expect(
      arlekinasAdapter.fetchScreenings({ now: NOW, http, registry: cinemaRegistry }),
    ).rejects.toThrow(/timed out/);
  });

  test('fails the refresh when the list isn’t in the expected form', async () => {
    await expect(
      runOnBodies(arlekinasAdapter, { [LIST]: '{"message":"Server Error"}' }, NOW),
    ).rejects.toThrow();
  });
});
