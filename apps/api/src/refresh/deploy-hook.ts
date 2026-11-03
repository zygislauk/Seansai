import type { Logger } from '../lib/logger.ts';
import type { DailyRefreshResult } from './daily.ts';

const TIMEOUT_MS = 10_000;
/** Long enough for a brief network problem just after the Mac wakes (research.md §4). */
const RETRY_DELAY_MS = 30_000;

type SnapshotBuildOptions = {
  /** The Deploy Hook. Holding it lets anyone start deployments, so it's never logged. */
  url: string | null;
  logger: Logger;
  timeoutMs?: number;
  retryDelayMs?: number;
};

/** What went wrong, without an error's message, which could quote the address. */
async function attempt(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? null : `HTTP ${String(response.status)}`;
  } catch (error) {
    return error instanceof Error ? error.name : 'Unknown error';
  }
}

/**
 * Asks Vercel to rebuild the daily snapshot after a refresh that stored something. Failing changes
 * nothing about the refresh: the data is saved and the app shows it, and pages stay at the earlier
 * snapshot until the next refresh tries again (FR-003).
 */
export async function requestSnapshotBuild(
  sources: DailyRefreshResult['sources'],
  { url, logger, timeoutMs = TIMEOUT_MS, retryDelayMs = RETRY_DELAY_MS }: SnapshotBuildOptions,
): Promise<void> {
  if (url === null || !Object.values(sources).includes('success')) return;

  const firstProblem = await attempt(url, timeoutMs);
  if (firstProblem === null) {
    logger.info('Snapshot build requested');
    return;
  }
  logger.warn({ reason: firstProblem }, 'Snapshot build request failed, retrying');
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));

  const secondProblem = await attempt(url, timeoutMs);
  if (secondProblem === null) {
    logger.info('Snapshot build requested');
  } else {
    logger.error({ reason: secondProblem }, 'Snapshot build request failed');
  }
}
