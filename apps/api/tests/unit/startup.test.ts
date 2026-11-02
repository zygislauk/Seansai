import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SchedulerOptions } from '../../src/refresh/scheduler.ts';
import { startBackgroundRefresh } from '../../src/refresh/startup.ts';
import type { SourceAdapter } from '../../src/sources/types.ts';
import { createTestLogger } from '../helpers/test-logger.ts';

const HOUR = 60 * 60 * 1000;
const adapter = (id: SourceAdapter['id']): SourceAdapter => ({
  id,
  fetchScreenings: () => Promise.resolve({ screenings: [], skipped: [] }),
});
const adapters = [adapter('apollo'), adapter('forum')];

let log: ReturnType<typeof createTestLogger>;

function options(): SchedulerOptions {
  return {
    mode: 'live',
    clock: () => new Date(),
    logger: log.logger,
    refresh: vi.fn(() => Promise.resolve()),
    cleanup: vi.fn(() => Promise.resolve()),
    random: () => 0.5,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-30T10:00:00Z') });
  log = createTestLogger();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startBackgroundRefresh', () => {
  test('in cron mode never contacts cinemas or cleans up from the server itself', async () => {
    const opts = options();

    const scheduler = startBackgroundRefresh('cron', adapters, opts);
    await vi.advanceTimersByTimeAsync(2 * HOUR);

    expect(scheduler).toBeNull();
    expect(opts.refresh).not.toHaveBeenCalled();
    expect(opts.cleanup).not.toHaveBeenCalled();
    expect(
      log.lines().filter((line) => line.msg === 'Refresh runs from outside; scheduler not started'),
    ).toHaveLength(1);
  });

  test('in scheduler mode refreshes every source at startup', async () => {
    const opts = options();

    const scheduler = startBackgroundRefresh('scheduler', adapters, opts);
    await scheduler?.startupRun;

    expect(scheduler).not.toBeNull();
    expect(opts.refresh).toHaveBeenCalledTimes(2);
    scheduler?.stop();
  });
});
