import type { Config } from '../config.ts';
import type { SourceRecord } from '../db/repository.ts';
import { isRefusal } from '../lib/errors.ts';
import type { Logger } from '../lib/logger.ts';
import { localDateOf } from '../lib/time.ts';
import type { DailyRefreshResult } from './daily.ts';

const HOUR_MS = 60 * 60 * 1000;
/** The limit for every source (research.md §1b), however a refresh is started. */
const MIN_HOURS_BETWEEN_RUNS = 1;

/**
 * Whether to contact the cinemas now. The scheduled job (`--if-due`) checks every hour, so that a
 * machine that was asleep or offline catches up, and runs on the first check of each Vilnius day.
 * That keeps the time from drifting, and it is what suits a cinema listing only today's sessions.
 */
export function isDue(lastAttempt: Date | null, now: Date, args: readonly string[]): boolean {
  if (lastAttempt === null) return true;
  if (now.getTime() - lastAttempt.getTime() < MIN_HOURS_BETWEEN_RUNS * HOUR_MS) return false;
  return !args.includes('--if-due') || localDateOf(lastAttempt) !== localDateOf(now);
}

/**
 * The sources to try again before the next day's refresh. A Mac going back to sleep mid-refresh
 * fails whichever sources were still crawling (002 research.md), which says nothing about the
 * cinema. A cinema that refused us is different: it isn't asked again until the next day.
 */
function sourcesToRetry(sources: readonly SourceRecord[], now: Date): string[] {
  return sources
    .filter(
      ({ lastAttemptAt, lastError }) =>
        lastError !== null &&
        !isRefusal(lastError) &&
        lastAttemptAt !== null &&
        now.getTime() - lastAttemptAt.getTime() >= MIN_HOURS_BETWEEN_RUNS * HOUR_MS,
    )
    .map(({ id }) => id);
}

/**
 * Runs the refresh if it is due, going by the latest attempt of any source. If it isn't, retries
 * the sources that failed; null if there are none.
 */
export async function refreshIfDue(deps: {
  sources: () => Promise<SourceRecord[]>;
  run: () => Promise<DailyRefreshResult>;
  retry: (sourceIds: readonly string[]) => Promise<DailyRefreshResult>;
  clock: () => Date;
  args: readonly string[];
  logger: Logger;
}): Promise<DailyRefreshResult | null> {
  const { sources, run, retry, clock, args, logger } = deps;
  const records = await sources();
  const attempts = records.flatMap(({ lastAttemptAt }) =>
    lastAttemptAt === null ? [] : [lastAttemptAt.getTime()],
  );
  const latest = attempts.length > 0 ? new Date(Math.max(...attempts)) : null;
  const now = clock();
  if (isDue(latest, now, args)) return run();

  const failed = sourcesToRetry(records, now);
  if (failed.length > 0) {
    logger.info({ sources: failed }, 'Retrying the sources that failed');
    return retry(failed);
  }
  logger.info({ lastAttemptAt: latest }, 'Refreshed too recently; not contacting the cinemas');
  return null;
}

/** Failing sources keep their previous data, but whoever ran this should hear about them. */
export function exitCodeOf(result: DailyRefreshResult | null): number {
  return result && Object.values(result.sources).includes('failed') ? 1 : 0;
}

/** A refresh of a local file would report success while the public site stayed unchanged. */
export function requireSharedDatabase(db: Config['db']): void {
  if (!db.url.startsWith('libsql:')) {
    throw new Error('Set TURSO_DATABASE_URL: this refreshes the database the public site reads');
  }
}
