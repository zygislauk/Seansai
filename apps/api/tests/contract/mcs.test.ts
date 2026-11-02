import { describe, expect, test } from 'vitest';
import { localDateOf } from '../../src/lib/time.ts';
import { apolloAdapter, createMcsAdapter, pasakaAdapter } from '../../src/sources/mcs/adapter.ts';
import { findScreening, runOnBodies, runOnFixtures } from '../helpers/adapters.ts';

/** Capture instant of the Apollo and Pasaka fixtures (tests/fixtures/README.md). */
const NOW = new Date('2026-10-30T17:39:42Z');

describe('Apollo (MCS JSON feed)', () => {
  test('requests 14 days of schedule per registered area, from today', async () => {
    const { requests } = await runOnFixtures(apolloAdapter, NOW);

    expect(requests).toEqual([
      'https://www.apollokinas.lt/xml/Schedule/?area=1019&dt=30.10.2026&nrOfDays=14',
      'https://www.apollokinas.lt/xml/Schedule/?area=1024&dt=30.10.2026&nrOfDays=14',
      'https://www.apollokinas.lt/xml/Schedule/?area=1018&dt=30.10.2026&nrOfDays=14',
    ]);
  });

  test('maps every show, resolving the venue through the requested area', async () => {
    const { screenings, skipped } = await runOnFixtures(apolloAdapter, NOW);

    expect(screenings).toHaveLength(634);
    expect(skipped).toEqual([]);
    expect(new Set(screenings.map((screening) => screening.cinemaId))).toEqual(
      new Set(['apollo-akropolis', 'apollo-outlet', 'apollo-molas']),
    );
    expect(findScreening(screenings, '422982').cinemaId).toBe('apollo-molas');
  });

  test('maps a show with its instant, languages, format and ticket link', async () => {
    const { screenings } = await runOnFixtures(apolloAdapter, NOW);

    expect(findScreening(screenings, '420907')).toEqual({
      sourceScreeningId: '420907',
      cinemaId: 'apollo-akropolis',
      startsAt: new Date('2026-10-30T08:10:00Z'),
      title: 'Vesper',
      originalTitle: 'Vesper',
      englishTitle: 'Vesper',
      year: 2022,
      durationMinutes: 112,
      ageRating: 'N13',
      genres: ['drama', 'mokslinė fantastika', 'nuotykių', 'Lietuviškas kinas'],
      posterUrl:
        'https://mcswebsites.blob.core.windows.net/1050/Event_7563/portrait_medium/2592x3840_Vesper.png',
      hall: '6 salė',
      format: null,
      spokenLanguage: 'en',
      subtitleLanguage: 'lt',
      isDubbed: false,
      ticketUrl: 'https://www.apollokinas.lt/websales/show/420907',
    });
  });

  test('tidies hall names and marks a foreign film spoken in Lithuanian as dubbed', async () => {
    const { screenings } = await runOnFixtures(apolloAdapter, NOW);

    expect(findScreening(screenings, '422982').hall).toBe('1 salė');
    expect(findScreening(screenings, '422279')).toMatchObject({
      title: 'Mergaitė ir stebuklinga plunksna',
      originalTitle: 'Girl In The Clouds',
      englishTitle: 'Girl In The Clouds',
      spokenLanguage: 'lt',
      isDubbed: true,
    });
  });
});

describe('Pasaka (MCS XML feed)', () => {
  test('parses XML, including an area without shows', async () => {
    const { screenings, requests } = await runOnFixtures(pasakaAdapter, NOW);

    expect(requests).toHaveLength(3);
    expect(screenings).toHaveLength(141);
    expect(screenings.some((screening) => screening.cinemaId === 'pasaka-kalnu-parkas')).toBe(
      false,
    );
  });

  test('reads dubbing from the title marker and drops the year from the original title', async () => {
    const { screenings } = await runOnFixtures(pasakaAdapter, NOW);

    expect(findScreening(screenings, '983986')).toEqual({
      sourceScreeningId: '983986',
      cinemaId: 'pasaka-paupys',
      startsAt: new Date('2026-10-30T13:50:00Z'),
      title: 'Monstriukė Mija (dubliuotas)',
      originalTitle: 'Monster Mia',
      englishTitle: null,
      year: 2026,
      durationMinutes: 81,
      ageRating: 'V',
      genres: ['Animacija', 'Nuotykių', 'Fantastinis', 'Šeimai'],
      posterUrl: null,
      hall: '„Paupio“ salė',
      format: null,
      spokenLanguage: 'lt',
      subtitleLanguage: null,
      isDubbed: true,
      ticketUrl: 'http://bilietai.kinopasaka.lt/websales/show/983986/',
    });
  });

  test('takes the spoken language from "PresentationMethodAndLanguage" when the field is empty', async () => {
    const { screenings } = await runOnFixtures(pasakaAdapter, NOW);

    expect(findScreening(screenings, '992253')).toMatchObject({
      cinemaId: 'pasaka-senamiestis',
      title: 'Praktinė magija 2',
      originalTitle: 'Practical Magic 2',
      spokenLanguage: 'en',
      subtitleLanguage: 'lt',
      isDubbed: false,
    });
  });
});

describe('MCS edge cases', () => {
  const adapter = createMcsAdapter({
    id: 'apollo',
    baseUrl: 'https://mcs.test/xml/',
    areaIds: ['1019'],
  });
  const url = 'https://mcs.test/xml/Schedule/?area=1019&dt=30.10.2026&nrOfDays=14';
  const show = (fields: Record<string, unknown>) =>
    JSON.stringify({
      PubDate: '2026-10-30T00:00:00',
      Shows: [
        {
          ID: 1,
          dtAccounting: '2026-10-30T00:00:00',
          dttmShowStartUTC: '2026-10-30T22:30:00Z',
          Title: 'Naktinis seansas',
          OriginalTitle: 'Late Show',
          ProductionYear: 0,
          LengthInMinutes: 95,
          RatingLabel: '-',
          Genres: '',
          PresentationMethod: '3D',
          TheatreAuditorium: '2 salė',
          ShowURL: 'https://mcs.test/websales/show/1',
          SpokenLanguage: null,
          SubtitleLanguage1: null,
          Images: null,
          ...fields,
        },
      ],
    });

  test('a show after midnight belongs to the calendar day it starts, not dtAccounting', async () => {
    const { screenings } = await runOnBodies(adapter, { [url]: show({}) }, NOW);
    const [screening] = screenings;

    expect(screening?.startsAt).toEqual(new Date('2026-10-30T22:30:00Z'));
    expect(screening && localDateOf(screening.startsAt)).toBe('2026-10-31');
  });

  test('shows no format for 3D and treats a zero year and "-" rating as unknown', async () => {
    const { screenings } = await runOnBodies(adapter, { [url]: show({}) }, NOW);

    expect(screenings[0]).toMatchObject({ format: null, year: null, ageRating: null, genres: [] });
  });

  test('skips a show without a valid start time instead of failing the source', async () => {
    const { screenings, skipped } = await runOnBodies(
      adapter,
      { [url]: show({ dttmShowStartUTC: 'soon' }) },
      NOW,
    );

    expect(screenings).toEqual([]);
    expect(skipped).toHaveLength(1);
  });
});
