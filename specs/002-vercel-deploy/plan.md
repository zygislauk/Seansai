# Implementation Plan: Free Public Hosting on Vercel

**Branch**: `002-vercel-deploy` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-vercel-deploy/spec.md`

## Summary

Seansai goes public on **Vercel's free Hobby plan**, with its data in **Turso's free plan**.

- **Hosting**: one Vercel project with two services, already committed in `156fa6c`. The web
  pages are served statically by the CDN. The Fastify API runs as one Vercel Function on
  `/api/*`.
- **Data**: the SQLite file is replaced by a shared database. The API moves from `better-sqlite3`
  to `@libsql/client`, which runs the same SQL against Turso on Vercel and against a local file in
  Docker and development. Data access becomes async.
- **Writes**: each source refresh is written as one batch, which is one transaction.
- **Refresh** (changed 2026-11-02): a scheduled job on the owner's Mac refreshes every source once a
  day into Turso, because Pasaka and Cinamon refuse requests from Vercel. The secret-protected
  `/api/v1/cron/daily` route stays as a fallback. The in-process hourly scheduler stays for
  self-hosting.
- **Staleness**: on Vercel a cinema is flagged after 48 hours instead of 3.
- **Free allowances**: list responses become cacheable by Vercel's CDN, and an N+1 query is
  removed. Together these keep Turso reads under half of the free allowance
  ([research.md §5](./research.md#5-keeping-usage-free-sc-002-sc-005)).

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 24, unchanged

**Primary Dependencies**:
- API: Fastify 5, zod, cheerio, fast-xml-parser. **`@libsql/client` replaces `better-sqlite3`.**
- Web: unchanged.
- Hosting: Vercel Services (Beta, all plans), Turso Cloud
  ([research.md §1–§3](./research.md)).

**Storage**:
- Vercel: Turso (libSQL, SQLite-compatible), Free plan, EU region. Two databases, `seansai` for
  Production and `seansai-preview` for Preview, so a preview can never migrate or write
  production's data.
- Docker and local development: a SQLite file through the same client.
- Tests: `:memory:`.
- Schema: `schema_migrations`, `screenings.duration_minutes` and `movies.match_duration_minutes` added ([data-model.md](./data-model.md)).

**Testing**:
- Vitest for unit and integration tests, now async.
- The existing Playwright end-to-end suite.
- `vercel dev` for both services locally (quickstart §2).
- Manual checks on the first preview and production deploys (quickstart §4–§6).

**Target Platform**:
- Vercel Hobby: static CDN for `web`, plus one Node.js Function in `fra1` for `api` (Fluid
  compute, 300 s maximum).
- The Docker container on Linux stays supported.

**Project Type**: Web application (npm workspaces monorepo: `apps/api`, `apps/web`,
`packages/shared`), unchanged

**Performance Goals** (feature 001's, plus spec SC-004):
- Movie and screening lists in < 2 s on a mid-range phone over 4G.
- First request after the site has been idle (cold start) in < 3 s.
- API p95 < 300 ms at the server.
- Every request takes **at most a fixed number of database round trips**, with no N+1 (research
  §5).

**Constraints**:
- **Free plans only (FR-011)**: Hobby cron at most daily, a single function region, 300 s
  function limit, monthly allowances ([research.md §5](./research.md#5-keeping-usage-free-sc-002-sc-005)).
- Turso: interactive transactions time out after 5 s, so writes are batched. Foreign keys aren't
  enforced, so deletes are explicit.
- Cinemas are contacted only by refresh runs (FR-007).
- Hobby runtime logs last 1 hour, so `/health` and the `sources` table are the lasting record.

**Scale/Scope**:
- Load from feature 001: about 1,000 visitors a day, peaks of 100 at once.
- Data: about 3,000 rows (1.2 MB), one refresh run a day of about 6,000 row writes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| I. Code Quality | Lint, format and type checks run unchanged in CI. Cron failures are handled per source and recorded (FR-009). No swallowed errors: a thrown refresh becomes `failed` and is logged. `better-sqlite3` is removed with its types (no unused dependencies). Nothing reaches `main` (production) without a reviewer-agent review, self-review and green CI (tasks T046, T057). | ✅ |
| II. Readability First | Data access stays in `db/` and the refresh logic in `refresh/`. New code is one route file and one `daily.ts`. Non-obvious constraints get *why* comments: the batching for Turso's 5 s transaction limit, explicit deletes because FKs are off, and the entrypoint shim. | ✅ |
| III. Simplicity | Same SQL and language; the schema changes only for `schema_migrations` and running times (per screening, and a fixed one for matching). One client for all environments. No ORM, no Blob, no queue. Additions are justified in Complexity Tracking. | ✅ (see table) |
| IV. Testing (NON-NEGOTIABLE) | New tests: config modes, the 48 h threshold, `storeRefresh` (all-or-nothing, review counts), explicit cascade deletes, migration re-open, daily refresh (failure isolation, cleanup order), cron route auth (404 cases), `s-maxage` headers, **`vercel.json` routing and headers** (rewrite order, SPA fallback, CSP equal to the API's, region, at-most-daily cron), and **startup mode** (cron mode never refreshes or contacts cinemas, FR-007/SC-006). Existing integration and end-to-end suites run against the async client. Only provider-side behaviour (Turso migrations, CDN hits, cron firing) is checked by hand (quickstart §4–§5). | ✅ |
| V. Great UX | Nothing visible changes. The stale notice works as in 001, with a 48 h threshold on Vercel. Deep links work through the SPA fallback. Before the first refresh, the existing empty state shows. | ✅ |
| VI. Performance | Budgets stated above. Function and database in neighbouring EU regions (`fra1`, `dub1`). One batch per source refresh. The `freshness` and `/health` N+1 is removed. CDN caching cuts origin load. The load test still gates p95 < 300 ms. | ✅ |
| VII. Scalability | The API becomes stateless: data in a shared store, so instances scale without coordination. The one in-process coordination is `Repository.reserveTurn`, which only orders one instance's refresh writes. Load and 10× analysis below. | ✅ |
| Quality Standards | Secrets only in Vercel environment variables (FR-013). The cron secret is compared in constant time and never logged. Structured logs for each source and the run summary. `npm audit` stays in CI. Documentation updated (FR-016). | ✅ |

**Spec-level deviation (not a constitution violation)**: on the hosted deployment, this feature
replaces feature 001's FR-014 ("refresh at least every 3 hours") and its 3-hour stale threshold
(FR-015, SC-005) with a daily refresh and 48 hours (spec FR-004, FR-006). The owner approved this
on 2026-10-31 to stay on the free plan. Self-hosting keeps 001's behaviour.

**Post-design re-check (after Phase 1)**: still passing.
- The design added CDN caching (one header change) and an N+1 fix. Both reduce complexity at
  runtime.
- The contracts add no public API surface: the cron route is an operations endpoint that answers
  404 to everyone without the secret.

### Scalability check (10×: ~10,000 visitors/day, ~1,000 concurrent)

| Resource | At 10× | First to break? |
|----------|--------|-----------------|
| Vercel Active CPU (4 h/mo Hobby) | ~40 min × 10 for the API ≈ 6.7 h if uncached; with CDN hits mostly absorbed, ≈ 1.5–3 h | **Likely first.** Upgrade to Pro, or lengthen `s-maxage` |
| Vercel invocations (1 M/mo) | ≤ 2.4 M uncached; CDN brings it well under 1 M | Second |
| Turso rows read (500 M/mo) | Misses are bounded per URL by the CDN, so this grows with the number of distinct URLs, not visitors: ≈ 100–200 M | No |
| Turso rows written | Unchanged; depends on cinemas, not visitors | No |
| Refresh duration (300 s) | Unchanged; depends on cinemas | No (adding many cinemas would be) |

The first bottleneck at 10× is the Hobby compute allowance. The fixes are a longer CDN `s-maxage`
or moving to Pro, with no rewrite. The design doesn't depend on Hobby beyond the cron frequency
and the 48 h threshold, which are config values.

## Project Structure

### Documentation (this feature)

```text
specs/002-vercel-deploy/
├── plan.md              # This file
├── research.md          # Phase 0: hosting, data store, cron, staleness, free allowances, region
├── data-model.md        # Phase 1: where data lives, write rules, runtime values
├── quickstart.md        # Phase 1: local, container, first deploy, daily and cost checks
├── contracts/
│   ├── cron-endpoint.md # GET /api/v1/cron/daily
│   └── hosting.md       # vercel.json, environment variables, cache headers, free-plan guardrails
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
vercel.json                          # + regions (services/rewrites already committed)
Dockerfile                           # drop the native-build toolchain needed only by better-sqlite3
README.md                            # "Deploy to Vercel (free)" section + new variables (FR-016)
apps/api/
├── index.ts                         # Vercel entrypoint shim (committed)
├── package.json                     # @libsql/client in, better-sqlite3 + @types out
└── src/
    ├── config.ts                    # db {url, authToken}, refreshMode, staleAfterMs, cronSecret
    ├── main.ts                      # async openDb; startBackgroundRefresh; cron wiring
    ├── server.ts                    # ServerOptions.staleAfterMs, .cron; exports SECURITY_HEADERS
    ├── db/
    │   ├── index.ts                 # openDb(url, authToken) → libSQL Client; batched migrations; splitStatements
    │   ├── repository.ts            # async; storeRefresh (one batch); explicit stale-movie deletes; no transaction()
    │   └── queries.ts               # async; staleAfterMs option; freshness via one listSources()
    ├── refresh/
    │   ├── refresh-source.ts        # compute in memory, then repo.storeRefresh
    │   ├── scheduler.ts             # async cleanup callback
    │   ├── status.ts                # deriveSourceStatus(…, staleAfterMs)
    │   ├── daily.ts                 # NEW runDailyRefresh: all sources in parallel, then cleanup
    │   └── startup.ts               # NEW startBackgroundRefresh: no scheduler in 'cron' mode (FR-007)
    └── routes/
        ├── http.ts                  # setListCaching adds s-maxage=300
        ├── health.ts                # async; one listSources(); staleAfterMs
        ├── movies.ts, screenings.ts # async handlers
        └── cron.ts                  # NEW GET /cron/daily, bearer secret, 404 otherwise
apps/api/tests/
├── helpers/temp-db.ts, catalog.ts, large-catalog.ts   # async
├── unit/config.test.ts, source-status.test.ts, scheduler.test.ts,
│   daily.test.ts, startup.test.ts, vercel-config.test.ts (NEW)
└── integration/repository.test.ts, cron.test.ts (NEW), server.test.ts (+ s-maxage), …  # async
```

**Structure Decision**: keep the existing monorepo layout from feature 001. All code changes are
in `apps/api` plus the root deployment files. `apps/web` and `packages/shared` don't change. The
draft task list in [docs/superpowers/plans/2026-10-31-vercel-turso.md](../../docs/superpowers/plans/2026-10-31-vercel-turso.md)
matches this structure and feeds `/speckit-tasks`.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| Two refresh modes (`scheduler` / `cron`) chosen by config | Hobby has no long-running process; self-hosting (FR-015) still needs the hourly scheduler | Cron everywhere would need an external scheduler for Docker users. Scheduler everywhere can't run on Vercel functions |
| Cron route with a shared secret | Vercel Cron calls a URL; the maintainer needs on-demand refresh (FR-008) | A public unauthenticated trigger would let anyone make Seansai hammer cinema sites (FR-007) |
| `storeRefresh` batch instead of a transaction callback | Turso interactive transactions time out after 5 s and cost a round trip per statement | Keeping `transaction(work)` would exceed the timeout on large sources and take minutes per refresh |
| `apps/api/index.ts` entrypoint shim | `@vercel/fastify` ignores the configured entrypoint and would pick `src/server.ts` | Renaming `src/main.ts` would touch the Dockerfile, scripts and docs for a platform quirk |
| Full refresh runs inside the cron route's HTTP request (up to minutes) | Hobby has no background workers or queues on the free plan; Vercel Cron can only call a URL. The request comes from the scheduler or the maintainer, never a visitor, so Constitution VII's "not inside a user request" holds. Sources are refreshed in parallel to stay well inside the 300 s limit (research §3) | A queue or background worker (Vercel Queues, Daemons) would add a paid or extra moving part for one job a day |
| Environment-dependent stale threshold (48 h / 3 h) | Daily refresh would otherwise flag every cinema as outdated all day | One 48 h threshold everywhere would hide real failures for a day on self-hosted copies, which still refresh hourly |
| `Repository.reserveTurn` (in-process queue around read-match-store) | Sources refreshing in parallel each missed the other's new film and created lasting duplicates, and storing in fetch order made films split in some runs | Refreshing sources one after another would make the cron run far longer, and most of its time is waiting on cinemas |
| A second way to run a refresh (`refresh-now.ts`, a job on the owner's Mac) | Pasaka and Cinamon refuse requests from Vercel, and the owner wants all venues refreshed the same way | A paid proxy disguises the requests' origin; fetching in visitors' browsers can't read 6 of 11 sources |
