import { describe, expect, test, vi } from 'vitest';
import type { SourceRecord } from '../../src/db/repository.ts';
import type { DailyRefreshResult } from '../../src/refresh/daily.ts';
import {
  exitCodeOf,
  isDue,
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
  const refresh = (args: string[] = ['--if-due']) =>
    refreshIfDue({
      sources: () => Promise.resolve(sources),
      run,
      clock: () => NOW,
      args,
      logger,
    });
  return { run, lines, refresh };
}

describe('refreshIfDue', () => {
  test('runs on a database no source has ever been refreshed in', async () => {
    const { run, refresh } = setup([]);

    expect(await refresh()).toBe(result);
    expect(run).toHaveBeenCalledOnce();
  });

  test('goes by the most recent attempt of any source', async () => {
    const { run, lines, refresh } = setup([
      source('apollo', 30),
      source('forum', 2),
      source('vue', null),
    ]);

    expect(await refresh()).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(lines().map((line) => line.msg)).toContain(
      'Refreshed too recently; not contacting the cinemas',
    );
  });

  test('runs when every source was last attempted on an earlier day', async () => {
    const { run, refresh } = setup([source('apollo', 30), source('forum', 20)]);

    expect(await refresh()).toBe(result);
    expect(run).toHaveBeenCalledOnce();
  });

  test('a failed attempt counts, so a refusing cinema is not asked again sooner', async () => {
    const failed = { ...source('forum', 1), lastError: 'Blocked by forum: HTTP 403' };
    const { run, refresh } = setup([failed]);

    expect(await refresh()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('isDue', () => {
  const at = (iso: string) => new Date(iso);
  const IF_DUE = ['--if-due'];

  test('the job runs on the first check of a new Vilnius day, not by hours passed', () => {
    // 21:50 UTC is 23:50 in Vilnius in November, and 22:55 UTC is 00:55 the next day.
    expect(isDue(at('2026-11-02T21:50:00Z'), at('2026-11-02T22:55:00Z'), IF_DUE)).toBe(true);
    // A morning run does not block the next morning, 23 hours later.
    expect(isDue(at('2026-11-02T09:00:00Z'), at('2026-11-03T08:00:00Z'), IF_DUE)).toBe(true);
  });

  test('the job does not run twice in a Vilnius day', () => {
    expect(isDue(at('2026-11-02T22:05:00Z'), at('2026-11-03T21:55:00Z'), IF_DUE)).toBe(false);
  });

  test('never within an hour, even across midnight', () => {
    expect(isDue(at('2026-11-02T21:50:00Z'), at('2026-11-02T22:10:00Z'), IF_DUE)).toBe(false);
    expect(isDue(at('2026-11-02T12:00:00Z'), at('2026-11-02T12:59:00Z'), [])).toBe(false);
  });

  test('by hand, any time after an hour', () => {
    expect(isDue(at('2026-11-02T12:00:00Z'), at('2026-11-02T13:00:00Z'), [])).toBe(true);
  });

  test('always when nothing was ever attempted', () => {
    expect(isDue(null, NOW, IF_DUE)).toBe(true);
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
