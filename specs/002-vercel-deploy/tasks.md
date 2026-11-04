---
description: 'Task list for Free Public Hosting on Vercel'
---

# Tasks: Free Public Hosting on Vercel

**Input**: Design documents from `/specs/002-vercel-deploy/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Required. Constitution Principle IV says every feature ships with automated tests for its
acceptance criteria. Test tasks come first in each phase and must fail before the implementation
tasks.

**Organization**:

- Phases 1–2: the shared async data layer.
- Phases 3–5: one phase per user story, in priority order.
- Each story phase ends with a commit.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

npm workspaces monorepo:

- API source in `apps/api/src/`, API tests in `apps/api/tests/`;
- deployment files (`vercel.json`, `Dockerfile`, `README.md`) at the repository root.

Run API commands from the repository root with `-w @seansai/api`, or inside `apps/api`.

---

## Phase 1: Setup

**Purpose**: Swap the database client. The build stays red until Phase 2 is complete.

- [X] T001 Replace the database dependency in `apps/api/package.json` and `package-lock.json`:
  - run `npm uninstall -w @seansai/api better-sqlite3 @types/better-sqlite3`;
  - run `npm install -w @seansai/api @libsql/client`;
  - confirm `better-sqlite3` no longer appears in `apps/api/package.json`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Make all data access async on `@libsql/client` with the same SQL and schema, writing
each source refresh as one batch ([research.md §2](./research.md#2-shared-data-store),
[data-model.md "Write rules"](./data-model.md#write-rules-fr-010)). Every story depends on this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for the data layer ⚠️ (write first, confirm they fail)

- [X] T002 [P] Make the test helpers async.
  - `apps/api/tests/helpers/temp-db.ts`: `createTempDb(): Promise<{ db: Db; path: string; cleanup: () => void }>`, opening `openDb(\`file:${path}\`)`. `cleanup`calls`db.close()` and then removes the temporary directory.
  - `apps/api/tests/helpers/catalog.ts` and `apps/api/tests/helpers/large-catalog.ts`: seed through `await repo.upsertMovie(...)`, `await repo.replaceSourceScreenings(...)` and `await repo.recordSourceSuccess(...)`, and become `async`.
- [X] T003 [P] Add data-layer tests to `apps/api/tests/integration/repository.test.ts` and convert the existing ones to `await`.
  - `splitStatements` ignores comments and empty statements: `'-- a; b\nCREATE TABLE a (x);\n\n-- c\nCREATE INDEX i ON a (x);\n'` → `['CREATE TABLE a (x)', 'CREATE INDEX i ON a (x)']`.
  - Reopening a database file doesn't run migrations again: close it, reopen it with `openDb('file:' + path)`, and `PRAGMA user_version` is `2` with no error thrown.
  - Two servers starting at once migrate safely (U1): on a fresh temporary file, `await Promise.all([openDb(url), openDb(url)])` resolves both. `PRAGMA user_version` is `2`, and `SELECT COUNT(*) FROM sqlite_master WHERE name = 'movies'` is `1`.
  - `storeRefresh` writes one source refresh and counts only new reviews:
    - two movies (`digger-2026` with keys `['kasejas']`, and `digger-2025`), one screening, one review;
    - the first call returns `{ newReviews: 1 }`, the second `{ newReviews: 0 }`;
    - `getSource('apollo')?.lastSuccessAt` equals `now`;
    - `digger-2026`'s keys sorted are `['digger', 'kasejas']`.
  - `storeRefresh` is all-or-nothing:
    - store one refresh, then call it again with a screening whose `format` is `'VHS'` (violates the schema's CHECK);
    - the second call rejects;
    - the source's screenings and `lastSuccessAt` are still those of the first call.
  - Two refreshes of the same source at once leave no duplicates (spec edge case): `await Promise.all([repo.storeRefresh(r), repo.storeRefresh(r)])` with the same three screenings. Afterwards the source has exactly 3 screenings, and both calls resolved.
  - `deleteStaleMovies` leaves no orphaned keys or reviews:
    - two movies with no screenings and `last_screening_at` NULL, one with keys, plus a review between them;
    - returns `2`;
    - `SELECT COUNT(*)` from `movie_keys` and from `match_reviews` are both `0`.

### Implementation for the data layer

- [X] T004 Rewrite `apps/api/src/db/index.ts`.
  - `export type Db = Client` (from `@libsql/client`).
  - `export async function openDb(url: string, authToken: string | null = null): Promise<Db>`:
    - for `file:` URLs, create the parent directory and run `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000`, so a second starting server waits for the first one's migration instead of failing;
    - read `PRAGMA user_version`;
    - apply each pending migration `n` with one `db.batch([...splitStatements(sql), 'PRAGMA user_version = ' + n], 'write')`;
    - if a migration batch rejects, re-read `PRAGMA user_version`. If it's now `>= n`, another server applied it, so continue. Otherwise rethrow the original error.
    - Comment _why_: two new Vercel function instances can start against the same database at once.
  - `export function splitStatements(sql: string): string[]`: drop `--` comment lines, split on `;`, trim, drop empty strings.
  - Comment _why_ `PRAGMA foreign_keys` isn't set: Turso remote requests don't keep it, so deletes are explicit.
- [X] T005 Rewrite `apps/api/src/db/repository.ts` as async on `Db`.
  - Every public method returns a Promise: `upsertMovie`, `getMovie`, `listMovieIdentities`, `replaceSourceScreenings`, `recordSourceAttempt`, `recordSourceSuccess`, `getSource`, `listSources`, `deletePastScreenings` → `Promise<number>`, `deleteStaleMovies` → `Promise<number>`, `insertMatchReview` → `Promise<boolean>`.
  - Keep the SQL text unchanged, as constants built into `InStatement`s by private helpers. Pass `null`, never `undefined`. Cast rows with `as unknown as RowType[]`.
  - Add `export type SourceRefresh = { sourceId: string; now: Date; movies: Array<{ movie: MovieRecord; keys: readonly string[] }>; screenings: ScreeningRecord[]; reviews: Array<Omit<MatchReviewRecord, 'firstSeenAt'>> }`.
  - Add `storeRefresh(refresh: SourceRefresh): Promise<{ newReviews: number }>`, issuing **one** `db.batch(…, 'write')` in this order:
    1. movie upserts with their keys, in the given order;
    2. delete the source's screenings with `starts_at >= now`;
    3. screening upserts;
    4. `last_screening_at` raises;
    5. review inserts (`firstSeenAt = now`);
    6. `recordSuccess`.
  - `newReviews` = review inserts with `rowsAffected > 0`.
  - `deleteStaleMovies`: one batch that deletes the stale movies' `movie_keys` and `match_reviews` rows, then the movies. It returns the movies delete's `rowsAffected`.
  - Remove `transaction()` and the `better-sqlite3` import. Comment _why_: Turso interactive transactions time out after 5 s and cost a round trip per statement.
- [X] T006 Make `apps/api/src/db/queries.ts` async on `Db`.
  - These return Promises: `listMovies`, `getMovie`, `screeningDates`, `availableDates`, `listScreenings`, `nextDateWithScreenings`, `freshness`.
  - These stay synchronous: `cinemasIn`, `listCities`, `isCity`.
  - Replace the prepared `Statement`s with SQL constants executed through `db.execute({ sql, args })`.
- [X] T007 Update `apps/api/src/refresh/refresh-source.ts`.
  - `storeScreenings` becomes synchronous and write-free. It takes the `MovieIdentity[]` from `await repo.listMovieIdentities()` and returns `{ movies, records, reviews }`.
  - `refreshSource` then calls `await repo.storeRefresh({ sourceId, now, movies, screenings: records, reviews })` and takes `newReviews` from its result.
  - The failure path awaits `repo.recordSourceAttempt(...)`.
- [X] T008 [P] Make the scheduler's cleanup async.
  - In `apps/api/src/refresh/scheduler.ts`, change `SchedulerOptions.cleanup` to `(now: Date) => Promise<void>`. `runCleanup` awaits it inside its existing try/catch and logs `'Daily cleanup failed'` on rejection.
  - Update `apps/api/tests/unit/scheduler.test.ts` so the cleanup mock resolves, and add a test that a rejected cleanup is logged and the next cleanup is still scheduled.
- [X] T009 [P] Make the route handlers in `apps/api/src/routes/health.ts`, `apps/api/src/routes/movies.ts` and `apps/api/src/routes/screenings.ts` `async` and await the repo and queries calls. `findMovie(queries, movieId)` becomes `async` and returns `Promise<MovieRecord>`.
- [X] T010 Update `apps/api/src/main.ts`:
  - `const db = await openDb(config.dbPath === ':memory:' ? ':memory:' : \`file:${config.dbPath}\`)`(US1 replaces this with`config.db`);
  - await `repo.recordSourceSuccess(...)` in the fixture loop;
  - the scheduler's `cleanup` becomes an `async` callback awaiting `deletePastScreenings` and `deleteStaleMovies`.
- [X] T011 Convert the remaining API tests to `await` the async helpers, repo and queries:
  - `apps/api/tests/integration/{health,cities,movies,screenings,refresh,matching-fixtures,performance,server}.test.ts`;
  - `apps/api/tests/load/peak.test.ts`.
    Assertions don't change.
- [X] T012 Verify, then commit.
  - `npm test -w @seansai/api` passes.
  - `npm run test:load` passes with p95 < 300 ms.
  - `npm run typecheck && npm run lint` pass.
  - `SOURCES_MODE=fixtures npm run dev -w @seansai/api` serves `curl -s 'localhost:3000/api/v1/movies?city=vilnius'` with a non-empty `movies` array.
  - Commit `refactor(api): use @libsql/client so the database can live in Turso`.

**Checkpoint**: Same behaviour as before, on an async client that can talk to Turso.

---

## Phase 3: User Story 1 — Use Seansai at a public web address (Priority: P1) 🎯 MVP

**Goal**: The site runs on Vercel with its data in Turso. Every visitor sees the same data, cold
starts never contact cinemas, and list responses are cached by the CDN.

**Independent Test**:

1. Provision Vercel Hobby and Turso Free.
2. Deploy a preview.
3. Fill Turso once from a laptop (T027).
4. Follow feature 001's journeys on the preview: city prompt, movie list, screenings, dates, filters, ticket link, deep-link reload. The results match a self-hosted copy (spec US1, SC-001).

### Tests for User Story 1 ⚠️ (write first, confirm they fail)

- [X] T013 [P] [US1] Add config tests to `apps/api/tests/unit/config.test.ts`.
  - **Turso on Vercel**: `{ SEANSAI_CONTACT, VERCEL: '1', NODE_ENV: 'production', TURSO_DATABASE_URL: 'libsql://seansai-x.turso.io', TURSO_AUTH_TOKEN: 't' }` gives:
    - `db` = `{ url: 'libsql://seansai-x.turso.io', authToken: 't' }`;
    - `refreshMode` = `'cron'`;
    - `serveWebApp` = `false`.
  - **Missing database URL**: `{ SEANSAI_CONTACT, VERCEL: '1' }` throws `/TURSO_DATABASE_URL is required on Vercel/`.
  - **Fixture mode on Vercel**: `{ SOURCES_MODE: 'fixtures', VERCEL: '1' }` gives `refreshMode` `'scheduler'` and `db.url` `':memory:'`.
  - **Update existing expectations**:
    - `dbPath` becomes `db` (`{ url: ':memory:', authToken: null }` in fixture defaults);
    - `DB_PATH: '/data/x.sqlite'` gives `db.url` `'file:/data/x.sqlite'`;
    - the live default ends with `apps/api/data/seansai.sqlite` and starts with `file:`;
    - defaults include `refreshMode: 'scheduler'`.
  - Delete the `/tmp` test added in commit `156fa6c`.
- [X] T014 [P] [US1] Change the expected list cache header to `'public, max-age=300, s-maxage=300'` in `apps/api/tests/integration/movies.test.ts:87`, `apps/api/tests/integration/cities.test.ts:39` and `apps/api/tests/integration/server.test.ts:101`. In `apps/api/tests/integration/screenings.test.ts`, add the same assertion for `GET /api/v1/movies/:id/screenings` ([contracts/hosting.md](./contracts/hosting.md#api-response-caching-change-to-feature-001s-public-api)).
- [X] T015 [US1] Add N+1 regression tests: `vi.spyOn(Repository.prototype, 'getSource')` is never called and `listSources` is called exactly once per request for:
  - `GET /api/v1/movies?city=all` in `apps/api/tests/integration/movies.test.ts`;
  - `GET /api/v1/health` in `apps/api/tests/integration/health.test.ts`.
- [X] T016 [P] [US1] Create `apps/api/tests/unit/vercel-config.test.ts`. It reads the repository's `vercel.json` (`new URL('../../../../vercel.json', import.meta.url)`) and asserts the routing and headers that FR-001, FR-002 and FR-012 depend on, so they're tested in CI and not only by hand:
  - **Top-level `rewrites`**: exactly two, in this order:
    1. `{ source: '/api/(.*)', destination: { service: 'api' } }`;
    2. `{ source: '/(.*)', destination: { service: 'web' } }` (the catch-all must be last).
  - **`services.api`**: `{ root: 'apps/api', framework: 'fastify', entrypoint: 'index.ts' }`, and the file `apps/api/index.ts` exists.
  - **`services.web.rewrites`** contains `{ source: '/(.*)', destination: '/index.html' }` (deep links, FR-002).
  - **`services.web.headers`**: the `/(.*)` rule has:
    - `Content-Security-Policy` equal to `SECURITY_HEADERS['content-security-policy']` imported from `apps/api/src/server.ts`;
    - `X-Content-Type-Options: nosniff`;
    - `Referrer-Policy: strict-origin-when-cross-origin`.

    This keeps the two copies of the CSP from drifting apart.

  - **`regions`** equals `['fra1']`.
  - **No bindings**: no service has `bindings`.
- [X] T017 [P] [US1] Create `apps/api/tests/unit/startup.test.ts` for `startBackgroundRefresh` (T019), using `vi.useFakeTimers()` and a stub adapter whose `refresh` is a `vi.fn()`. This pins FR-007, US1 scenario 4 and SC-006.
  - **`'cron'` mode**:
    - returns `null`;
    - after `vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)`, `refresh` and `cleanup` have **never** been called;
    - logs `'Refresh runs from Vercel Cron; scheduler not started'` once.
  - **`'scheduler'` mode, `live`**: returns a `Scheduler`, and `refresh` was called once per adapter at startup.

### Implementation for User Story 1

- [X] T018 [US1] Change `apps/api/src/config.ts`.
  - Replace `dbPath` with `db: { url: string; authToken: string | null }`. Add `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `VERCEL` to the env schema.
  - Choose `db.url` in this order:
    1. `TURSO_DATABASE_URL`, with `TURSO_AUTH_TOKEN`;
    2. `file:${DB_PATH}`;
    3. `':memory:'` in fixture mode;
    4. on Vercel in live mode, throw `Invalid configuration: TURSO_DATABASE_URL is required on Vercel`;
    5. otherwise `file:` + `DEFAULT_DB_PATH`.
  - Add `refreshMode: 'scheduler' | 'cron'`: `'cron'` when `VERCEL` is set and `SOURCES_MODE` is `live`.
  - Delete `VERCEL_DB_PATH`.
- [X] T019 [US1] Create `apps/api/src/refresh/startup.ts` (after T018, which adds `Config['refreshMode']`).
  - `export function startBackgroundRefresh(mode: Config['refreshMode'], adapters: readonly SourceAdapter[], options: SchedulerOptions): Scheduler | null`.
  - In `'cron'` mode it logs `'Refresh runs from Vercel Cron; scheduler not started'` through `options.logger` and returns `null` without touching `refresh` or `cleanup`.
  - Otherwise it returns `startScheduler(adapters, options)`.
  - Add a _why_ comment: on Vercel every cold start would otherwise fetch from all cinemas (FR-007).
- [X] T020 [US1] Change `apps/api/src/main.ts`.
  - Open the database with `await openDb(config.db.url, config.db.authToken)`.
  - Replace the direct `startScheduler(...)` call with `startBackgroundRefresh(config.refreshMode, enabledAdapters, {...})` from T019.
  - `shutdown` calls `scheduler?.stop()`.
- [X] T021 [P] [US1] In `apps/api/src/routes/http.ts`, make `setListCaching` set `cache-control: public, max-age=300, s-maxage=300`. Add a _why_ comment: the Vercel CDN caches only with `s-maxage` and strips it before the browser; self-hosted it has no effect.
- [X] T022 [US1] Remove the N+1 queries.
  - `Queries.freshness` in `apps/api/src/db/queries.ts`: read all sources with one `await this.#repo.listSources()` and look them up in a `Map` by id.
  - `apps/api/src/routes/health.ts`: same, one `listSources()` per request.
- [X] T023 [US1] Add `"regions": ["fra1"]` at the top level of `vercel.json` ([research.md §6](./research.md#6-region-and-latency-sc-004)). Export the existing `SECURITY_HEADERS` constant from `apps/api/src/server.ts`, which T016 compares with `vercel.json`. T016 must now pass.
- [X] T024 [US1] Check locally.
  - `npm test -w @seansai/api && npm run typecheck && npm run lint` pass.
  - Run quickstart §2's non-cron rows under `vercel dev --local --listen 3333` with a temporary `.env` containing `SOURCES_MODE=fixtures`:
    - the movies API returns JSON;
    - `/vilnius` returns 200;
    - the CSP header is present.
  - Delete `.env` afterwards.
  - If `vercel dev` rejects `regions`, remove it from `vercel.json` and record that the region is set in project settings instead.
- [X] T025 [US1] Provision on free plans (quickstart §4 steps 1–3, with the owner's go-ahead for each account action).
  - Run `vercel link` and create the project on the **Hobby** team, with the function region `fra1`.
  - Run `vercel integration add tursocloud` and choose the free `starter` plan, in the EU region nearest Frankfurt (`dub1`).
  - Create **two** databases on that free account:
    - `seansai`, connected to **Production** only;
    - `seansai-preview`, connected to **Preview** (and Development) only.

    Each environment gets its own `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, so a preview can never migrate or write production's data (U2). Turso Free allows up to 100 databases.
  - If the integration asks for a paid plan or a card, stop. Create both databases at turso.tech instead, then `vercel env add TURSO_DATABASE_URL <environment>` and `vercel env add TURSO_AUTH_TOKEN <environment>`, with production's values for `production` and the preview database's for `preview`.
  - `vercel env add SEANSAI_CONTACT` (Production and Preview) with `https://github.com/zygislauk/Seansai`.
- [X] T026 [US1] Deploy a preview by pushing `002-vercel-deploy`.
  - The build succeeds.
  - `GET <preview>/api/v1/health` returns `status: ok` with every source `stale`. This proves the migrations ran on the **preview** database (recorded in `schema_migrations`, because Turso rejects writing `PRAGMA user_version`; [research.md §2](./research.md#2-shared-data-store)). Production's database stays untouched until T047.
  - If Deployment Protection blocks `curl`, use `vercel curl`.
- [X] T027 [US1] Fill the **preview** database once from a laptop.
  - Run `TURSO_DATABASE_URL=<preview db url> TURSO_AUTH_TOKEN=<preview token> SEANSAI_CONTACT=https://github.com/zygislauk/Seansai npm run dev -w @seansai/api`. This uses scheduler mode, which runs one polite startup refresh.
  - Wait for `Source refreshed` for each source, then stop it.
  - Confirm `<preview>/api/v1/health` shows each source `healthy`.
- [X] T028 [US1] Validate on the preview from a phone. Idle figures and how each was taken: [research.md §5](./research.md#5-keeping-usage-free-sc-002-sc-005).
  - Feature 001's journeys all work (SC-001).
  - The movie list appears in < 2 s, and in < 3 s after an hour idle (SC-004).
  - The second `curl -sI '<preview>/api/v1/movies?city=vilnius'` shows `x-vercel-cache: HIT`.
  - Server p95 against remote Turso (Constitution VI):
    - run `for i in $(seq 1 50); do curl -s -o /dev/null -w '%{time_starttransfer}\n' "<preview>/api/v1/movies?city=all&nocache=$i"; done | sort -n | sed -n 48p`;
    - a unique query parameter skips the CDN, and the API ignores unknown parameters;
    - the 48th of 50 sorted (≈ p95), measured from Lithuania, is < 0.3 s plus the network round trip shown by `curl -w '%{time_connect}'`;
    - record the value in [research.md §5](./research.md#5-keeping-usage-free-sc-002-sc-005).
  - SC-006 spot-check: after the preview has been idle for an hour, request `/api/v1/health` once. Within the hour (Hobby keeps logs that long), Runtime Logs for that cold start show `Refresh runs from Vercel Cron; scheduler not started` and no `Source refreshed` or `Source refresh failed` lines.
  - Then commit `feat: run on Vercel with the shared Turso database (002 US1)` and push.

**Checkpoint**: The public site works on free plans with shared data. Refreshing still needs a
manual laptop run until US2.

---

## Phase 4: User Story 2 — Schedules stay current without anyone stepping in (Priority: P2)

**Goal**: A daily Vercel Cron Job refreshes every source and cleans up, isolating failures. Cinemas
are flagged after 27 h on Vercel and still after 3 h elsewhere.

**Independent Test**: After deploying to production, two consecutive mornings before 08:00 Vilnius
time show that day's screenings and none from the day before, with every source's `lastSuccessAt`
from that night, and no manual action (spec US2, SC-003, quickstart §5).

### Tests for User Story 2 ⚠️ (write first, confirm they fail)

- [X] T029 [P] [US2] In `apps/api/tests/unit/source-status.test.ts`, add: with `staleAfterMs = 27 * 60 * 60 * 1000`, a success 26 h before `now` is `'healthy'` and one exactly 27 h before is `'stale'`. With the default, 3 h still gives `'stale'`.
- [X] T030 [P] [US2] Add config tests to `apps/api/tests/unit/config.test.ts`.
  - The Vercel/Turso case from T013 with `CRON_SECRET: '0123456789abcdef0123456789abcdef'` gives `staleAfterMs` = `27 * 60 * 60 * 1000` and `cronSecret` equal to that value.
  - A weak secret is rejected, as data-model.md requires ("a random value of at least 32 hex characters"): `CRON_SECRET: 's'` and `CRON_SECRET: 'z'.repeat(40)` both throw `/CRON_SECRET/`.
  - The fixture defaults give `staleAfterMs` = `3 * 60 * 60 * 1000` and `cronSecret` = `null`.
- [X] T031 [P] [US2] Create `apps/api/tests/unit/daily.test.ts` with stub adapters: `a` resolves `{ status: 'success', … }`, `b` resolves `{ status: 'failed', error: 'x' }`, `c` throws.
  - `runDailyRefresh` resolves to `sources: { a: 'success', b: 'failed', c: 'failed' }`.
  - `cleanup` is called once, after all three refreshes settled (check call order).
  - The result's `cleanup` equals the stub's return `{ screenings: 4, movies: 1 }`.
  - The thrown error is logged with the source id.
- [X] T032 [P] [US2] Create `apps/api/tests/integration/cron.test.ts` building the server with `cron: { secret: 's3cret', run: vi.fn().mockResolvedValue(result) }`.
  - Without the `authorization` header: 404 with body `{ error: { code: 'not_found', message: 'There is no such API route.' } }`, and `run` not called.
  - With `Bearer wrong`: 404, and `run` not called.
  - With `Bearer s3cret`: 200, the body equals `result`, and `cache-control` is `no-store`.
  - With the server built without `cron`: `GET /api/v1/cron/daily` with the right header returns 404 ([contracts/cron-endpoint.md](./contracts/cron-endpoint.md)).
- [X] T033 [P] [US2] In `apps/api/tests/integration/movies.test.ts`, add: with `staleAfterMs: 27 h` passed to `buildServer`, Forum (last success 4 h before `NOW` in the catalog) is **not** in `freshness.staleCinemas`. With the default it is, as before.
- [X] T034 [P] [US2] In `apps/api/tests/unit/vercel-config.test.ts`, add:
  - `crons` equals exactly `[{ path: '/api/v1/cron/daily', schedule: '0 22 * * *' }]`;
  - every cron schedule's minute and hour fields are single numbers, so it runs at most once a day (the Hobby limit, FR-011);
  - the cron path starts with `/api/`, so the top-level rewrite routes it to the `api` service.

  If T043's fallback is used instead, assert that `vercel.json` has no `crons`, and that `.github/workflows/daily-refresh.yml` contains `cron: '0 22 * * *'` and the `/api/v1/cron/daily` URL.

### Implementation for User Story 2

- [X] T035 [US2] In `apps/api/src/refresh/status.ts`, add the parameter: `deriveSourceStatus(source, now, staleAfterMs: number = STALE_AFTER_MS)`. Update the doc comment's "3 hours" to "the stale threshold (3 h self-hosted, 27 h on Vercel)".
- [X] T036 [US2] Thread the threshold through.
  - `apps/api/src/config.ts`: add `staleAfterMs` (27 h when `refreshMode === 'cron'`, else `STALE_AFTER_MS`) and `cronSecret` (`CRON_SECRET` or null). Validate `CRON_SECRET` in the env schema with `z.string().regex(/^[0-9a-f]{32,}$/i, 'must be at least 32 hex characters').optional()`.
  - `ServerOptions.staleAfterMs?: number` in `apps/api/src/server.ts`, passed to `Queries` (new `staleAfterMs` option in `apps/api/src/db/queries.ts`) and to `healthRoutes` (new option in `apps/api/src/routes/health.ts`). Both call `deriveSourceStatus(…, staleAfterMs)`.
  - `apps/api/src/main.ts` passes `staleAfterMs: config.staleAfterMs`.
- [X] T037 [P] [US2] Create `apps/api/src/refresh/daily.ts`.
  - `export type DailyRefreshResult = { sources: Record<string, RefreshOutcome['status']>; cleanup: { screenings: number; movies: number } }`.
  - `export async function runDailyRefresh(deps: { adapters: readonly SourceAdapter[]; refresh: (adapter: SourceAdapter, now: Date) => Promise<RefreshOutcome>; cleanup: (now: Date) => Promise<{ screenings: number; movies: number }>; clock: () => Date; logger: Logger }): Promise<DailyRefreshResult>`.
  - Run all refreshes with `Promise.allSettled`; a rejection becomes `'failed'` and is logged with `{ source, err }`. Then call `cleanup(clock())` and log one summary line.
- [X] T038 [P] [US2] Create `apps/api/src/routes/cron.ts`.
  - `export const cronRoutes: FastifyPluginAsync<{ secret: string; run: () => Promise<DailyRefreshResult> }>`, registering `GET /cron/daily`.
  - Compare the SHA-256 digests of the `authorization` header and `Bearer ${secret}` with `crypto.timingSafeEqual`.
  - On a match: `cache-control: no-store`, return `await run()`.
  - Otherwise: `reply.status(404).send(errorBody('not_found', 'There is no such API route.'))`.
  - Never log the header.
- [X] T039 [US2] In `apps/api/src/server.ts`, add `ServerOptions.cron?: { secret: string; run: () => Promise<DailyRefreshResult> } | null`, registering `cronRoutes` inside the `/api/v1` prefix only when it is set.
- [X] T040 [US2] Wire `apps/api/src/main.ts`.
  - Build the per-adapter `refresh` closure and an async `cleanup(now)` (returning `{ screenings, movies }`) once. Use them for both `startScheduler` and `runDailyRefresh`.
  - Pass `cron: config.cronSecret ? { secret: config.cronSecret, run: () => runDailyRefresh({ adapters: enabledAdapters, refresh, cleanup, clock, logger }) } : null` to `buildServer`.
- [X] T041 [US2] Add `"crons": [{ "path": "/api/v1/cron/daily", "schedule": "0 22 * * *" }]` at the top level of `vercel.json` ([contracts/hosting.md](./contracts/hosting.md)).
- [X] T042 [US2] Check locally.
  - `npm test -w @seansai/api && npm run typecheck && npm run lint` pass.
  - Run quickstart §2's cron rows under `vercel dev --local --listen 3333` with a temporary `.env` (`SOURCES_MODE=fixtures`, `CRON_SECRET=0123456789abcdef0123456789abcdef`): no header → 404, `Bearer wrong` → 404, `Bearer 0123456789abcdef0123456789abcdef` → 200 with every source listed.
  - Delete `.env`.
- [X] T043 [US2] Run `vercel env add CRON_SECRET production` with the output of `openssl rand -hex 32` (Production only, never committed). Push, and confirm the preview build accepts `crons`.
  - **If a deploy rejects `crons` in services mode**: remove the `crons` key from `vercel.json`. Instead create `.github/workflows/daily-refresh.yml`, which does `on: schedule: - cron: '0 22 * * *'` plus `workflow_dispatch`, and runs `curl --fail -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" https://<production>/api/v1/cron/daily`. Add the `CRON_SECRET` repository secret ([research.md §3](./research.md#3-refresh-scheduling-on-hobby)).
- [X] T044 [P] [US2] Update `README.md` (FR-016), before the review so the merged PR carries its own documentation (Definition of Done).
  - Add a "Deploy to Vercel (free)" section covering:
    - the two services, Hobby only, non-commercial use;
    - Turso Free via `vercel integration add turso`, or turso.tech plus `vercel env add`, with separate production and preview databases;
    - `CRON_SECRET` and `SEANSAI_CONTACT`;
    - refresh once a day around 00:00–02:00 Vilnius, and the 27 h staleness on Vercel vs hourly and 3 h self-hosted;
    - `/api/v1/health` as the lasting record, because Hobby logs last 1 hour;
    - a link to [quickstart.md](./quickstart.md).
  - Add `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `CRON_SECRET` to the variables table.
  - Change the layout line "SQLite" to "SQLite (libSQL client; Turso on Vercel)".
- [X] T045 [P] [US2] Update `specs/001-cinema-showtimes/contracts/public-api.md` line 14 to state the list endpoints' `Cache-Control: public, max-age=300, s-maxage=300` and why, linking to [contracts/hosting.md](./contracts/hosting.md).
- [X] T045a [US2] Owner decision (2026-11-01), from the review of T046: a movie shows its most common running time, for every film. Migration 3 adds `screenings.duration_minutes`; `storeRefresh` sets every movie's running time in the same batch. Migration 4 keeps a fixed running time for matching. Merge alias added for Garsas's Sunday showing of _The Cat in the Hat_.
- [X] T046 [US2] Review before production (Constitution I, IV; development workflow step 5).
  - Commit `feat(api): daily refresh by Vercel Cron, 27-hour staleness on Vercel (002 US2)` (including T044 and T045) and push.
  - Run all quality gates (quickstart §1).
  - Have a reviewer agent review the branch against the constitution, plus the author's self-review:
    - no dead code or unused dependencies;
    - _why_ comments on the batching, explicit deletes, entrypoint shim, `s-maxage` and startup mode;
    - `git grep -n "libsql://\|CRON_SECRET="` finds only docs placeholders.
  - Fix the findings.
  - Open a PR from `002-vercel-deploy` to `main`.
  - **Do not merge** until the review is resolved and CI is green.
- [X] T047 [US2] Once T046's PR is approved and CI is green, merge it to `main` (production) with the owner's go-ahead, and check:
  - Vercel's Cron Jobs tab lists `/api/v1/cron/daily`;
  - one manual `curl -H "Authorization: Bearer $CRON_SECRET" https://<production>/api/v1/cron/daily` returns 200 with every enabled source `success`, and its duration in Runtime Logs is < 300 s;
  - then quickstart §5's check on two consecutive mornings. This is the release gate; SC-003's full 7 consecutive days are confirmed in T054.

  Merged as PR #2. The first run found Pasaka and Cinamon refusing Vercel, so T047c replaces the cron and refresh checks, and T047d the check of the real site.

**Changed after T047's first run** (2026-11-02, owner decision): Pasaka and Cinamon refuse Vercel's requests with HTTP 403 ([research.md §5](./research.md#5-keeping-usage-free-sc-002-sc-005)), so every source now refreshes from the owner's Mac.

- [X] T047a [US2] Add `refresh-now.ts`, `scripts/home-refresh.sh` and the launchd job. Remove `crons`. Raise the threshold to 48 h.
- [X] T047b [US2] With the owner's go-ahead, merge, set up the job (quickstart §5) and confirm its first run: every enabled source `success`. Merged as PR #4. The first run into production, by hand on 2026-11-02, had all 11 sources `success`. The first scheduled run, on 2026-11-03, did not: the Mac slept and the four Fliko sources failed ([research.md §5](./research.md#5-keeping-usage-free-sc-002-sc-005)), so no scheduled run has yet been clean. T047c covers that.
- [ ] T047c [US2] Replaces T047's cron checks: quickstart §5's check on two consecutive days.
- [ ] T047d [US2] Replaces the rest of T047: the owner's check of production from a phone. Feature 001's journeys work (quickstart §4 step 7), and the movie list appears in < 2 s, and in < 3 s after an hour idle (SC-004). Record the times in [research.md §5](./research.md#5-keeping-usage-free-sc-002-sc-005).


**Checkpoint**: The site keeps itself current every night with no manual action.

---

## Phase 5: User Story 3 — The maintainer runs it at zero cost (Priority: P3)

**Goal**: Self-hosting still works without the old native toolchain, the kill switch works on
Vercel, and usage stays under half of every free allowance. The documentation already shipped with
US2 (T044).

**Independent Test**:

- Build and run the container with saved data; it works as before.
- A refresh triggered with the secret returns a per-source summary; without the secret nothing
  happens.
- After a week, the Vercel and Turso usage pages show every metric under 50% of the free allowance,
  with no charges (spec US3, quickstart §3, §6).

### Branch for User Story 3

- [X] T048 [US3] US2's PR is already merged, so start a follow-up branch: `git switch main && git pull && git switch -c 002-vercel-deploy-followup`. All US3 and polish commits go here.

### Tests for User Story 3 ⚠️

- [X] T049 [P] [US3] In `apps/api/tests/integration/cron.test.ts`, add a kill-switch test:
  - build the server with a `cron.run` from `runDailyRefresh` over fixture adapters, with `disabledSources: ['forum']` in the refresh context;
  - an authorised call returns `sources.forum === 'disabled'`;
  - the Forum fixture client received no request.

### Implementation for User Story 3

- [X] T050 [P] [US3] In `Dockerfile`, remove the `python3 make g++` toolchain installation, which only `better-sqlite3` needed. Keep `DB_PATH=/data/seansai.sqlite`; config turns it into `file:/data/seansai.sqlite`.
- [X] T051 [US3] Check the container (quickstart §3; CI's `container` job also does this on every push): `docker build -t seansai .`, then run it with `SOURCES_MODE=fixtures` and the saved fixtures mounted, as quickstart §3 shows.
  - `curl -s localhost:3000/api/v1/health` shows `"status":"ok"`.
  - `curl -s localhost:3000/` returns `index.html`.
  - If Docker isn't available, record that this check was skipped in the PR description.

  Docker isn't on the owner's Mac, so this was skipped locally, and CI's `container` job passed on PR #17.
- [ ] T052 [US3] Check the kill switch on production (quickstart §5).
  - Set `DISABLED_SOURCES=forum` in Production and in `refresh.env`, and redeploy.
  - Run the job by hand: the log shows `forum: disabled`, and Forum's cinemas are gone from the site.
  - Remove the variable from both and redeploy.
- [X] T053 [US3] Commit `build: drop the native toolchain from the container (002 US3)` on the follow-up branch.
- [ ] T054 [US3] After one week in production, check usage (quickstart §6, SC-002, SC-005), and confirm SC-003: on each of the 7 days, `/api/v1/health` showed that day's `lastSuccessAt`.
  - Vercel Usage: invocations, Active CPU, Provisioned Memory, Fast Origin and Fast Data Transfer are each < 50% of the Hobby allowance, prorated.
  - Turso: rows read and written, and storage, are each < 50% of Free.
  - Both accounts have no charges and no payment method.
  - Record the figures in [research.md §5](./research.md#5-keeping-usage-free-sc-002-sc-005) under a "Measured" note.

**Checkpoint**: All three stories are delivered and the site is free to run.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T055 Run every quality gate (quickstart §1): `npm run lint && npm run format:check && npm run typecheck && npm test && npm run test:load && npm run build && npm run test:e2e`. All pass.
- [X] T056 [P] Delete the superseded draft `docs/superpowers/plans/2026-10-31-vercel-turso.md`, which this tasks.md replaces. Drop its link from the Structure Decision in [plan.md](./plan.md).
- [ ] T057 Review the US3 and polish changes the same way as T046.
  - These are on `002-vercel-deploy-followup` (T048).
  - Reviewer agent plus self-review against the constitution, and the secret `git grep`.
  - Open a PR to `main`. Merge only once the review is resolved and CI is green.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on T001 and blocks every story. The build is red from T001
  until T011 is done, so Phase 2 lands as one commit (T012).
- **US1 (Phase 3)**: after Phase 2. It is the MVP.
- **US2 (Phase 4)**: after Phase 2 in code. Its deploy steps (T043, T046, T047) need US1's provisioning
  (T025); production is reached only through T046's reviewed PR.
- **US3 (Phase 5)**: starts with T048 (follow-up branch from the merged `main`). T049–T051 need only
  Phase 2 in code. T052 and T054 need US2 in production.
- **Polish (Phase 6)**: after the stories you intend to ship.

### Key task dependencies

- T004 → T005 → T006 (queries use `Repository`) → T007, T009, T010 → T011 → T012
- T013, T016 and T017 must fail before their implementation. T018 → T019 → T020. T023 makes T016
  pass. T021 and T022 are independent of T018.
- T035 → T036. T037 and T038 → T039 → T040. T041 makes T034 pass.
- T025 → T026 → T027 → T028 → T043 → T044, T045 (docs) → T046 (review, PR, CI green) → T047 (merge)
  → T048 (follow-up branch) → T052, T054

### User Story Dependencies

- **US1**: needs only Phase 2.
- **US2**: needs Phase 2. It reuses US1's `refreshMode` (T018–T020) and its provisioning to
  deploy, but its tests run alone.
- **US3**: the container and kill-switch test need only Phase 2. The documentation moved to US2
  (T044, T045), so it ships with the production merge. The production checks need US2.

### Within Each User Story

- Tests are written first and must fail.
- Then config, then services (`daily.ts`), then routes, then wiring (`server.ts`, `main.ts`), then
  deployment files.
- Each story ends with its local check and a commit.

### Parallel Opportunities

- Phase 2: T002 and T003 (different test files). T008 and T009 once T005 and T006 exist.
- US1: T013, T014, T016 and T017 together, then T015 (it shares `movies.test.ts` with T014); T021
  alongside T018; T019 after T018.
- US2: T029, T030, T031, T032, T033 and T034 together; T037 and T038 together; T044 and T045
  together.
- US3: T049 and T050 together, after T048.
- Polish: T056 alongside T055.

---

## Parallel Example: User Story 2

```bash
# Write all US2 tests together (they touch different files):
Task: "T029 27 h threshold tests in apps/api/tests/unit/source-status.test.ts"
Task: "T031 runDailyRefresh tests in apps/api/tests/unit/daily.test.ts"
Task: "T032 cron route auth tests in apps/api/tests/integration/cron.test.ts"

# Then build the two new modules together:
Task: "T037 runDailyRefresh in apps/api/src/refresh/daily.ts"
Task: "T038 cronRoutes in apps/api/src/routes/cron.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 and Phase 2: the async data layer, with the same behaviour.
2. Phase 3: on Vercel with Turso, filled once from a laptop.
3. **Stop and validate** on the preview (T028). The site is public and free, though refreshing
   is manual.

### Incremental Delivery

1. US1: the public site (MVP).
2. US2: nightly refresh in production, so no laptop runs are needed.
3. US3: container cleanup, kill switch and cost proof, on a follow-up branch.
4. Polish: gates, draft-plan cleanup, follow-up PR.

---

## Notes

- Account actions (`vercel link`, the Turso integration, `vercel env add`, merging to `main`) need
  the owner's go-ahead.
- Nothing merges to `main` without a review (reviewer agent plus self-review) and green CI (T046,
  T057). Production is deployed only by merging a reviewed PR.
- Never commit `.env`, `TURSO_*` values or `CRON_SECRET`. `.env` and `.env.*` are already
  gitignored.
- Commit at each phase checkpoint. Push after each story.
