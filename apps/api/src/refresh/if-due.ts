import type { Config } from '../config.ts';
import type { SourceRecord } from '../db/repository.ts';
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

/** Runs the refresh if it is due, going by the latest attempt of any source; null if it was not. */
export async function refreshIfDue(deps: {
  sources: () => Promise<SourceRecord[]>;
  run: () => Promise<DailyRefreshResult>;
  clock: () => Date;
  args: readonly string[];
  logger: Logger;
}): Promise<DailyRefreshResult | null> {
  const { sources, run, clock, args, logger } = deps;
  const attempts = (await sources()).flatMap(({ lastAttemptAt }) =>
    lastAttemptAt === null ? [] : [lastAttemptAt.getTime()],
  );
  const latest = attempts.length > 0 ? new Date(Math.max(...attempts)) : null;
  if (!isDue(latest, clock(), args)) {
    logger.info({ lastAttemptAt: latest }, 'Refreshed too recently; not contacting the cinemas');
    return null;
  }
  return run();
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
