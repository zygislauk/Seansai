import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { DailyRefreshResult } from '../refresh/daily.ts';
import { errorBody } from './http.ts';

type CronRouteOptions = { secret: string; run: () => Promise<DailyRefreshResult> };

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * A refresh on demand, the fallback when the home machine is away, called with
 * `Authorization: Bearer <CRON_SECRET>`. Anyone else gets the unknown-route 404, so the route reveals nothing and no
 * cinema is contacted (FR-008, contracts/cron-endpoint.md). The header is never logged.
 */
export const cronRoutes: FastifyPluginAsync<CronRouteOptions> = (app, { secret, run }) => {
  const expected = digest(`Bearer ${secret}`);

  app.get('/cron/daily', async (request, reply) => {
    // Equal-length digests, compared in constant time, so timing reveals nothing about the secret.
    const authorized = timingSafeEqual(digest(request.headers.authorization ?? ''), expected);
    if (!authorized) {
      return reply.status(404).send(errorBody('not_found', 'There is no such API route.'));
    }
    reply.header('cache-control', 'no-store');
    return run();
  });
  return Promise.resolve();
};
