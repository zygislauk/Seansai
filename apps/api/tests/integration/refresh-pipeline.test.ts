import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadConfig } from '../../src/config.ts';
import type { Db } from '../../src/db/index.ts';
import { Repository } from '../../src/db/repository.ts';
import { createRefreshPipeline } from '../../src/refresh/pipeline.ts';
import { createClock } from '../../src/sources/runtime.ts';
import { screeningRecord, seedMovies, seedScreenings, movieRecord } from '../helpers/temp-db.ts';
import { createTempDb } from '../helpers/temp-db.ts';
import { createTestLogger } from '../helpers/test-logger.ts';

/** What `refresh-now.ts` runs: all of it, over the saved fixtures. */
describe('createRefreshPipeline', () => {
  let db: Db;
  let repo: Repository;
  let cleanup: () => void;

  beforeEach(async () => {
    ({ db, cleanup } = await createTempDb());
    repo = new Repository(db);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  const pipelineWith = (env: Record<string, string> = {}) => {
    const config = loadConfig({ SOURCES_MODE: 'fixtures', ...env });
    const { logger } = createTestLogger();
    return createRefreshPipeline(config, repo, createClock(config), logger);
  };

  test('refreshes every source and stores what it found', async () => {
    const pipeline = pipelineWith();

    const result = await pipeline.runAll();

    expect(Object.keys(result.sources).toSorted()).toEqual(
      pipeline.adapters.map((adapter) => adapter.id).toSorted(),
    );
    expect(Object.values(result.sources)).not.toContain('failed');
    expect((await db.execute('SELECT id FROM screenings LIMIT 1')).rows).toHaveLength(1);
  });

  test('asks for a snapshot build once every source has finished', async () => {
    const hook = 'https://api.vercel.com/v1/integrations/deploy/prj/hook';
    let refreshedWhenCalled = -1;
    const fetch = vi.fn(async () => {
      const sources = await repo.listSources();
      refreshedWhenCalled = sources.filter(({ lastSuccessAt }) => lastSuccessAt !== null).length;
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);

    const { sources } = await pipelineWith({ VERCEL_DEPLOY_HOOK_URL: hook }).runAll();

    expect(fetch).toHaveBeenCalledWith(hook, expect.objectContaining({ method: 'POST' }));
    expect(refreshedWhenCalled).toBe(Object.keys(sources).length);
  });

  test('the kill switch stops a source being contacted', async () => {
    const result = await pipelineWith({ DISABLED_SOURCES: 'forum,vue' }).runAll();

    expect(result.sources).toMatchObject({ forum: 'disabled', vue: 'disabled', apollo: 'success' });
    expect((await repo.listSources()).map(({ id }) => id)).not.toContain('forum');
  });

  test('cleans up after refreshing', async () => {
    await seedMovies(repo, [{ movie: movieRecord() }]);
    await seedScreenings(repo, 'seed', new Date(0), [
      screeningRecord({
        id: 'seed:past',
        sourceId: 'seed',
        startsAt: new Date('2020-01-01T17:00:00Z'),
        localDate: '2020-01-01',
      }),
    ]);

    const result = await pipelineWith().runAll();

    expect(result.cleanup.screenings).toBeGreaterThan(0);
    expect((await db.execute("SELECT id FROM screenings WHERE id = 'seed:past'")).rows).toEqual([]);
  });
});
