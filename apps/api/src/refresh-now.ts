import { loadConfig } from './config.ts';
import { openDb } from './db/index.ts';
import { Repository } from './db/repository.ts';
import { createLogger } from './lib/logger.ts';
import { exitCodeOf, refreshIfDue, requireSharedDatabase } from './refresh/if-due.ts';
import { createRefreshPipeline } from './refresh/pipeline.ts';
import { logRobotsOverrides } from './sources/index.ts';
import { createClock } from './sources/runtime.ts';

/**
 * One refresh of every source into the shared database, then exit. Run from a home connection
 * (scripts/home-refresh.sh), because some cinemas refuse requests from Vercel (research.md §5).
 * `--if-due` is for the scheduled job.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  requireSharedDatabase(config.db);
  const logger = createLogger();
  const clock = createClock(config);
  const db = await openDb(config.db.url, config.db.authToken);
  const repo = new Repository(db);
  logRobotsOverrides(logger);

  const pipeline = createRefreshPipeline(config, repo, clock, logger);
  const result = await refreshIfDue({
    sources: () => repo.listSources(),
    run: pipeline.runAll,
    retry: pipeline.runOnly,
    clock,
    args: process.argv.slice(2),
    logger,
  });
  db.close();
  process.exitCode = exitCodeOf(result);
}

main().catch((error: unknown) => {
  console.error('Refresh failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
