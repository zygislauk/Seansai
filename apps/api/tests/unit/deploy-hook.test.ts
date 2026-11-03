import { afterEach, describe, expect, test, vi } from 'vitest';
import { requestSnapshotBuild } from '../../src/refresh/deploy-hook.ts';
import { createTestLogger } from '../helpers/test-logger.ts';

const SECRET_URL = 'https://api.vercel.com/v1/integrations/deploy/prj_secret/hook_secret';

function run(
  sources: Record<string, 'success' | 'failed' | 'disabled'>,
  url: string | null = SECRET_URL,
) {
  const log = createTestLogger();
  return {
    log,
    done: requestSnapshotBuild(sources, {
      url,
      logger: log.logger,
      retryDelayMs: 0,
      timeoutMs: 20,
    }),
  };
}

const answering = (...statuses: number[]) => {
  const fetch = vi.fn(() =>
    Promise.resolve(new Response(null, { status: statuses.shift() ?? 200 })),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestSnapshotBuild', () => {
  test('sends one POST when at least one source succeeded', async () => {
    const fetch = answering(200);

    const { done, log } = run({ apollo: 'failed', forum: 'success' });
    await done;

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      SECRET_URL,
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) as AbortSignal }),
    );
    expect(log.raw()).toContain('Snapshot build requested');
  });

  test.each([
    ['every source failed', { apollo: 'failed', forum: 'failed' }, SECRET_URL],
    ['no source ran', { apollo: 'disabled' }, SECRET_URL],
    ['the setting is unset', { apollo: 'success' }, null],
  ] as const)('sends nothing when %s', async (_, sources, url) => {
    const fetch = answering(200);

    await run(sources, url).done;

    expect(fetch).not.toHaveBeenCalled();
  });

  test('retries once after a failed answer', async () => {
    const fetch = answering(500, 200);

    const { done, log } = run({ apollo: 'success' });
    await done;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(log.raw()).toContain('Snapshot build requested');
  });

  test('retries once after a network error', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetch);

    await run({ apollo: 'success' }).done;

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('gives up on a request that doesn’t answer in time, then retries', async () => {
    const fetch = vi.fn(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error);
          });
        }),
    );
    vi.stubGlobal('fetch', fetch);

    const { done, log } = run({ apollo: 'success' });
    await done;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(log.raw()).toContain('TimeoutError');
  });

  test('logs a second failure as an error without failing, or naming the address', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError(`fetch failed for ${SECRET_URL}`)));
    vi.stubGlobal('fetch', fetch);

    const { done, log } = run({ apollo: 'success' });

    await expect(done).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    const errors = log.lines().filter((line) => line.level >= 50);
    expect(errors.map((line) => line.msg)).toEqual(['Snapshot build request failed']);
    expect(log.raw()).not.toContain('hook_secret');
  });
});
