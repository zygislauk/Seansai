import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { openDb } from './db/index.ts';
import { Repository } from './db/repository.ts';
import { createLogger } from './lib/logger.ts';
import { createRefreshPipeline } from './refresh/pipeline.ts';
import { startBackgroundRefresh } from './refresh/startup.ts';
import { buildServer } from './server.ts';
import { logRobotsOverrides, sourceConfigs } from './sources/index.ts';
import { createClock } from './sources/runtime.ts';

const WEB_DIST_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));
const HOUR_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger();
  const clock = createClock(config);
  const db = await openDb(config.db.url, config.db.authToken);
  const repo = new Repository(db);

  if (config.sourcesMode === 'fixtures') {
    // Simulates sources whose last success was N hours ago (resilience scenario, FR-015).
    for (const [sourceId, hours] of Object.entries(config.fixtureLastSuccessHours)) {
      await repo.recordSourceSuccess(sourceId, new Date(clock().getTime() - hours * HOUR_MS));
    }
  }
  logRobotsOverrides(logger);

  const pipeline = createRefreshPipeline(config, repo, clock, logger);

  const server = buildServer({
    db,
    now: clock,
    logger,
    sourceIds: sourceConfigs
      .filter((source) => source.enabled && !config.disabledSources.includes(source.id))
      .map((source) => source.id),
    webDistDir: config.serveWebApp ? WEB_DIST_DIR : null,
    staleAfterMs: config.staleAfterMs,
    cron: config.cronSecret ? { secret: config.cronSecret, run: pipeline.runAll } : null,
  });
  await server.listen({ port: config.port, host: config.host });

  const scheduler = startBackgroundRefresh(config.refreshMode, pipeline.adapters, {
    mode: config.sourcesMode,
    clock,
    logger,
    refresh: pipeline.refresh,
    cleanup: pipeline.cleanup,
  });
  logger.info(
    {
      mode: config.sourcesMode,
      sources: pipeline.adapters.map((adapter) => adapter.id),
      now: clock(),
    },
    'Seansai API started',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    scheduler?.stop();
    await server.close();
    db.close();
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      shutdown(signal).catch((error: unknown) => {
        logger.error({ err: error }, 'Error during shutdown');
        process.exitCode = 1;
      });
    });
  }
}

main().catch((error: unknown) => {
  // The logger may not exist yet (e.g. invalid configuration), so report on stderr.
  console.error('Seansai API failed to start:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
