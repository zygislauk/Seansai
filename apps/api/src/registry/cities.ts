export type City = {
  id: string;
  nameLt: string;
  nameEn: string;
};

/** Cities with at least one supported cinema (FR-002). */
export const cities: readonly City[] = [
  { id: 'vilnius', nameLt: 'Vilnius', nameEn: 'Vilnius' },
  { id: 'kaunas', nameLt: 'Kaunas', nameEn: 'Kaunas' },
  { id: 'klaipeda', nameLt: 'Klaipėda', nameEn: 'Klaipeda' },
  { id: 'siauliai', nameLt: 'Šiauliai', nameEn: 'Siauliai' },
  { id: 'panevezys', nameLt: 'Panevėžys', nameEn: 'Panevezys' },
];

const citiesById = new Map(cities.map((city) => [city.id, city]));

export function findCity(id: string): City | undefined {
  return citiesById.get(id);
}
