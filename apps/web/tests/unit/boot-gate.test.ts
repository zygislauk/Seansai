import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import bootGate from '../../public/boot-gate.js?raw';

const TODAY = '2026-11-02';

/**
 * Runs the gate with the snapshot's date already in the head. Evaluated here rather than through a
 * script element, which jsdom runs in a realm of its own that the test's fake clock doesn't reach.
 */
function runGate(snapshotDate: string | null): string | undefined {
  if (snapshotDate !== null) {
    const meta = document.createElement('meta');
    meta.name = 'snapshot-date';
    meta.content = snapshotDate;
    document.head.append(meta);
  }
  globalThis.eval(bootGate);
  return document.documentElement.dataset.boot;
}

beforeEach(() => {
  // 23:30 on 1 November in UTC is already 2 November in Vilnius.
  vi.useFakeTimers({ now: new Date('2026-11-01T23:30:00Z'), toFake: ['Date'] });
  window.history.pushState({}, '', '/lt/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.head.replaceChildren();
  document.documentElement.removeAttribute('data-boot');
});

test('a first-time visitor on today’s snapshot keeps the snapshot', () => {
  expect(runGate(TODAY)).toBeUndefined();
});

test('a remembered city renders on the client', () => {
  window.localStorage.setItem('seansai.city', 'vilnius');

  expect(runGate(TODAY)).toBe('client');
});

test.each(['?date=2026-11-03', '?city=vilnius', '?format=3D', '?fbclid=abc'])(
  'an address with %s renders on the client',
  (search) => {
    window.history.pushState({}, '', `/lt/${search}`);

    expect(runGate(TODAY)).toBe('client');
  },
);

test('a snapshot from an earlier day renders on the client', () => {
  expect(runGate('2026-11-01')).toBe('client');
});

test('a page without a snapshot date renders on the client', () => {
  expect(runGate(null)).toBe('client');
});

test('unavailable storage counts as nothing remembered', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });

  expect(runGate(TODAY)).toBeUndefined();
});
