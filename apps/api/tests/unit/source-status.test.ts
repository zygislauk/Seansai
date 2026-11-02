import { describe, expect, test } from 'vitest';
import { deriveSourceStatus } from '../../src/refresh/status.ts';

const NOW = new Date('2026-10-30T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

describe('deriveSourceStatus', () => {
  test('a new source starts as stale', () => {
    expect(deriveSourceStatus(undefined, NOW)).toBe('stale');
    expect(
      deriveSourceStatus(
        { lastAttemptAt: hoursAgo(0), lastSuccessAt: null, lastError: 'timeout' },
        NOW,
      ),
    ).toBe('stale');
  });

  test('healthy after a successful refresh', () => {
    expect(
      deriveSourceStatus(
        { lastAttemptAt: hoursAgo(1), lastSuccessAt: hoursAgo(1), lastError: null },
        NOW,
      ),
    ).toBe('healthy');
  });

  test('degraded after a failure while the data is less than 3 hours old', () => {
    expect(
      deriveSourceStatus(
        { lastAttemptAt: hoursAgo(0), lastSuccessAt: hoursAgo(2.9), lastError: 'HTTP 500' },
        NOW,
      ),
    ).toBe('degraded');
  });

  test('stale when there has been no success for 3 hours or more', () => {
    expect(
      deriveSourceStatus(
        { lastAttemptAt: hoursAgo(0), lastSuccessAt: hoursAgo(3), lastError: 'HTTP 500' },
        NOW,
      ),
    ).toBe('stale');
    // Even without a recorded failure (e.g. the scheduler stopped), old data is stale.
    expect(
      deriveSourceStatus(
        { lastAttemptAt: hoursAgo(4), lastSuccessAt: hoursAgo(4), lastError: null },
        NOW,
      ),
    ).toBe('stale');
  });

  test('on Vercel, a daily refresh is stale only after 48 hours', () => {
    const staleAfterMs = 48 * 60 * 60 * 1000;
    const success = (hours: number) => ({
      lastAttemptAt: hoursAgo(hours),
      lastSuccessAt: hoursAgo(hours),
      lastError: null,
    });

    expect(deriveSourceStatus(success(47), NOW, staleAfterMs)).toBe('healthy');
    expect(deriveSourceStatus(success(48), NOW, staleAfterMs)).toBe('stale');
    expect(deriveSourceStatus(success(3), NOW)).toBe('stale');
  });
});
