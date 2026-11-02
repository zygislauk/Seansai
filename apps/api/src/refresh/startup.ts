import type { Config } from '../config.ts';
import type { SourceAdapter } from '../sources/types.ts';
import { startScheduler, type Scheduler, type SchedulerOptions } from './scheduler.ts';

/**
 * Starts the server's own refreshing, unless it is refreshed from outside (`cron` mode). On Vercel
 * every cold start of a function would otherwise fetch from every cinema, however often visitors
 * arrive (FR-007).
 */
export function startBackgroundRefresh(
  mode: Config['refreshMode'],
  adapters: readonly SourceAdapter[],
  options: SchedulerOptions,
): Scheduler | null {
  if (mode === 'cron') {
    options.logger.info('Refresh runs from outside; scheduler not started');
    return null;
  }
  return startScheduler(adapters, options);
}
