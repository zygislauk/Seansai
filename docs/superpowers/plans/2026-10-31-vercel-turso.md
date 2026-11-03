# Vercel Hobby + Turso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Seansai on Vercel's free Hobby plan with its data in Turso's free plan, refreshed by one daily Vercel Cron Job, while Docker and local development keep working as today.

**Architecture:** The API's SQLite access moves from `better-sqlite3` (synchronous) to `@libsql/client` (async), which talks to a remote Turso database on Vercel and to a local `file:` or `:memory:` database everywhere else, with the same SQL. Each source refresh is computed in memory and written in one `batch` (one transaction), because Turso's interactive transactions time out after 5 s. On Vercel in live mode there is no in-process scheduler: a protected `GET /api/v1/cron/daily` route refreshes every source and runs the cleanup, called once a day by Vercel Cron.

**Tech Stack:** Node.js 24 (TypeScript via type stripping), Fastify 5, `@libsql/client`, Vitest, Vercel Services + Cron Jobs, Turso Cloud.

**Spec:** The decisions agreed in the conversation of 2026-10-31, summarised here:

- Two Vercel services: `api` (Fastify, `apps/api`, public on `/api/*`) and `web` (Vite, `apps/web`, everything else). No bindings. Already in `vercel.json` (uncommitted).
- Database: Turso, **free plan only** (5 GB, 500 M rows read and 10 M rows written per month). Vercel: **Hobby plan only**.
- Refresh: **once a day** (Hobby cron limit; it fires anywhere in the scheduled hour). Daily cleanup runs in the same call.
- A source counts as `stale` after 27 h on Vercel (daily refresh), still 3 h elsewhere.
- Docker and `npm run dev` keep the hourly in-process scheduler and a local SQLite file.

## Global Constraints

- Free plans only: Vercel Hobby, Turso Free. No Vercel Blob, no paid add-ons, no Pro-only settings. Cron schedule `0 22 * * *` (22:00–22:59 UTC = just after midnight Vilnius in winter, 01:00 in summer).
- Node.js ≥ 24; the API still runs `.ts` directly (`node src/main.ts`), no build step.
- Cinemas are contacted only by the daily cron (Vercel) or the scheduler (Docker/local). A cold start on Vercel never fetches from a cinema.
- Environment variables: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (set by the Turso integration), `CRON_SECRET` (sent by Vercel Cron as `Authorization: Bearer <secret>`), `SEANSAI_CONTACT`, `DISABLED_SOURCES`, `DB_PATH` (Docker/local), `SOURCES_MODE`.
- Foreign-key cascades are not relied on (remote Turso requests do not keep `PRAGMA foreign_keys`); deletes of dependent rows are explicit.
- All README quality gates pass: `npm run lint`, `format:check`, `typecheck`, `test`, `test:load` (p95 < 300 ms), `build`, `test:e2e`.

## Review Focus

1. **Cold start on Vercel (live mode)** must not start the scheduler or any refresh — pinned by the config test in Task 3 (`refreshMode: 'cron'`) and the wiring in Task 4.
2. **A cron call without, or with a wrong, `Authorization` header** must do nothing and answer 404 as if the route did not exist; with `CRON_SECRET` unset the route is absent — tests in Task 4.
3. **One source failing during the daily run** must not stop the other sources or the cleanup — test in Task 4.
4. **Stale-movie cleanup with foreign keys off** must leave no orphaned `movie_keys` or `match_reviews` rows — test in Task 2.
5. **The largest source's single batch against real Turso** (size and time) and `PRAGMA user_version` migrations on Turso cannot be tested locally — explicit checks in Task 6.

---

### Task 1: Commit the Vercel services setup on a branch

**Files:** already changed in the working tree: `vercel.json`, `apps/api/index.ts`, `apps/api/src/config.ts`, `apps/api/tests/unit/config.test.ts`, `apps/api/tsconfig.json`, `.gitignore`, `.prettierignore`.

- [ ] **Step 1:** `git switch -c 002-vercel-turso`
- [ ] **Step 2:** Run `npm run lint && npm run format:check && npm run typecheck && npm test -w @seansai/api`. Expected: all pass.
- [ ] **Step 3: Commit**

```bash
git add vercel.json apps/api/index.ts apps/api/src/config.ts apps/api/tests/unit/config.test.ts apps/api/tsconfig.json .gitignore .prettierignore
git commit -m "build: deploy as Vercel services (api + web)"
```

---

### Task 2: Move the data layer to `@libsql/client`

One task because the switch to async cannot be split without leaving the build broken.

**Files:**

- Modify: `apps/api/package.json` (add `@libsql/client`; remove `better-sqlite3`, `@types/better-sqlite3`), `package-lock.json`
- Modify: `apps/api/src/db/index.ts`, `apps/api/src/db/repository.ts`, `apps/api/src/db/queries.ts`
- Modify: `apps/api/src/refresh/refresh-source.ts`, `apps/api/src/refresh/scheduler.ts`, `apps/api/src/routes/{health,movies,screenings}.ts`, `apps/api/src/server.ts`, `apps/api/src/main.ts`
- Modify tests: `apps/api/tests/helpers/{temp-db,catalog,large-catalog}.ts`, every `apps/api/tests/integration/*.test.ts` and `tests/load/peak.test.ts` that uses them, `tests/unit/scheduler.test.ts`

**Interfaces:**

- Produces (`db/index.ts`):
  - `export type Db = Client` (from `@libsql/client`)
  - `export async function openDb(url: string, authToken?: string | null): Promise<Db>` — `url` is `libsql://…`, `file:<path>` or `:memory:`. For `file:` it creates the directory and sets `PRAGMA journal_mode = WAL`. Runs pending migrations: reads `PRAGMA user_version`, then per migration one `db.batch([...splitStatements(sql), \`PRAGMA user_version = ${n}\`], 'write')`.
  - `export function splitStatements(sql: string): string[]` — drops `--` comment lines, splits on `;`, trims, drops empties.
- Produces (`db/repository.ts`, all async):
  - `upsertMovie(movie, keys?): Promise<void>`, `getMovie(id): Promise<MovieRecord | undefined>`, `listMovieIdentities(): Promise<MovieIdentity[]>`, `replaceSourceScreenings(sourceId, from, screenings): Promise<void>`, `recordSourceAttempt(...)`/`recordSourceSuccess(...)`: `Promise<void>`, `getSource(id)`, `listSources()`, `deletePastScreenings(today): Promise<number>`, `deleteStaleMovies(now): Promise<number>`, `insertMatchReview(review): Promise<boolean>`
  - New: `storeRefresh(refresh: SourceRefresh): Promise<{ newReviews: number }>` with `export type SourceRefresh = { sourceId: string; now: Date; movies: Array<{ movie: MovieRecord; keys: readonly string[] }>; screenings: ScreeningRecord[]; reviews: Array<Omit<MatchReviewRecord, 'firstSeenAt'>> }`. Writes everything for one source refresh in **one** `db.batch(..., 'write')`, in this order: every movie upsert with its keys (in the given order, so the existing COALESCE "first source wins, later ones fill gaps" behaviour is unchanged), delete the source's screenings from `now`, screening upserts, `last_screening_at` raises, review inserts (`firstSeenAt = now`), `recordSuccess`. `newReviews` = number of review inserts with `rowsAffected > 0`.
  - Removed: `transaction()`. Statements become SQL string constants built into `InStatement`s by private helpers shared between the single-purpose methods and `storeRefresh`.
  - `deleteStaleMovies` runs in one batch: delete `movie_keys` and `match_reviews` rows of the stale movies, then the movies; returns the movies' `rowsAffected`.
- Produces (`db/queries.ts`): `listMovies`, `getMovie`, `screeningDates`, `availableDates`, `listScreenings`, `nextDateWithScreenings`, `freshness` return Promises; `cinemasIn`, `listCities`, `isCity` stay synchronous.
- Produces (`refresh/scheduler.ts`): `SchedulerOptions.cleanup: (now: Date) => Promise<void>`.
- Produces (`tests/helpers/temp-db.ts`): `createTempDb(): Promise<{ db: Db; path: string; cleanup: () => void }>`.

- [ ] **Step 1: Swap dependencies:** `npm uninstall -w @seansai/api better-sqlite3 @types/better-sqlite3 && npm install -w @seansai/api @libsql/client`

- [ ] **Step 2: Write the new failing tests** in `tests/integration/repository.test.ts`:

```ts
test('splitStatements ignores comments and empty statements', () => {
  expect(
    splitStatements('-- a; b\nCREATE TABLE a (x);\n\n-- c\nCREATE INDEX i ON a (x);\n'),
  ).toEqual(['CREATE TABLE a (x)', 'CREATE INDEX i ON a (x)']);
});

test('reopening a database file does not run migrations again', async () => {
  const first = await createTempDb();
  first.db.close();
  const again = await openDb(`file:${first.path}`);
  expect((await again.execute('PRAGMA user_version')).rows[0]?.[0]).toBe(2);
  again.close();
});

test('storeRefresh writes one source refresh and counts only new reviews', async () => {
  const review = {
    matchKey: 'digger',
    movieIdA: 'digger-2026',
    movieIdB: 'digger-2025',
    reason: 'year differs',
  };
  const refresh = {
    sourceId: 'apollo',
    now: NOW,
    movies: [
      { movie: movieRecord(), keys: ['kasejas'] },
      { movie: movieRecord({ id: 'digger-2025', year: 2025 }), keys: [] },
    ],
    screenings: [screeningRecord()],
    reviews: [review],
  };
  expect(await repo.storeRefresh(refresh)).toEqual({ newReviews: 1 });
  expect(await repo.storeRefresh(refresh)).toEqual({ newReviews: 0 });
  expect((await repo.getSource('apollo'))?.lastSuccessAt).toEqual(NOW);
  expect(
    (await repo.listMovieIdentities()).find((m) => m.id === 'digger-2026')?.keys.sort(),
  ).toEqual(['digger', 'kasejas']);
});

test('deleteStaleMovies leaves no orphaned keys or reviews', async () => {
  await repo.upsertMovie(movieRecord(), ['kasejas']);
  await repo.upsertMovie(movieRecord({ id: 'digger-2025', year: 2025 }));
  await repo.insertMatchReview({
    matchKey: 'digger',
    movieIdA: 'digger-2026',
    movieIdB: 'digger-2025',
    reason: 'year differs',
    firstSeenAt: NOW,
  });
  // Neither movie has screenings and last_screening_at is NULL, so both are stale.
  expect(await repo.deleteStaleMovies(NOW)).toBe(2);
  expect((await db.execute('SELECT COUNT(*) FROM movie_keys')).rows[0]?.[0]).toBe(0);
  expect((await db.execute('SELECT COUNT(*) FROM match_reviews')).rows[0]?.[0]).toBe(0);
});
```

- [ ] **Step 3:** Run `npx vitest run tests/integration/repository.test.ts` in `apps/api`. Expected: FAIL (`storeRefresh`/`splitStatements` missing, `createTempDb` not async).
- [ ] **Step 4: Implement** `db/index.ts`, `db/repository.ts`, `db/queries.ts` per the Interfaces. Row results: cast `result.rows as unknown as RowType[]`; integers come back as `number` (default `intMode`). Never pass `undefined` as an argument; use `null`.
- [ ] **Step 5: Update callers:**
  - `refreshSource`: `await repo.listMovieIdentities()`; `storeScreenings` becomes synchronous and returns `{ movies, records, reviews }` without writing; then one `await repo.storeRefresh(...)`. `newReviews` comes from its result. Failure path: `await repo.recordSourceAttempt(...)`.
  - Routes: handlers become `async` and `await` query and repo calls. `findMovie` becomes `async` and returns `Promise<MovieRecord>`.
  - `scheduler.ts`: `runCleanup` awaits `cleanup` inside its try/catch.
  - `main.ts`: `const db = await openDb(\`file:${config.dbPath}\`)`, or `':memory:'`when`dbPath`is`':memory:'`. Task 3 replaces this with `config.db`. Await `recordSourceSuccess`, and make the cleanup callback async.
- [ ] **Step 6: Update tests and helpers** to `await` every repo, queries and `createTempDb` call. `catalog.ts` and `large-catalog.ts` seed through `upsertMovie`/`replaceSourceScreenings` as before.
- [ ] **Step 7:** Run `npm test -w @seansai/api && npm run test:load && npm run typecheck && npm run lint`. Expected: all pass, and the load test's p95 stays below 300 ms.
- [ ] **Step 8:** Run `SOURCES_MODE=fixtures npm run dev`, then `curl -s 'localhost:3000/api/v1/movies?city=vilnius' | head -c 200`. Expected: a JSON movie list.
- [ ] **Step 9: Commit:** `git commit -am "refactor(api): use @libsql/client so the database can live in Turso"`. Run `git add` first for the lockfile if needed.

---

### Task 3: Configuration for Turso and Vercel's daily refresh

**Files:**

- Modify: `apps/api/src/config.ts`, `apps/api/tests/unit/config.test.ts`
- Modify: `apps/api/src/refresh/status.ts`, `tests/unit/source-status.test.ts`
- Modify: `apps/api/src/db/queries.ts` (options), `apps/api/src/routes/health.ts` (options), `apps/api/src/server.ts` (`ServerOptions.staleAfterMs?: number`), `apps/api/src/main.ts`

**Interfaces:**

- Produces (`Config`): replaces `dbPath: string` with `db: { url: string; authToken: string | null }`, and adds `refreshMode: 'scheduler' | 'cron'`, `staleAfterMs: number` and `cronSecret: string | null`.
- `db.url` is chosen in this order:
  1. `TURSO_DATABASE_URL` (with `TURSO_AUTH_TOKEN`).
  2. `file:${DB_PATH}`.
  3. `':memory:'` in fixtures mode.
  4. On Vercel in live mode, a configuration error: `TURSO_DATABASE_URL is required on Vercel`.
  5. Otherwise `file:` + the current default path.
- Remove the `/tmp` default added in Task 1.
- `refreshMode`: `'cron'` when `VERCEL` is set and `SOURCES_MODE` is `live`; otherwise `'scheduler'`. Fixture mode on Vercel keeps the scheduler, which only does its one startup refresh from saved files, so `vercel dev` has data.
- `staleAfterMs`: `27 h` in cron mode, `3 h` (`STALE_AFTER_MS`) otherwise.
- `cronSecret`: `CRON_SECRET` or null.
- `deriveSourceStatus(source, now, staleAfterMs = STALE_AFTER_MS)`; `Queries` options and `healthRoutes` options gain `staleAfterMs: number`, passed down from `ServerOptions.staleAfterMs ?? STALE_AFTER_MS`.

- [ ] **Step 1: Write failing tests** in `config.test.ts`:

```ts
test('on Vercel in live mode uses Turso, refreshes by cron and allows 27 hours before stale', () => {
  const config = loadConfig({
    SEANSAI_CONTACT: 'hello@seansai.lt',
    VERCEL: '1',
    NODE_ENV: 'production',
    TURSO_DATABASE_URL: 'libsql://seansai-x.turso.io',
    TURSO_AUTH_TOKEN: 't',
    CRON_SECRET: 's',
  });
  expect(config.db).toEqual({ url: 'libsql://seansai-x.turso.io', authToken: 't' });
  expect(config.refreshMode).toBe('cron');
  expect(config.staleAfterMs).toBe(27 * 60 * 60 * 1000);
  expect(config.cronSecret).toBe('s');
  expect(config.serveWebApp).toBe(false);
});

test('on Vercel in live mode requires TURSO_DATABASE_URL', () => {
  expect(() => loadConfig({ SEANSAI_CONTACT: 'hello@seansai.lt', VERCEL: '1' })).toThrow(
    /TURSO_DATABASE_URL/,
  );
});

test('on Vercel in fixtures mode keeps the scheduler and an in-memory database', () => {
  const config = loadConfig({ SOURCES_MODE: 'fixtures', VERCEL: '1' });
  expect(config.refreshMode).toBe('scheduler');
  expect(config.db.url).toBe(':memory:');
});
```

Update the existing tests: `dbPath` → `db.url` (`file:` prefix; `DB_PATH: '/data/x.sqlite'` → `'file:/data/x.sqlite'`); defaults include `refreshMode: 'scheduler'`, `staleAfterMs: 3 * 60 * 60 * 1000`, `cronSecret: null`. Replace the Task 1 `/tmp` test.
In `source-status.test.ts` add: with `staleAfterMs` of 27 h, a success 26 h ago is `healthy` and 27 h ago is `stale`.

- [ ] **Step 2:** Run `npx vitest run tests/unit/config.test.ts tests/unit/source-status.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces; `main.ts` uses `openDb(config.db.url, config.db.authToken)` and passes `staleAfterMs: config.staleAfterMs` to `buildServer`.
- [ ] **Step 4:** Run `npm test -w @seansai/api && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -am "feat(api): configure Turso and the daily-refresh mode for Vercel"`

---

### Task 4: Daily refresh route for Vercel Cron

**Files:**

- Create: `apps/api/src/refresh/daily.ts`, `apps/api/src/routes/cron.ts`
- Create: `apps/api/tests/unit/daily.test.ts`, `apps/api/tests/integration/cron.test.ts`
- Modify: `apps/api/src/server.ts`, `apps/api/src/main.ts`, `vercel.json`

**Interfaces:**

- Produces (`refresh/daily.ts`):
  - `export type DailyRefreshResult = { sources: Record<string, RefreshOutcome['status']>; cleanup: { screenings: number; movies: number } }`
  - `export async function runDailyRefresh(deps: { adapters: readonly SourceAdapter[]; refresh: (adapter: SourceAdapter, now: Date) => Promise<RefreshOutcome>; cleanup: (now: Date) => Promise<{ screenings: number; movies: number }>; clock: () => Date; logger: Logger }): Promise<DailyRefreshResult>`
  - Refreshes all adapters in parallel. A refresh that throws counts as `'failed'` and is logged. The cleanup runs after all refreshes settle, using a fresh `clock()`.
- Produces (`routes/cron.ts`): `cronRoutes: FastifyPluginAsync<{ secret: string; run: () => Promise<DailyRefreshResult> }>` registers `GET /cron/daily`.
  - When `authorization` equals `Bearer ${secret}`: runs `run()`, answers 200 with its result and `cache-control: no-store`.
  - Otherwise: 404 `errorBody('not_found', 'There is no such API route.')`.
  - Compare SHA-256 digests with `crypto.timingSafeEqual`.
- Produces (`ServerOptions`): `cron?: { secret: string; run: () => Promise<DailyRefreshResult> } | null`. It's registered inside the `/api/v1` prefix only when set.
- `main.ts` wiring:
  - Build the per-adapter `refresh` and the `cleanup` closures once, and use them for both the scheduler and `runDailyRefresh`.
  - Pass `cron` when `config.cronSecret` is set.
  - Call `startScheduler` only when `config.refreshMode === 'scheduler'`. In cron mode, log `'Refresh runs from Vercel Cron; scheduler not started'`.
- `vercel.json` (top level): `"crons": [{ "path": "/api/v1/cron/daily", "schedule": "0 22 * * *" }]`.

- [ ] **Step 1: Write failing tests.**
  - `daily.test.ts`, using stub adapters `a` (resolves success), `b` (resolves `{status:'failed'}`) and `c` (throws):
    - result `sources` is `{ a: 'success', b: 'failed', c: 'failed' }`;
    - `cleanup` is called once, after all three refreshes;
    - result `cleanup` equals the stub's return.
  - `cron.test.ts`, building the server with `cron: { secret: 's3cret', run: vi.fn().mockResolvedValue(result) }`:
    - no header → 404 and `run` not called;
    - `Bearer wrong` → 404 and `run` not called;
    - `Bearer s3cret` → 200, the result as the body, `cache-control: no-store`;
    - without the `cron` option → 404.
- [ ] **Step 2:** Run `npx vitest run tests/unit/daily.test.ts tests/integration/cron.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** per the Interfaces.
- [ ] **Step 4:** Run `npm test -w @seansai/api && npm run lint && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Check locally under `vercel dev`.**
  - Write a gitignored `.env` with `SOURCES_MODE=fixtures` and `CRON_SECRET=local`, then run `vercel dev --local --listen 3333`.
  - `curl -s -H 'Authorization: Bearer local' localhost:3333/api/v1/cron/daily` → 200 with a `sources` map.
  - The same call without the header → 404.
  - The `crons` key is accepted (no config error at startup).
  - Delete `.env` afterwards.
- [ ] **Step 6: Commit:** `git add -A apps/api vercel.json && git commit -m "feat(api): daily refresh route for Vercel Cron"`

---

### Task 5: Container and documentation

**Files:**

- Modify: `Dockerfile`, `README.md`

- [ ] **Step 1: Dockerfile.**
  - Remove the `python3 make g++` toolchain stage, which existed only for `better-sqlite3`. `@libsql/client` ships prebuilt binaries for linux x64/arm64 (glibc), which `node:24-slim` uses.
  - Keep `DB_PATH=/data/seansai.sqlite`. The config turns it into `file:/data/seansai.sqlite`.
- [ ] **Step 2: Verify the container** if Docker is available:
  - `docker build -t seansai . && docker run --rm -e SOURCES_MODE=fixtures -p 3000:3000 seansai`
  - `curl -s localhost:3000/api/v1/health` → `"status":"ok"`.
  - If Docker isn't available, record that this was skipped.
- [ ] **Step 3: README.**
  - Add a "Deploy to Vercel (free)" section: the two services; Turso free plan via the Marketplace (or turso.tech plus `vercel env add`); `CRON_SECRET`, `SEANSAI_CONTACT`; refresh daily at about 00:00–01:00 Vilnius; 27 h staleness.
  - Add `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and `CRON_SECRET` to the variables table.
  - Change "SQLite" in the project layout to "SQLite (libSQL; Turso on Vercel)".
- [ ] **Step 4:** Run `npm run format:check && npm run build && npm run test:e2e`. Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -am "docs: deploy to Vercel Hobby with Turso"`

---

### Task 6: Provision on free plans and first deploy (with the user)

Each step that creates accounts, resources or secrets needs the user's go-ahead.

- [ ] **Step 1: Link the project:** `vercel link` creates the project on the Hobby team.
- [ ] **Step 2: Turso, free plan.**
  - Run `vercel integration add turso` (or install from the dashboard) and choose the **Free** plan. Put the database in the region closest to the Vercel functions' region.
  - If the install asks for a paid plan or a card on Hobby, stop. Instead, create the database at turso.tech (free, no card), then `vercel env add TURSO_DATABASE_URL` and `vercel env add TURSO_AUTH_TOKEN` for Production and Preview.
- [ ] **Step 3: Secrets.**
  - `vercel env add CRON_SECRET` with a random value (`openssl rand -hex 32`).
  - `vercel env add SEANSAI_CONTACT` with `https://github.com/zygislauk/Seansai`.
- [ ] **Step 4: Preview deploy.**
  - Push the branch, or run `vercel deploy`.
  - Expected: the build succeeds and the `crons` entry is accepted on Hobby.
  - `curl <preview>/api/v1/health` → `status: ok`, every source `stale`. This also proves migrations ran on Turso: `PRAGMA user_version` worked.
  - If the preview has Deployment Protection, use the `vercel:access-protected-vercel-deployment` skill.
- [ ] **Step 5: First data load.**
  - `curl -H "Authorization: Bearer $CRON_SECRET" <preview>/api/v1/cron/daily`.
  - Expected: 200 and every enabled source `success`.
  - Check Runtime Logs for the duration, which must be well under the Hobby function limit. Check that no batch was rejected for size; that would show up on the source with the most screenings (Forum).
- [ ] **Step 6: Usage check.**
  - In the Turso dashboard, rows written by one run should be in the low thousands. Times 30 must stay far below 10 M.
  - Rows read after browsing a few pages should be in the thousands.
- [ ] **Step 7: Production.**
  - Merge to `main` and confirm Vercel shows the cron job on the production deployment.
  - Trigger it once by hand as in Step 5, so production has data before the first scheduled run.
