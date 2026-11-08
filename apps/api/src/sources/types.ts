import { ScreeningFormatSchema } from '@seansai/shared';
import { z } from 'zod';
import type { HttpClient } from '../lib/polite-http.ts';
import type { CinemaRegistry } from '../registry/cinemas.ts';

/** One per adapter configuration (data-model.md → Source). */
export type SourceId =
  | 'apollo'
  | 'forum'
  | 'pasaka'
  | 'skalvija'
  | 'atlantis'
  | 'garsas'
  | 'romuva'
  | 'vue'
  | 'cinamon'
  | 'arlekinas';

const httpUrl = z.url({ protocol: /^https?$/ });
const languageCode = z.string().regex(/^[a-z]{2}$/, 'must be an ISO 639-1 code');

/**
 * What every adapter must produce for one screening. The refresh job validates each item against
 * this schema before anything is stored (contracts/source-adapter.md, rule 1).
 */
export const SourceScreeningSchema = z.object({
  sourceScreeningId: z.string().min(1),
  /** Resolved through the registry. */
  cinemaId: z.string().min(1),
  /** Exact instant (UTC). */
  startsAt: z.date(),
  /** As published. */
  title: z.string().trim().min(1),
  originalTitle: z.string().trim().min(1).nullable(),
  /** Only when the source states it (Apollo's international titles, Cinamon's translations). */
  englishTitle: z.string().trim().min(1).nullable(),
  year: z.number().int().min(1888).max(2100).nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  ageRating: z.string().min(1).nullable(),
  genres: z.array(z.string().min(1)),
  posterUrl: httpUrl.nullable(),
  hall: z.string().min(1).nullable(),
  format: ScreeningFormatSchema.nullable(),
  spokenLanguage: languageCode.nullable(),
  subtitleLanguage: languageCode.nullable(),
  isDubbed: z.boolean().nullable(),
  ticketUrl: httpUrl,
});
export type SourceScreening = z.infer<typeof SourceScreeningSchema>;

export type AdapterContext = {
  /** Injected for deterministic tests. */
  now: Date;
  /** User-Agent, delay between requests, timeout, robots check. */
  http: HttpClient;
  /** Maps source venue keys → Cinema ids. */
  registry: CinemaRegistry;
};

export type AdapterResult = {
  screenings: SourceScreening[];
  /** Logged, not shown to users. */
  skipped: Array<{ reason: string; raw: string }>;
};

/** A known gap in what a source publishes, e.g. a source that shows only today's sessions. */
export type SourceLimitation = 'today-only';

export interface SourceAdapter {
  /** Matches Source.id in the data model, e.g. "forum". */
  readonly id: SourceId;
  /** Reported by `sources:check` instead of counted as a failure. */
  readonly limitations?: readonly SourceLimitation[];

  /**
   * Fetch and normalise the published screenings from today through the last listed date
   * (horizon.ts); the refresh job drops anything later. Must not write to storage and must not throw for a single bad item:
   * bad items are skipped and counted in `skipped`.
   */
  fetchScreenings(context: AdapterContext): Promise<AdapterResult>;
}
