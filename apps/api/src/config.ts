import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { STALE_AFTER_MS } from './refresh/status.ts';

const DEFAULT_DB_PATH = fileURLToPath(new URL('../data/seansai.sqlite', import.meta.url));
/**
 * A once-a-day refresh from a machine at home can run at any time of day, so two runs can be well
 * over 24 h apart. 48 h allows for that and one missed day, and flags anything longer.
 */
const DAILY_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const LAST_SUCCESS_HOURS_PATTERN = /^FIXTURE_([A-Z0-9]+)_LAST_SUCCESS_HOURS$/;

const sourceIdList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id.length > 0),
  );

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    HOST: z.string().min(1).default('localhost'),
    DB_PATH: z.string().min(1).optional(),
    /** Turso (libSQL) database; on Vercel the only place data outlives a function instance. */
    TURSO_DATABASE_URL: z.string().min(1).optional(),
    TURSO_AUTH_TOKEN: z.string().min(1).optional(),
    /** A bearer token protecting the fallback refresh route (FR-008). */
    CRON_SECRET: z
      .string()
      .regex(/^[0-9a-f]{32,}$/i, 'must be at least 32 hex characters')
      .optional(),
    SOURCES_MODE: z.enum(['live', 'fixtures']).default('live'),
    FIXTURE_NOW: z.iso.datetime({ offset: true }).optional(),
    FIXTURE_FAIL: sourceIdList,
    /** An email address or the project's https URL, sent in the User-Agent. */
    SEANSAI_CONTACT: z.union([z.email(), z.url({ protocol: /^https$/ })]).optional(),
    DISABLED_SOURCES: sourceIdList,
    NODE_ENV: z.string().optional(),
    /** Starts a snapshot build after a refresh. Anyone holding it can deploy, so it's secret. */
    VERCEL_DEPLOY_HOOK_URL: z.url({ protocol: /^https$/ }).optional(),
    /** Set by Vercel, where the web app is its own service (vercel.json). */
    VERCEL: z.string().optional(),
  })
  .refine((env) => env.SOURCES_MODE === 'fixtures' || env.SEANSAI_CONTACT !== undefined, {
    path: ['SEANSAI_CONTACT'],
    message: 'is required in live mode (it is sent in the User-Agent so cinemas can reach us)',
  });

export type Config = {
  port: number;
  host: string;
  /** libSQL URL: Turso, a `file:` path, or `:memory:` (fixture mode, so runs are repeatable). */
  db: { url: string; authToken: string | null };
  sourcesMode: 'live' | 'fixtures';
  /**
   * `cron` on Vercel in live mode: functions do not run between requests, so the data is refreshed
   * from outside, once a day. `scheduler` everywhere else: the server refreshes hourly itself.
   */
  refreshMode: 'scheduler' | 'cron';
  /** Age after which a source's data is flagged as possibly outdated (FR-014, FR-015). */
  staleAfterMs: number;
  /** Bearer secret of the daily refresh route; null leaves the route unregistered. */
  cronSecret: string | null;
  /** Fixed clock for fixture mode; null means the capture instant or the real clock. */
  fixtureNow: Date | null;
  /** Sources whose fixture client fails every request (resilience testing). */
  fixtureFail: string[];
  /** Per source id: pretend the last successful refresh was this many hours ago. */
  fixtureLastSuccessHours: Record<string, number>;
  contact: string | null;
  /** Kill switch (research.md §1b): these sources are never refreshed. */
  disabledSources: string[];
  /** Production serves the built web app; in development Vite serves it, on Vercel its service. */
  serveWebApp: boolean;
  /** Asked for a new page snapshot after a refresh; null when snapshots aren't in use. */
  deployHookUrl: string | null;
};

function parseLastSuccessHours(env: NodeJS.ProcessEnv): Record<string, number> {
  const hoursBySource: Record<string, number> = {};
  for (const [name, value] of Object.entries(env)) {
    const match = LAST_SUCCESS_HOURS_PATTERN.exec(name);
    if (!match?.[1]) continue;
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours < 0) {
      throw new Error(`Invalid configuration: ${name} must be a non-negative number`);
    }
    hoursBySource[match[1].toLowerCase()] = hours;
  }
  return hoursBySource;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const values = parsed.data;
  const onVercel = values.VERCEL !== undefined;
  const refreshMode = onVercel && values.SOURCES_MODE === 'live' ? 'cron' : 'scheduler';
  return {
    port: values.PORT,
    host: values.HOST,
    db: chooseDb(values, onVercel),
    sourcesMode: values.SOURCES_MODE,
    refreshMode,
    staleAfterMs: refreshMode === 'cron' ? DAILY_STALE_AFTER_MS : STALE_AFTER_MS,
    cronSecret: values.CRON_SECRET ?? null,
    fixtureNow: values.FIXTURE_NOW ? new Date(values.FIXTURE_NOW) : null,
    fixtureFail: values.FIXTURE_FAIL,
    fixtureLastSuccessHours: parseLastSuccessHours(env),
    contact: values.SEANSAI_CONTACT ?? null,
    disabledSources: values.DISABLED_SOURCES,
    serveWebApp: values.NODE_ENV === 'production' && !onVercel,
    deployHookUrl: values.VERCEL_DEPLOY_HOOK_URL ?? null,
  };
}

function chooseDb(values: z.infer<typeof EnvSchema>, onVercel: boolean): Config['db'] {
  // Fixture data must never reach a real database, even if `vercel dev` supplies TURSO_*.
  if (values.SOURCES_MODE === 'live' && values.TURSO_DATABASE_URL !== undefined) {
    return { url: values.TURSO_DATABASE_URL, authToken: values.TURSO_AUTH_TOKEN ?? null };
  }
  if (values.DB_PATH !== undefined) return { url: `file:${values.DB_PATH}`, authToken: null };
  if (values.SOURCES_MODE === 'fixtures') return { url: ':memory:', authToken: null };
  if (onVercel) {
    // A file would vanish with the function instance, so every visitor could see different data.
    throw new Error('Invalid configuration: TURSO_DATABASE_URL is required on Vercel');
  }
  return { url: `file:${DEFAULT_DB_PATH}`, authToken: null };
}
