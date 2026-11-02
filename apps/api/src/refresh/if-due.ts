import type { Config } from '../config.ts';
import type { SourceRecord } from '../db/repository.ts';
import type { Logger } from '../lib/logger.ts';
import type { DailyRefreshResult } from './daily.ts';

const HOUR_MS = 60 * 60 * 1000;
/** The limit for every source (research.md §1b), which also holds for a refresh run by hand. */
const MIN_HOURS_BY_HAND = 1;
/**
 * The scheduled job checks every hour, so that a machine that was asleep or offline catches up,
 * and this makes it run once a day. Under 24 h, so the time of day is free to move earlier.
 */
const MIN_HOURS_IF_DUE = 20;

export function minHoursBetweenRuns(args: readonly string[]): number {
  return args.includes('--if-due') ? MIN_HOURS_IF_DUE : MIN_HOURS_BY_HAND;
}

/** Runs the refresh unless any source was attempted within `minHours`; null when it did not. */
export async function refreshIfDue(deps: {
  sources: () => Promise<SourceRecord[]>;
  run: () => Promise<DailyRefreshResult>;
  clock: () => Date;
  minHours: number;
  logger: Logger;
}): Promise<DailyRefreshResult | null> {
  const { sources, run, clock, minHours, logger } = deps;
  const attempts = (await sources()).flatMap(({ lastAttemptAt }) =>
    lastAttemptAt === null ? [] : [lastAttemptAt.getTime()],
  );
  const hoursSince = (clock().getTime() - Math.max(0, ...attempts)) / HOUR_MS;
  if (hoursSince < minHours) {
    logger.info({ hoursSince, minHours }, 'Refreshed too recently; not contacting the cinemas');
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
