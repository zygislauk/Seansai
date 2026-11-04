import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import type { Db } from '../../src/db/index.ts';
import { Repository } from '../../src/db/repository.ts';
import { runDailyRefresh, type DailyRefreshResult } from '../../src/refresh/daily.ts';
import { refreshSource } from '../../src/refresh/refresh-source.ts';
import { cinemaRegistry } from '../../src/registry/cinemas.ts';
import { buildServer, type ServerOptions } from '../../src/server.ts';
import { FixtureHttpClient } from '../../src/sources/fixture-http.ts';
import { forumAdapter } from '../../src/sources/forum/adapter.ts';
import { apolloAdapter } from '../../src/sources/mcs/adapter.ts';
import { adapterNow, createClock } from '../../src/sources/runtime.ts';
import { createTempDb } from '../helpers/temp-db.ts';
import { createTestLogger } from '../helpers/test-logger.ts';

const SECRET = 's3cret';
const NOT_FOUND = { error: { code: 'not_found', message: 'There is no such API route.' } };
const result: DailyRefreshResult = {
  sources: { apollo: 'success', forum: 'failed', vue: 'disabled' },
  cleanup: { screenings: 4, movies: 1 },
};

let app: FastifyInstance;
let db: Db;
let cleanup: () => void;

async function startServer(
  cron: NonNullable<ServerOptions['cron']> | null,
): Promise<FastifyInstance> {
  const temp = await createTempDb();
  cleanup = temp.cleanup;
  db = temp.db;
  app = buildServer({
    db,
    now: () => new Date(),
    logger: createTestLogger().logger,
    cron,
  });
  return app;
}

afterEach(async () => {
  await app.close();
  cleanup();
});

describe('GET /api/v1/cron/daily', () => {
  test('without the secret answers 404 like an unknown route and runs nothing', async () => {
    const run = vi.fn().mockResolvedValue(result);
    await startServer({ secret: SECRET, run });

    for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: SECRET }]) {
      const response = await app.inject({ url: '/api/v1/cron/daily', headers });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(NOT_FOUND);
    }
    expect(run).not.toHaveBeenCalled();
  });

  test('with the secret runs the daily refresh and returns its summary, uncached', async () => {
    const run = vi.fn().mockResolvedValue(result);
    await startServer({ secret: SECRET, run });

    const response = await app.inject({
      url: '/api/v1/cron/daily',
      headers: { authorization: `Bearer ${SECRET}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('does not exist when no secret is configured', async () => {
    await startServer(null);

    const response = await app.inject({
      url: '/api/v1/cron/daily',
      headers: { authorization: `Bearer ${SECRET}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(NOT_FOUND);
  });

  test('the kill switch reports a disabled source and leaves it uncontacted', async () => {
    const forumHttp = new FixtureHttpClient({ sourceId: 'forum', failingSources: [] });
    const apolloHttp = new FixtureHttpClient({ sourceId: 'apollo', failingSources: [] });
    const forumRequests = vi.spyOn(forumHttp, 'getText');
    const apolloRequests = vi.spyOn(apolloHttp, 'getText');
    const config = loadConfig({ SOURCES_MODE: 'fixtures' });
    const { logger } = createTestLogger();
    await startServer({
      secret: SECRET,
      run: () =>
        runDailyRefresh({
          adapters: [forumAdapter, apolloAdapter],
          refresh: (adapter, now) =>
            refreshSource(adapter, {
              repo: new Repository(db),
              registry: cinemaRegistry,
              http: adapter.id === 'forum' ? forumHttp : apolloHttp,
              now,
              sourceNow: adapterNow(adapter.id, config, now),
              aliases: [],
              logger,
              disabledSources: ['forum'],
            }),
          cleanup: () => Promise.resolve({ screenings: 0, movies: 0 }),
          clock: createClock(config),
          logger,
        }),
    });

    const response = await app.inject({
      url: '/api/v1/cron/daily',
      headers: { authorization: `Bearer ${SECRET}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<DailyRefreshResult>().sources).toEqual({
      forum: 'disabled',
      apollo: 'success',
    });
    expect(forumRequests).not.toHaveBeenCalled();
    expect(apolloRequests).toHaveBeenCalled();
  });
});
