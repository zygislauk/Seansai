import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient, type Client } from '@libsql/client';

/**
 * A libSQL client: Turso on Vercel (`libsql://…`), a SQLite file in Docker and development
 * (`file:…`), or `:memory:` in tests and fixture mode.
 *
 * `PRAGMA foreign_keys` is not set: Turso does not keep it across remote requests, so the
 * repository deletes dependent rows itself instead of relying on cascades.
 */
export type Db = Client;

/**
 * Migrations in order; the `schema_migrations` table records which have run. Append new
 * migrations, never edit one that has shipped.
 */
const migrations: readonly string[] = [
  readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('./migration-002-movie-keys.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('./migration-003-screening-duration.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('./migration-004-movie-match-duration.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('./migration-005-screenings-by-cinema.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('./migration-006-remove-small-cities.sql', import.meta.url), 'utf8'),
];

/** How long a local write waits for another connection's lock before failing. */
const BUSY_TIMEOUT_MS = 5000;

/** Opens (creating if needed) the database at `url` and brings its schema up to date. */
export async function openDb(url: string, authToken: string | null = null): Promise<Db> {
  const isFile = url.startsWith('file:');
  if (isFile) mkdirSync(dirname(url.slice('file:'.length)), { recursive: true });
  // `timeout` is the busy timeout of every pooled connection; a PRAGMA would reach only one.
  const db = createClient({
    url,
    ...(authToken === null ? {} : { authToken }),
    timeout: BUSY_TIMEOUT_MS,
  });
  try {
    if (isFile) await db.execute('PRAGMA journal_mode = WAL');
    await migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

/**
 * Applies each pending migration together with its `schema_migrations` row in one batch, so it
 * runs completely or not at all. Turso rejects writing `PRAGMA user_version`, so the version is
 * kept in a table; databases migrated before the table existed still report theirs through
 * `user_version`, which can be read everywhere.
 */
async function migrate(db: Db): Promise<void> {
  await db.execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT',
  );
  const applied = await schemaVersion(db);
  for (const [index, sql] of migrations.slice(applied).entries()) {
    const version = applied + index + 1;
    try {
      await db.batch(
        [
          ...splitStatements(sql),
          {
            sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
            args: [version, new Date().toISOString()],
          },
        ],
        'write',
      );
    } catch (error) {
      // Two new Vercel function instances can start against the same database at once; if the
      // other one applied this migration first, ours fails on the existing tables.
      if ((await schemaVersion(db)) >= version) continue;
      throw error;
    }
  }
}

async function schemaVersion(db: Db): Promise<number> {
  const [recorded, legacy] = await db.batch(
    ['SELECT MAX(version) AS version FROM schema_migrations', 'PRAGMA user_version'],
    'read',
  );
  return Math.max(
    Number(recorded?.rows[0]?.version ?? 0),
    Number(legacy?.rows[0]?.user_version ?? 0),
  );
}

/**
 * Splits a migration into statements: whole-line `--` comments and empty statements dropped. It
 * splits on every `;`, so migrations must not have one inside a string or an inline comment.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}
