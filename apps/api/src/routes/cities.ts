import type { CitiesResponse } from '@seansai/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cityName, type Queries } from '../db/queries.ts';
import { langSchema, parseQuery, setListCaching } from './http.ts';

type CitiesRouteOptions = { queries: Queries; now: () => Date };

const QuerySchema = z.object({ lang: langSchema });

/** Cities with at least one supported cinema, for the first-visit city prompt (FR-013). */
export const citiesRoutes: FastifyPluginAsync<CitiesRouteOptions> = (app, { queries, now }) => {
  app.get('/cities', async (request, reply): Promise<CitiesResponse> => {
    const { lang } = parseQuery(QuerySchema, request.query, {});
    const listed = await queries.listCities(now());
    setListCaching(reply);
    return {
      cities: listed.map(({ city, cinemaCount, hasMovies }) => ({
        id: city.id,
        name: cityName(city, lang),
        cinemaCount,
        hasMovies,
      })),
    };
  });
  return Promise.resolve();
};
