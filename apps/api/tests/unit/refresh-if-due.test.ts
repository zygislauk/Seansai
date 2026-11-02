import { describe, expect, test, vi } from 'vitest';
import type { SourceRecord } from '../../src/db/repository.ts';
import type { DailyRefreshResult } from '../../src/refresh/daily.ts';
import {
  exitCodeOf,
  minHoursBetweenRuns,
  refreshIfDue,
  requireSharedDatabase,
} from '../../src/refresh/if-due.ts';
import { createTestLogger } from '../helpers/test-logger.ts';

const NOW = new Date('2026-11-02T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;

const result: DailyRefreshResult = {
  sources: { apollo: 'success' },
  cleanup: { screenings: 0, movies: 0 },
};

function source(id: string, hoursAgo: number | null): SourceRecord {
  return {
    id,
    lastAttemptAt: hoursAgo === null ? null : new Date(NOW.getTime() - hoursAgo * HOUR_MS),
    lastSuccessAt: null,
    lastError: null,
  };
}

function setup(sources: SourceRecord[]) {
  const run = vi.fn().mockResolvedValue(result);
  const { logger, lines } = createTestLogger();
  const refresh = (minHours: number) =>
    refreshIfDue({
      sources: () => Promise.resolve(sources),
      run,
      clock: () => NOW,
      minHours,
      logger,
    });
  return { run, lines, refresh };
}

describe('refreshIfDue', () => {
  test('runs on a database no source has ever been refreshed in', async () => {
    const { run, refresh } = setup([]);

    expect(await refresh(20)).toBe(result);
    expect(run).toHaveBeenCalledOnce();
  });

  test('runs once the gap has passed since the latest attempt', async () => {
    const { run, refresh } = setup([
      source('apollo', 30),
      source('forum', 20),
      source('vue', null),
    ]);

    expect(await refresh(20)).toBe(result);
    expect(run).toHaveBeenCalledOnce();
  });

  test('skips within the gap, going by the most recent attempt of any source', async () => {
    const { run, lines, refresh } = setup([source('apollo', 30), source('forum', 19)]);

    expect(await refresh(20)).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(lines().map((line) => line.msg)).toContain(
      'Refreshed too recently; not contacting the cinemas',
    );
  });

  test('a failed attempt counts, so a refusing cinema is not asked again sooner', async () => {
    const failed = { ...source('forum', 1), lastError: 'Blocked by forum: HTTP 403' };
    const { run, refresh } = setup([failed]);

    expect(await refresh(20)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('minHoursBetweenRuns', () => {
  test('by hand, at most hourly, the limit for every source', () => {
    expect(minHoursBetweenRuns([])).toBe(1);
  });

  test('the scheduled job checks every hour and runs once a day', () => {
    expect(minHoursBetweenRuns(['--if-due'])).toBe(20);
  });
});

describe('exitCodeOf', () => {
  test.each([
    [null, 0],
    [result, 0],
    [{ ...result, sources: { apollo: 'disabled' } }, 0],
    [{ ...result, sources: { apollo: 'success', forum: 'failed' } }, 1],
  ] as const)('%j → %i', (outcome, code) => {
    expect(exitCodeOf(outcome)).toBe(code);
  });
});

describe('requireSharedDatabase', () => {
  test('accepts Turso', () => {
    expect(() => {
      requireSharedDatabase({ url: 'libsql://seansai-x.turso.io', authToken: 't' });
    }).not.toThrow();
  });

  test.each([
    { url: 'file:/tmp/seansai.sqlite', authToken: null },
    { url: ':memory:', authToken: null },
  ])('refuses $url: it would report success while the site stayed unchanged', (db) => {
    expect(() => {
      requireSharedDatabase(db);
    }).toThrow(/TURSO_DATABASE_URL/);
  });
});
