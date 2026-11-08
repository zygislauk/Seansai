import { describe, expect, test } from 'vitest';
import { cinemaRegistry } from '../../src/registry/cinemas.ts';
import { createForumAdapter } from '../../src/sources/forum/adapter.ts';
import { findScreening, runOnBodies, runOnFixtures } from '../helpers/adapters.ts';

/** Capture instant of the Forum fixture (tests/fixtures/README.md). */
const NOW = new Date('2026-10-31T16:37:09Z');
const API = 'https://restapi.forumcinemas.lt/api';
const DAY_MS = 24 * 60 * 60 * 1000;

const VINGIS = 'f933f355-2e6b-466f-9b97-e267ecd8e266';
const KAUNAS = 'b4662f38-8b50-4533-9eb8-c26ae4394a78';
const KLAIPEDA = '40025d9f-a5cd-4bb9-bd4b-d01c52558731';
const SIAULIAI = '4c3fe3b1-90c1-4268-9c9f-d86e91cd2a44';

const screeningsUrl = (regionId: string) =>
  `${API}/region/${regionId}/screening?dateTimeFrom=2026-10-31T00:00:00&dateTimeTo=2027-01-30T00:00:00`;

describe('Forum Cinemas (REST API behind forumcinemas.lt)', () => {
  test('reads the listed days (today + 90) of every region, the movie list once and the halls of each cinema', async () => {
    const { screenings, skipped, requests } = await runOnFixtures(createForumAdapter(), NOW);

    expect(requests).toEqual([
      `${API}/region`,
      screeningsUrl('e9202daa-51f9-4de9-8811-3076ad5449be'),
      screeningsUrl('8de15094-3a6e-420b-8c81-39362095d37e'),
      screeningsUrl('cb184608-bf53-4bf5-8d87-c9f9667a9da0'),
      // "Sandėlys" has no cinema in the registry and no screenings.
      screeningsUrl('83d01d47-4a91-4c39-bdd5-a4dd78345427'),
      screeningsUrl('b261027f-b96b-4182-92aa-43357d257015'),
      `${API}/movie`,
      // The one movie missing from the list is fetched on its own, not all 121 of them.
      `${API}/movie/3dc7cb45-4fcd-4f35-a029-a0e0431ad80c`,
      `${API}/cinema/${VINGIS}/screen`,
      `${API}/cinema/${KAUNAS}/screen`,
      `${API}/cinema/${KLAIPEDA}/screen`,
      `${API}/cinema/${SIAULIAI}/screen`,
    ]);
    expect(screenings).toHaveLength(1043);
    expect(skipped).toEqual([]);
  });

  test('maps a screening joined with its movie, respecting the time offset', async () => {
    const { screenings } = await runOnFixtures(createForumAdapter(), NOW);

    // "screeningTimeFrom": "2026-11-02T15:00:00+02:00", "printType": "IMAX 2D".
    expect(findScreening(screenings, '871eb2e5-3cdd-4d1f-abff-904f0985307d')).toEqual({
      sourceScreeningId: '871eb2e5-3cdd-4d1f-abff-904f0985307d',
      cinemaId: 'forum-vingis',
      startsAt: new Date('2026-11-02T13:00:00Z'),
      title: 'Odisėja',
      originalTitle: 'The Odyssey',
      englishTitle: null,
      year: 2026,
      durationMinutes: 172,
      ageRating: 'N13',
      genres: ['Veiksmo', 'Nuotykių'],
      posterUrl: 'https://medstore.forumcinemas.lt/IMAXOdyssey1000x1481.jpg',
      hall: 'IMAX salė',
      format: 'IMAX',
      spokenLanguage: 'en',
      subtitleLanguage: 'lt',
      isDubbed: false,
      ticketUrl: `https://forumcinemas.lt/lt/ekranas/?id=871eb2e5-3cdd-4d1f-abff-904f0985307d&cid=${VINGIS}`,
    });
  });

  test('marks dubbed screenings and drops the "(dubliuotas)" note from the titles', async () => {
    const { screenings } = await runOnFixtures(createForumAdapter(), NOW);

    expect(findScreening(screenings, '112ae96b-cb3b-441d-8e0b-ba16dd7cef88')).toMatchObject({
      title: 'Aviukas Šonas ir baimės pilnos kelnės',
      originalTitle: 'Shaun the Sheep: The Beast of Mossy Bottom',
      ageRating: 'V',
      hall: '10 salė',
      format: '2D',
      spokenLanguage: 'lt',
      subtitleLanguage: null,
      isDubbed: true,
    });
    expect(findScreening(screenings, '8d56559b-aa11-46fb-be4c-3773085dc10b')).toMatchObject({
      title: 'Užmirštoji sala',
      originalTitle: 'Forgotten Island',
      isDubbed: true,
    });
  });

  test('drops programme labels and years so titles match other cinemas', async () => {
    const { screenings } = await runOnFixtures(createForumAdapter(), NOW);

    // "SCA'26: Išganymas" (Scanorama festival).
    expect(findScreening(screenings, 'c9b1dfe3-2c9b-4c40-a874-3332d2033658')).toMatchObject({
      title: 'Išganymas',
      originalTitle: 'Kurtuluş',
      spokenLanguage: 'tr',
    });
    // "Pamatyk kine: Kiti (2001)", from the movie fetched on its own.
    expect(findScreening(screenings, 'f1e911c5-568d-4f05-9e35-e640ecff0716')).toMatchObject({
      title: 'Kiti',
      originalTitle: 'The Others',
      year: 2001,
    });
    // A shorts programme keeps its own name; its empty original title and year are unknown.
    expect(findScreening(screenings, 'e4c573af-9ddd-4cb9-ba46-afbf1b4b3cd6')).toMatchObject({
      title: 'Europos blyksniai: I programa',
      originalTitle: null,
      year: null,
      spokenLanguage: null,
    });
    const titles = screenings.map((screening) => screening.title);
    expect(titles.filter((title) => /^SCA|\((dubliuotas|\d{4})\)$/.test(title))).toEqual([]);
  });

  test('leaves the unnamed "original language" (OR) unknown', async () => {
    const { screenings } = await runOnFixtures(createForumAdapter(), NOW);

    expect(findScreening(screenings, 'e664c6d5-f6fc-4933-9aaf-d08afd81598e')).toMatchObject({
      title: 'Rammstein - Live in Mexico City',
      spokenLanguage: null,
      subtitleLanguage: null,
      isDubbed: false,
    });
  });

  test('assigns cinemas through the registry, so Vingis is in Vilnius', async () => {
    const { screenings } = await runOnFixtures(createForumAdapter(), NOW);

    expect(new Set(screenings.map((screening) => screening.cinemaId))).toEqual(
      new Set(['forum-vingis', 'forum-kaunas', 'forum-klaipeda', 'forum-siauliai']),
    );
    expect(cinemaRegistry.get('forum-vingis')?.cityId).toBe('vilnius');
    expect(findScreening(screenings, 'fdbf33b3-3723-4ca9-831a-cea47c95123c').cinemaId).toBe(
      'forum-klaipeda',
    );
  });

  test('does not ask for hall names again on the next refresh', async () => {
    const adapter = createForumAdapter();
    await runOnFixtures(adapter, NOW);

    const later = await runOnFixtures(adapter, new Date(NOW.getTime() + 60 * 60 * 1000));

    expect(later.requests.filter((url) => url.endsWith('/screen'))).toEqual([]);
    expect(findScreening(later.screenings, '871eb2e5-3cdd-4d1f-abff-904f0985307d').hall).toBe(
      'IMAX salė',
    );
  });
});

describe('Forum Cinemas edge cases', () => {
  const region = { id: 'r1', cinemas: [{ id: VINGIS, name: 'Vingis' }] };
  const screening = (id: string, movieId: string) => ({
    id,
    cinemaId: VINGIS,
    screenId: 's1',
    movieId,
    screeningTimeFrom: '2026-11-01T00:30:00+02:00',
    printType: '3D',
    speakingType: 'ORG',
    language: 'EN',
    subtitles: 'LT',
  });
  const movie = {
    id: 'm1',
    title: 'Kopa',
    originalTitle: 'Dune',
    yearOfProduction: '2021',
    duration: 155,
    genres: [],
    posters: [],
    ratings: [],
  };
  const bodies = (overrides: Record<string, string> = {}) => ({
    [`${API}/region`]: JSON.stringify([region]),
    [screeningsUrl('r1')]: JSON.stringify([screening('a', 'm1'), screening('b', 'gone')]),
    [`${API}/movie`]: JSON.stringify([movie]),
    ...overrides,
  });

  test('asks for hall names again after a day, keeping the last known ones if that fails', async () => {
    const adapter = createForumAdapter();
    const halls = {
      [`${API}/cinema/${VINGIS}/screen`]: JSON.stringify([{ id: 's1', name: '5 salė' }]),
    };
    await runOnBodies(adapter, bodies(halls), NOW);

    const nextDay = new Date(NOW.getTime() + DAY_MS);
    const nextDayScreenings = `${API}/region/r1/screening?dateTimeFrom=2026-11-01T00:00:00&dateTimeTo=2027-01-31T00:00:00`;
    const { screenings, requests } = await runOnBodies(
      adapter,
      bodies({ [nextDayScreenings]: JSON.stringify([screening('a', 'm1')]) }),
      nextDay,
    );

    expect(requests).toContain(`${API}/cinema/${VINGIS}/screen`);
    expect(findScreening(screenings, 'a').hall).toBe('5 salė');
  });

  test('drops the event labels of premieres and introduced screenings', async () => {
    const titles = [
      ['LNK premjera: Kopa: Trečia dalis', 'LNK Premiere: Dune: Part Three'],
      [
        'PASIKLYDĘ EKRANE pristato: Kopa: Trečia dalis | Su Skirmantu Malinausku',
        'Dune: Part Three',
      ],
      ['PASIKLYDĘ EKRANE pristato: Kopa. Antra dalis', 'PASIKLYDĘ EKRANE pristato: Dune: Part Two'],
      ['TV3 premjera: Kalėdų nelaukiant', 'TV3 premjera: Kalėdų nelaukiant'],
    ];
    const movies = titles.map(([title, originalTitle], index) => ({
      ...movie,
      id: `m${String(index)}`,
      title,
      originalTitle,
    }));
    const { screenings } = await runOnBodies(
      createForumAdapter(),
      bodies({
        [screeningsUrl('r1')]: JSON.stringify(
          movies.map((item) => screening(`s-${item.id}`, item.id)),
        ),
        [`${API}/movie`]: JSON.stringify(movies),
      }),
      NOW,
    );

    // The bar's "Su Skirmantu Malinausku" is left for title matching, which ignores it.
    expect(screenings.map(({ title, originalTitle }) => [title, originalTitle])).toEqual([
      ['Kopa: Trečia dalis', 'Dune: Part Three'],
      ['Kopa: Trečia dalis | Su Skirmantu Malinausku', 'Dune: Part Three'],
      ['Kopa. Antra dalis', 'Dune: Part Two'],
      ['Kalėdų nelaukiant', 'Kalėdų nelaukiant'],
    ]);
  });

  test('skips screenings of a movie the API no longer has, and keeps the rest', async () => {
    const { screenings, skipped } = await runOnBodies(createForumAdapter(), bodies(), NOW);

    expect(screenings.map((item) => item.sourceScreeningId)).toEqual(['a']);
    expect(skipped).toEqual([
      { reason: 'movie not found', raw: expect.stringContaining('"b"') as string },
    ]);
  });

  test('a screening after midnight belongs to the date it starts on; unknown halls are null', async () => {
    const { screenings } = await runOnBodies(createForumAdapter(), bodies(), NOW);

    expect(findScreening(screenings, 'a')).toMatchObject({
      startsAt: new Date('2026-10-31T22:30:00Z'),
      format: '3D',
      hall: null,
      ageRating: null,
      posterUrl: null,
    });
  });

  test('skips a screening without a start time instead of failing the source', async () => {
    const broken = { ...screening('c', 'm1'), screeningTimeFrom: 'soon' };
    const { screenings, skipped } = await runOnBodies(
      createForumAdapter(),
      bodies({ [screeningsUrl('r1')]: JSON.stringify([screening('a', 'm1'), broken]) }),
      NOW,
    );

    expect(screenings.map((item) => item.sourceScreeningId)).toEqual(['a']);
    expect(skipped).toEqual([
      {
        reason: 'screening without id, movie or start time',
        raw: expect.stringContaining('"c"') as string,
      },
    ]);
  });
});
