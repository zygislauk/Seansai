import type { SourceStatus } from '@seansai/shared';
import type { SourceRecord } from '../db/repository.ts';

/** Data older than this is flagged to users as possibly missing or outdated (FR-014, FR-015). */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * - `healthy`: the last attempt succeeded.
 * - `degraded`: the last attempt failed, but the data is still younger than the stale threshold.
 * - `stale`: no successful refresh within the stale threshold (3 h self-hosted, 48 h on Vercel,
 *   which refreshes once a day); a new source starts here.
 */
export function deriveSourceStatus(
  source: Pick<SourceRecord, 'lastAttemptAt' | 'lastSuccessAt' | 'lastError'> | undefined,
  now: Date,
  staleAfterMs: number = STALE_AFTER_MS,
): SourceStatus {
  if (!source?.lastSuccessAt) return 'stale';
  if (now.getTime() - source.lastSuccessAt.getTime() >= staleAfterMs) return 'stale';
  return source.lastError === null ? 'healthy' : 'degraded';
}
