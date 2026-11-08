import type { HttpClient } from '../lib/polite-http.ts';
import { addDays, localDateOf, todayIn } from '../lib/time.ts';
import type { CinemaRegistry } from '../registry/cinemas.ts';
import {
  SourceScreeningSchema,
  type SourceAdapter,
  type SourceId,
  type SourceLimitation,
} from './types.ts';

/** Today and the next 6 days (quickstart "Live sources"). */
const DAYS_CHECKED = 7;

export type SourceCheck = {
  source: SourceId;
  robotsOverride: boolean;
  limitations: readonly SourceLimitation[];
  /** Why the fetch failed, or null. */
  error: string | null;
  /** Items that break the SourceScreening contract. */
  invalid: number;
  /** Items the adapter itself skipped (logged, not a failure). */
  skipped: number;
  days: string[];
  /** Per cinema: screenings on each of `days`. */
  countsByCinema: Record<string, number[]>;
  /** Empty when the source passes. */
  problems: string[];
};

type CheckContext = {
  now: Date;
  http: HttpClient;
  registry: CinemaRegistry;
  robotsOverride: boolean;
};

/**
 * Fetches one source once and checks it has screenings for today and each of the next 6 days. A
 * source that declares `today-only` only needs today.
 */
export async function checkSource(adapter: SourceAdapter, ctx: CheckContext): Promise<SourceCheck> {
  const today = todayIn(ctx.now);
  const days = Array.from({ length: DAYS_CHECKED }, (_, offset) => addDays(today, offset));
  const limitations = adapter.limitations ?? [];
  const report: SourceCheck = {
    source: adapter.id,
    robotsOverride: ctx.robotsOverride,
    limitations,
    error: null,
    invalid: 0,
    skipped: 0,
    days,
    countsByCinema: {},
    problems: [],
  };

  let items: unknown[];
  try {
    const result = await adapter.fetchScreenings({
      now: ctx.now,
      http: ctx.http,
      registry: ctx.registry,
    });
    items = result.screenings;
    report.skipped = result.skipped.length;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.problems.push(`fetch failed: ${report.error}`);
    return report;
  }

  const perDay = days.map(() => 0);
  for (const item of items) {
    const parsed = SourceScreeningSchema.safeParse(item);
    if (!parsed.success) {
      report.invalid++;
      continue;
    }
    const dayIndex = days.indexOf(localDateOf(parsed.data.startsAt));
    if (dayIndex === -1) continue;
    const counts = (report.countsByCinema[parsed.data.cinemaId] ??= days.map(() => 0));
    counts[dayIndex] = (counts[dayIndex] ?? 0) + 1;
    perDay[dayIndex] = (perDay[dayIndex] ?? 0) + 1;
  }

  const required = limitations.includes('today-only') ? days.slice(0, 1) : days;
  for (const day of required) {
    if (perDay[days.indexOf(day)] === 0) report.problems.push(`no screenings on ${day}`);
  }
  if (report.invalid > 0) {
    report.problems.push(`${String(report.invalid)} screening(s) fail validation`);
  }
  return report;
}

const pad = (text: string, width: number) => text.padEnd(width);

/** A plain-text report for the terminal. */
export function formatReport(reports: readonly SourceCheck[]): string {
  const lines: string[] = [];
  for (const report of reports) {
    const notes = [
      report.robotsOverride && 'robots.txt override',
      ...report.limitations.map((limitation) => `limitation: ${limitation}`),
      report.skipped > 0 && `${String(report.skipped)} skipped by the adapter`,
    ].filter(Boolean);
    lines.push(`${report.source}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`);
    if (report.error === null) {
      lines.push(
        `  ${pad('cinema', 22)}${report.days.map((day) => pad(day.slice(5), 7)).join('')}`,
      );
      for (const [cinema, counts] of Object.entries(report.countsByCinema)) {
        lines.push(`  ${pad(cinema, 22)}${counts.map((count) => pad(String(count), 7)).join('')}`);
      }
    }
    for (const problem of report.problems) lines.push(`  FAIL ${report.source}: ${problem}`);
    lines.push('');
  }
  const failed = reports.filter((report) => report.problems.length > 0).length;
  lines.push(
    failed === 0
      ? `All ${String(reports.length)} sources OK`
      : `${String(failed)} of ${String(reports.length)} sources failed`,
  );
  return lines.map((line) => line.trimEnd()).join('\n');
}
