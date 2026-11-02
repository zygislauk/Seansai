# Data Model: Free Public Hosting on Vercel

**Feature**: [spec.md](./spec.md) | **Date**: 2026-10-31

The tables are `sources`, `movies`, `screenings`, `match_reviews` and `movie_keys`, as in
[feature 001's data model](../001-cinema-showtimes/data-model.md) and
`apps/api/src/db/schema.sql` plus `migration-002-movie-keys.sql`. This feature changes where the
data lives and how it's written, and adds a few runtime-only values. Three schema additions came out
of the first deploy and the review:

- `schema_migrations` records applied migrations, because Turso rejects writing
  `PRAGMA user_version` ([research.md §2](./research.md#2-shared-data-store)).
- `screenings.duration_minutes` (migration 3) keeps the running time each cinema lists. Cinemas
  disagree, and a movie's `duration_minutes` used to be whichever listing was stored first. It is
  now the most common value across the movie's screenings, the shorter one on a tie, so it no longer
  depends on refresh order. Screenings without a time don't count; a movie with none keeps its value.
- `movies.match_duration_minutes` (migration 4) keeps the first running time known. Matching compares
  with it instead of the shown value, because that one moves and a listing that fell out of range
  would split off. It is fixed so that a film cannot widen what it absorbs: a wrong merge is worse
  than a duplicate (FR-005).

## Where the data lives

| Environment                     | Database URL                                   | Refresh                         | Stale after |
| ------------------------------- | ---------------------------------------------- | ------------------------------- | ----------- |
| Vercel production               | `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (database `seansai`) | once a day from a machine at home | 48 h |
| Vercel previews                 | `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (database `seansai-preview`) | none; filled from a laptop when needed | 27 h |
| Vercel in fixture mode          | `:memory:` (`vercel dev` with saved test data) | one startup refresh, from files | 3 h         |
| Docker                          | `file:/data/seansai.sqlite` (`DB_PATH`)        | in-process scheduler, hourly    | 3 h         |
| Local `npm run dev`, live       | `file:apps/api/data/seansai.sqlite`            | in-process scheduler, hourly    | 3 h         |
| Tests, fixture mode             | `:memory:` or a temporary `file:`              | none, or one startup refresh    | 3 h         |

## Write rules (FR-010)

- **One source refresh = one batch.**
  - Everything a successful refresh of one source writes goes in one `batch(…, 'write')`, which
    is one transaction:
    - movie upserts and their match keys;
    - deleting the source's screenings from now on, then the screening upserts;
    - `last_screening_at` raises and every movie's most common running time;
    - new match reviews;
    - the source's success record.
  - A failed batch leaves the source's previous data untouched.
  - A failed refresh writes only the source's attempt record (`last_attempt_at`, `last_error`).
- **One source at a time from reading the movies to storing them.** Fetching is parallel, but
  matching against the known movies and writing the result must not interleave, or two sources
  would each create the same new film.
- **Statement order inside the batch is fixed.** Movie upserts come in listing order, so the
  existing rule "the first source's title wins, later ones fill gaps" behaves as before.
- **No reliance on foreign-key cascades.** Removing stale movies deletes their `movie_keys` and
  `match_reviews` rows explicitly, in the same batch as the movies.
- **Running twice gives the same result.** Two overlapping refreshes of the same source each
  replace the source's future screenings as a whole. Screening ids are
  `{sourceId}:{sourceScreeningId}`, so the result has no duplicates (spec edge case).

## Runtime-only values (not stored)

### Refresh run (spec Key Entity)

Returned by the daily refresh and the cron route, and logged; never stored. The lasting record of
each source's outcome is its `sources` row.

| Field     | Type                                                   | Rule                                                   |
| --------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `sources` | map of source id → `'success' \| 'failed' \| 'disabled'` | one entry per configured adapter; a thrown error counts as `failed` |
| `cleanup` | `{ screenings: number; movies: number }`               | rows removed by the cleanup after all refreshes settle |

### Deployment configuration

New and changed fields on the API's `Config`:

| Field         | Type                                         | Derived from                                                                                         |
| ------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `db`          | `{ url: string; authToken: string \| null }` | `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` (live mode only, so fixture data never reaches a real database), else `file:${DB_PATH}`, else `:memory:` in fixture mode, else the default file. **Error** on Vercel in live mode without `TURSO_DATABASE_URL`. Replaces `dbPath`. |
| `refreshMode` | `'scheduler' \| 'cron'`                      | `'cron'` when `VERCEL` is set and `SOURCES_MODE=live`, otherwise `'scheduler'`                       |
| `staleAfterMs`| `number`                                     | 48 h in `cron` mode, 3 h otherwise                                                                   |
| `cronSecret`  | `string \| null`                             | `CRON_SECRET`; when null, the cron route isn't registered                                            |
| `serveWebApp` | `boolean` (existing)                         | `NODE_ENV=production` and not on Vercel                                                              |

### Refresh secret (spec Key Entity)

`CRON_SECRET` is a random value of at least 32 hex characters, set in the Vercel project's
environment variables for Production only. Vercel Cron sends it as `Authorization: Bearer
<secret>`. It's never committed or logged.
