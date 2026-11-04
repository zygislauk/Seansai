import type { SourceId } from '../sources/types.ts';

export type Chain =
  | 'apollo'
  | 'forum'
  | 'pasaka'
  | 'skalvija'
  | 'atlantis'
  | 'romuva'
  | 'garsas'
  | 'vue'
  | 'cinamon'
  | 'arlekinas';

export type Cinema = {
  id: string;
  /** Display name. */
  name: string;
  chain: Chain;
  cityId: string;
  address?: string;
  /** Fallback ticket link when a screening has no page of its own (FR-009). */
  websiteUrl: string;
  sourceId: SourceId;
  /**
   * The source's own ids for this venue: MCS area id, Forum `cinemaId`, Vue cinema id, Cinamon
   * `pid`. Sources that cover a single venue use the key `main`.
   */
  sourceVenueKeys: readonly string[];
};

/**
 * The registry, not the feed, decides each cinema's city: Forum's feed places Vingis in Kaunas
 * although it is in Vilnius (research.md, Source data quirks).
 */
export const cinemas: readonly Cinema[] = [
  {
    id: 'apollo-akropolis',
    name: 'Apollo Akropolis',
    chain: 'apollo',
    cityId: 'vilnius',
    websiteUrl: 'https://www.apollokinas.lt',
    sourceId: 'apollo',
    sourceVenueKeys: ['1019'],
  },
  {
    id: 'apollo-outlet',
    name: 'Apollo Outlet',
    chain: 'apollo',
    cityId: 'vilnius',
    websiteUrl: 'https://www.apollokinas.lt',
    sourceId: 'apollo',
    sourceVenueKeys: ['1024'],
  },
  {
    id: 'apollo-molas',
    name: 'Apollo Molas',
    chain: 'apollo',
    cityId: 'panevezys',
    websiteUrl: 'https://www.apollokinas.lt',
    sourceId: 'apollo',
    sourceVenueKeys: ['1018'],
  },
  {
    id: 'forum-vingis',
    name: 'Forum Cinemas Vingis',
    chain: 'forum',
    cityId: 'vilnius',
    address: 'Savanorių pr. 7, Vilnius',
    websiteUrl: 'https://www.forumcinemas.lt',
    sourceId: 'forum',
    sourceVenueKeys: ['f933f355-2e6b-466f-9b97-e267ecd8e266'],
  },
  {
    id: 'forum-kaunas',
    name: 'Forum Cinemas Kaunas',
    chain: 'forum',
    cityId: 'kaunas',
    websiteUrl: 'https://www.forumcinemas.lt',
    sourceId: 'forum',
    sourceVenueKeys: ['b4662f38-8b50-4533-9eb8-c26ae4394a78'],
  },
  {
    id: 'forum-klaipeda',
    name: 'Forum Cinemas Klaipėda',
    chain: 'forum',
    cityId: 'klaipeda',
    websiteUrl: 'https://www.forumcinemas.lt',
    sourceId: 'forum',
    sourceVenueKeys: ['40025d9f-a5cd-4bb9-bd4b-d01c52558731'],
  },
  {
    id: 'forum-siauliai',
    name: 'Forum Cinemas Šiauliai',
    chain: 'forum',
    cityId: 'siauliai',
    websiteUrl: 'https://www.forumcinemas.lt',
    sourceId: 'forum',
    sourceVenueKeys: ['4c3fe3b1-90c1-4268-9c9f-d86e91cd2a44'],
  },
  {
    id: 'pasaka-paupys',
    name: 'Pasaka Paupys',
    chain: 'pasaka',
    cityId: 'vilnius',
    websiteUrl: 'https://kinopasaka.lt',
    sourceId: 'pasaka',
    sourceVenueKeys: ['1033'],
  },
  {
    id: 'pasaka-senamiestis',
    name: 'Pasaka Senamiestis',
    chain: 'pasaka',
    cityId: 'vilnius',
    websiteUrl: 'https://kinopasaka.lt',
    sourceId: 'pasaka',
    sourceVenueKeys: ['1034'],
  },
  {
    // Seasonal open-air venue; it simply has no screenings outside the season.
    id: 'pasaka-kalnu-parkas',
    name: 'Pasaka Kalnų parko estrada',
    chain: 'pasaka',
    cityId: 'vilnius',
    websiteUrl: 'https://kinopasaka.lt',
    sourceId: 'pasaka',
    sourceVenueKeys: ['1042'],
  },
  {
    id: 'arlekinas',
    name: 'Kino teatras Arlekinas',
    chain: 'arlekinas',
    cityId: 'klaipeda',
    address: 'Bangų g. 5A, Klaipėda',
    websiteUrl: 'https://kinasarlekinas.lt',
    sourceId: 'arlekinas',
    sourceVenueKeys: ['main'],
  },
  {
    id: 'skalvija',
    name: 'Skalvija',
    chain: 'skalvija',
    cityId: 'vilnius',
    websiteUrl: 'https://skalvija.lt',
    sourceId: 'skalvija',
    sourceVenueKeys: ['main'],
  },
  {
    id: 'atlantis',
    name: 'Atlantis Cinemas',
    chain: 'atlantis',
    cityId: 'siauliai',
    websiteUrl: 'https://atlantiscinemas.lt',
    sourceId: 'atlantis',
    sourceVenueKeys: ['main'],
  },
  {
    id: 'garsas',
    name: 'Kino centras Garsas',
    chain: 'garsas',
    cityId: 'panevezys',
    websiteUrl: 'https://bilietai.garsas.lt',
    sourceId: 'garsas',
    sourceVenueKeys: ['main'],
  },
  {
    id: 'romuva',
    name: 'Kauno kino centras Romuva',
    chain: 'romuva',
    cityId: 'kaunas',
    websiteUrl: 'https://bilietai.kcromuva.lt',
    sourceId: 'romuva',
    sourceVenueKeys: ['main'],
  },
  {
    id: 'vue-vilnius',
    name: 'Vue Vilnius',
    chain: 'vue',
    cityId: 'vilnius',
    websiteUrl: 'https://vuekinas.lt',
    sourceId: 'vue',
    sourceVenueKeys: ['1001'],
  },
  {
    id: 'cinamon-mega',
    name: 'Cinamon Mega',
    chain: 'cinamon',
    cityId: 'kaunas',
    websiteUrl: 'https://cinamonkino.com/mega/lt',
    sourceId: 'cinamon',
    sourceVenueKeys: ['77139293'],
  },
];

export class CinemaRegistry {
  readonly #byId: ReadonlyMap<string, Cinema>;
  readonly #bySourceKey: ReadonlyMap<string, Cinema>;

  constructor(entries: readonly Cinema[]) {
    this.#byId = new Map(entries.map((cinema) => [cinema.id, cinema]));
    this.#bySourceKey = new Map(
      entries.flatMap((cinema) =>
        cinema.sourceVenueKeys.map((key) => [`${cinema.sourceId}\u0000${key}`, cinema] as const),
      ),
    );
  }

  all(): Cinema[] {
    return [...this.#byId.values()];
  }

  get(id: string): Cinema | undefined {
    return this.#byId.get(id);
  }

  findBySourceKey(sourceId: string, key: string): Cinema | undefined {
    return this.#bySourceKey.get(`${sourceId}\u0000${key}`);
  }
}

export const cinemaRegistry = new CinemaRegistry(cinemas);
