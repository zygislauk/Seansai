import { addDays, todayIn } from '../lib/time.ts';

/**
 * How far ahead Seansai lists screenings, the same for every venue: from today through today + 90
 * days (Vilnius dates). Adapters that ask their source for a date range ask for exactly this; the
 * refresh drops anything later, so a source that publishes further ahead is cut at the same date.
 */
export const DAYS_AHEAD = 90;

/** The last listed date (`YYYY-MM-DD`). */
export function lastListedDate(now: Date): string {
  return addDays(todayIn(now), DAYS_AHEAD);
}
