import type { Config } from '../config.ts';
import type { Repository } from '../db/repository.ts';
import type { Logger } from '../lib/logger.ts';
import { todayIn } from '../lib/time.ts';
import { loadAliases } from '../matching/match.ts';
import { cinemaRegistry } from '../registry/cinemas.ts';
import { adapters, findSourceConfig } from '../sources/index.ts';
import { adapterNow, createHttpClient } from '../sources/runtime.ts';
import type { SourceAdapter } from '../sources/types.ts';
import { runDailyRefresh } from './daily.ts';
import { requestSnapshotBuild } from './deploy-hook.ts';
import { refreshSource, type RefreshOutcome } from './refresh-source.ts';

/** How to refresh each enabled source and clean up: the server and `refresh-now.ts` share this. */
export function createRefreshPipeline(
  config: Config,
  repo: Repository,
  clock: () => Date,
  logger: Logger,
) {
  const enabledAdapters = adapters.filter((adapter) => findSourceConfig(adapter.id)?.enabled);
  const httpClients = new Map(
    enabledAdapters.map((adapter) => [adapter.id, createHttpClient(adapter, config, logger)]),
  );
  const aliases = loadAliases();

  const refresh = (adapter: SourceAdapter, now: Date): Promise<RefreshOutcome> => {
    const http = httpClients.get(adapter.id);
    if (!http) throw new Error(`No HTTP client for source ${adapter.id}`);
    return refreshSource(adapter, {
      repo,
      registry: cinemaRegistry,
      http,
      now,
      sourceNow: adapterNow(adapter.id, config, now),
      aliases,
      logger,
      disabledSources: config.disabledSources,
    });
  };
  const cleanup = async (now: Date): Promise<{ screenings: number; movies: number }> => {
    const screenings = await repo.deletePastScreenings(todayIn(now));
    const movies = await repo.deleteStaleMovies(now);
    logger.info({ screenings, movies }, 'Daily cleanup removed past screenings and old movies');
    return { screenings, movies };
  };
  const runAdapters = async (selected: readonly SourceAdapter[]) => {
    const result = await runDailyRefresh({
      adapters: selected,
      refresh,
      cleanup,
      clock,
      logger,
    });
    await requestSnapshotBuild(result.sources, { url: config.deployHookUrl, logger });
    return result;
  };
  const runAll = () => runAdapters(enabledAdapters);
  const runOnly = (sourceIds: readonly string[]) =>
    runAdapters(enabledAdapters.filter((adapter) => sourceIds.includes(adapter.id)));

  return { adapters: enabledAdapters, refresh, cleanup, runAll, runOnly };
}
