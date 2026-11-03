# Research: Free Public Hosting on Vercel

**Feature**: [spec.md](./spec.md) | **Date**: 2026-10-31

Facts about the providers were checked against their documentation on 2026-10-31. The local
measurements come from the developer's live database on the same day.

## 1. Hosting shape: two Vercel services

- **Decision**: One Vercel project with two services in `vercel.json`:
  - `web`: the Vite build from `apps/web`, served as static files, with a fallback to
    `index.html` for every page path and the security headers set on the service.
  - `api`: the Fastify app from `apps/api`, one Vercel Function, public on `/api/(.*)`.
  - No bindings, because the browser calls `/api/v1/...` on the same origin.
- **Rationale**: Static pages are served from the CDN at no function cost. One domain keeps
  `connect-src 'self'` and relative API URLs working unchanged. Services are in Beta but available
  on all plans, including Hobby.
- **Found while testing locally**: `@vercel/fastify` ignores the service `entrypoint`. It uses the
  first `app|index|server` file, in the root and then `src/`, whose source contains
  `from 'fastify'`. That was `src/server.ts`, which never calls `listen`, so every request hung.
  `apps/api/index.ts` fixes this. It sorts first and imports `src/main.ts`. This shipped in commit
  `156fa6c`.
- **Alternatives considered**:
  - The root `Dockerfile` as one container service: no persistent disk on Vercel, so it would
    have the same data problem, and every page request would cost a function call.
  - Two separate Vercel projects: they don't deploy together, so pages and API could be out of
    step with each other.

## 2. Shared data store

- **Decision**: Turso Cloud, **Free plan**, accessed with **`@libsql/client`**. The client
  replaces `better-sqlite3` everywhere:
  - on Vercel: `libsql://…` plus an auth token;
  - in Docker and local development: `file:<path>`;
  - in tests and fixture mode: `:memory:`.
- **Rationale**:
  - libSQL is a fork of SQLite, so `schema.sql`, the migrations and every query run unchanged.
    That includes STRICT tables, `WITHOUT ROWID`, `json_each`, `json_group_array` and
    `ON CONFLICT` upserts.
  - `@libsql/client` is the mature client Turso's docs point to for remote libSQL and ORMs. It
    also opens local files, so self-hosting keeps working without a second code path.
  - Turso Free includes 5 GB of storage, 500 M rows read and 10 M rows written a month, with no
    credit card.
- **Consequences**:
  - All data access becomes async (`Promise`-returning). This is a mechanical change across
    `db/`, `refresh/`, `routes/` and the tests.
  - **Interactive transactions time out after 5 s** and send each statement as its own round
    trip. So a source refresh is collected in memory and written with **one
    `batch(statements, 'write')`**. A batch runs in one implicit transaction and is rolled back
    entirely if any statement fails, which satisfies FR-010.
  - **Without a transaction around them, reading the movies and storing a refresh can interleave.**
    Two sources listing a new film at once would each create it, and the duplicates would last.
    `refreshSource` therefore runs read-match-store one source at a time within a process
    (`Repository.reserveTurn`), while fetching stays parallel. The turn is reserved before fetching,
    so sources store in a fixed order: the first listing of a film sets its id and matching details,
    and an order set by network timing split films in some runs. A manual run overlapping the cron run
    on another function instance isn't covered. That is rare, and any duplicates it creates are
    removed with the film, 30 days after its last screening.
  - **Foreign-key enforcement is off by default** in Turso, and a per-connection
    `PRAGMA foreign_keys` doesn't survive across remote requests. So the code must not rely on
    `ON DELETE CASCADE`. `deleteStaleMovies` deletes the dependent `movie_keys` and
    `match_reviews` rows itself, in the same batch.
  - **Turso rejects writing `PRAGMA user_version`** ("SQL not allowed statement"), though it
    can be read. The first preview deploy (2026-11-01) showed this. Applied migrations are
    therefore recorded in a `schema_migrations` table, written in the same batch as the
    migration. Databases migrated before that table existed still report their version through
    `user_version`, so self-hosted copies are not migrated twice.
- **Ways to get a free database** (FR-011):
  1. `vercel integration add tursocloud` (Vercel Marketplace, "Vercel Native"), choosing the free
     `starter` plan. It sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` on the project.
  2. If (1) asks for a paid plan or a card on a Hobby team, sign up at turso.tech instead (free,
     no card) and add the two variables with `vercel env add`.

  Either way, create **two** databases: `seansai` for Production and `seansai-preview` for
  Preview. Otherwise a preview of a branch with a new migration would change production's schema
  before the merge. Free allows up to 100 databases.
- **Alternatives considered**:
  - Neon Postgres (free): rewrite the schema and queries for Postgres. More work, no benefit for
    about 3,000 rows.
  - A database snapshot in Vercel Blob, loaded into memory: least code change, but the free plan
    has only 10,000 simple operations a month, and Blob is blocked for 30 days if a limit is
    exceeded. The owner chose Turso.
  - Memory only: each function copy would start empty and fetch from cinemas on every cold start.
    That breaks politeness (FR-007).
  - `@tursodatabase/sync` (local file with push/pull): newer and less proven, and still async.
    No advantage at this size.

## 3. Refresh scheduling on Hobby

> **Superseded on 2026-11-02**: no Vercel Cron Job runs now. Refreshing moved to a machine at home
> ([§5](#5-keeping-usage-free-sc-002-sc-005)). The route below remains as a fallback.

- **Decision**:
  - Vercel Cron Job `{ "path": "/api/v1/cron/daily", "schedule": "0 22 * * *" }` (top-level
    `crons`), calling a route that refreshes every enabled source **in parallel** and then runs
    the cleanup.
  - The route answers only to `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends exactly
    this when `CRON_SECRET` is set.
  - Anything else gets the standard 404 `not_found` body (FR-008).
  - The in-process scheduler still runs in Docker and local development (FR-015).
- **Hobby facts**:
  - Cron jobs run at most once a day. A schedule that runs more often fails the deployment.
  - A job fires anywhere within its hour.
  - Up to 100 cron jobs per project, included in the plan.
  - Cron jobs run only on the production deployment, which meets FR-014's "only production
    refreshes".
- **Timing**: `0 22 * * *` UTC fires between 22:00 and 22:59 UTC. That is 00:00–00:59 Vilnius in
  winter (UTC+2) and 01:00–01:59 in summer (UTC+3), inside FR-004's 00:00–02:00 window.
- **Duration**:
  - Hobby functions run for at most **300 s**.
  - Sources are refreshed in parallel. The longest is a Fliko site or Forum: about 9–12 pages at
    ≥ 500 ms apart, so roughly 10–30 s.
  - The worst case is one source timing out at 15 s on each of its 12 pages: 180 s, plus the store
    time of the sources behind it, since sources store in turn. Still under the limit, though remote
    store time is unmeasured until the first production run.
  - Measured on the first manual refresh (quickstart §4).
- **Risk**: the services documentation doesn't mention `crons`. The configuration reference lists
  no per-service cron key, so a top-level `crons` entry routed through the public rewrites is the
  expected setup. **Fallback if a deploy rejects `crons` in services mode**: a scheduled GitHub
  Actions workflow calls the same URL with the secret. The repository is public, so Actions
  minutes are free.
- **Alternatives considered**:
  - Hourly cron: needs Pro.
  - Refresh on visitor traffic: breaks FR-007.
  - External cron services: an extra account, no benefit over the fallback.

## 4. Staleness on the hosted deployment

> **Superseded on 2026-11-02**: the threshold is now 48 h, because the run's time of day can move.

- **Decision**: `staleAfterMs` is 27 h when refreshing by cron and 3 h otherwise (FR-006, FR-015).
  It's passed from config to `deriveSourceStatus`, `Queries.freshness` and `/health`.
- **Rationale**: the run may start anywhere in its hour, plus up to about 5 min of run time. With
  daylight-saving changes, the gap between two successful runs can reach about 25 h. 27 h
  leaves margin while still flagging a single missed night the next morning.

## 5. Keeping usage free (SC-002, SC-005)

The local live database holds 226 movies, 2,399 screenings and 429 movie keys: 1.16 MB after
`VACUUM`. The expected load from feature 001 is 1,000 visitors a day, peaking at 100 at once.
Assume per visitor: 2 movie-list loads plus 3 movie pages (detail and screenings), so about 8 API
calls.

| Allowance (free)                       | Estimate at expected load                                                    | Share  |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Turso rows read, 500 M/mo              | Without CDN: movie list ≈ 5 k rows scanned × 2 per visitor → ~315 M/mo       | 63 % ✗ |
|                                        | With CDN caching of list responses (5 min) → misses bounded per URL: < 80 M | < 16 % |
| Turso rows written, 10 M/mo            | ~6 k per daily run (delete + upsert) → ~0.2 M                                | 2 %    |
| Turso storage, 5 GB                    | ~1–5 MB                                                                      | < 1 %  |
| Vercel function invocations, 1 M/mo    | ≤ 8 × 1,000 × 30 = 240 k without CDN; less with it                           | ≤ 24 % |
| Vercel Active CPU, 4 h/mo              | API ~10 ms × 240 k ≈ 40 min; daily refresh ≈ 1 min CPU × 30 ≈ 30 min         | ~30 %  |
| Vercel Provisioned Memory, 360 GB-h/mo | ~100 ms wall × 240 k × 2 GB ≈ 13 GB-h, plus cron ≈ 2 GB-h                    | ~4 %   |
| Vercel Fast Origin Transfer, 10 GB/mo  | ~10 KB compressed × 240 k ≈ 2.4 GB without CDN                               | ≤ 24 % |
| Vercel Fast Data Transfer, 100 GB/mo   | pages + JSON ≈ 0.5 MB × 1,000 × 30 ≈ 15 GB                                   | 15 %   |

- **Decision**: let Vercel's CDN cache the list endpoints:
  - `/cities`, `/movies`, `/movies/:id` and `/movies/:id/screenings` change from
    `Cache-Control: public, max-age=300` to `public, max-age=300, s-maxage=300`.
  - The CDN caches function responses only with `s-maxage`. It removes `s-maxage` before the
    browser, which still caches for 5 minutes as today.
  - Self-hosted, the extra directive has no effect.
  - Without this, Turso reads would break SC-005's 50% ceiling.
- **Decision**: remove the N+1 query in `Queries.freshness` and `/health`, which call
  `getSource` once per source. Read all sources with one `listSources()` call instead. On a remote
  database every query is a round trip (Constitution VI).
- **When over a limit**: Hobby features stop for the rest of the month rather than charging. The
  Turso integration is the Free plan with no payment method, so there's nothing to bill.
  Providers email warnings near their limits.
- **Commercial use**: Hobby is for non-commercial personal use only, and Seansai qualifies. Ads,
  affiliate links or payments would require a paid plan.
- **Measured on the first preview** (2026-11-01; function in `fra1`, Turso Free in `dub1`, the
  nearest EU region the integration offers; 50 uncached `GET /api/v1/movies?city=all`, 11 sources
  of live data):
  - Server time (Fastify `responseTime` in Runtime Logs): p50 63 ms, p95 136 ms, max 183 ms.
    Within Constitution VI's 300 ms.
  - Time to first byte from Lithuania (`curl`, through the CDN with a unique query): p50 0.20 s,
    48th of 50 0.34 s, with a 0.03 s connect time; the rest is TLS and the edge.
  - A repeated request is served by the CDN (`x-vercel-cache: HIT`); the browser receives
    `public, max-age=300`.
- **Measured after idling** (2026-11-01, one sample of each):
  - After 61 minutes with no requests to the deployment or the database: the first uncached list
    request took 2.35 s to first byte from a laptop in Lithuania, of which 122 ms on the server. The
    next two took 0.32 s and 0.20 s. Almost all of a cold start is therefore start-up, not the query.
    This is the API call alone; the phone also loads the page first.
  - Phone, cold start after 24 minutes idle: the owner saw the list in under 3 s (not timed).
  - One cold start after about 36 minutes idle took 1,948 ms on the server, on the previous
    deployment. The cause is unknown and the 61-minute run did not repeat it. Together with the
    start-up above it would exceed 3 s, so SC-004's idle case has little margin. Re-check on
    production.
  - Every cold start logged `Refresh runs from Vercel Cron; scheduler not started`, and none
    refreshed a source (SC-006).
- **Measured on production** (2026-11-01 and 02): the first refresh took 93 s, under the 300 s limit.
  Nine of 11 sources succeeded. Pasaka and Cinamon answered HTTP 403 on both runs, though the same
  requests work from a home connection, so their four cinemas have no data. Both sites sit behind
  Cloudflare, and a rule against datacentre networks is the likely cause, not yet confirmed. The
  preview could not show this, as its data was fetched from a laptop. Per the no-circumvention
  rule, nothing works around it. Refused requests now log their headers and the start of the body. Hobby keeps logs for an hour, so
  read them within the hour of a run: `sources.last_error` holds only `HTTP 403`.
- **Refreshing from home** (2026-11-02, owner decision): to treat all venues the same, every source
  now refreshes from the owner's Mac, and Vercel only serves the site. The job checks hourly and runs on
  the first check of each Vilnius day. The first run from there
  took 50 s with all 11 sources succeeding. Alternatives measured: a browser can read only 5 of 11
  sources (the rest send no cross-site permission), and a paid proxy disguises where requests come
  from. The no-circumvention rule is still met in its wording: one fixed address and honest
  identification, stopping if refused. It does route around these cinemas' refusal of Vercel,
  which the owner accepted.
- **Retrying failed sources** (2026-11-03): the first automatic run, at 00:20, started during one of
  the Mac's maintenance wakes. `pmset -g log` shows it asleep again 27 s later, and awake at 00:38.
  Atlantis, Garsas, Spindulys and Minija, which crawl 35 to 50 film pages each (about 50 s), failed on
  waking, and the one-attempt-a-day rule left them out of date all day. The sites were fine: the same
  crawl with the Mac awake had no fetch errors. Later checks now retry what failed, within the hourly
  limit for every source. Refusals aren't retried, and a source that keeps failing for another reason
  is tried hourly until the next day's refresh. Only the error message is stored, so telling them apart
  reads its start, which saved a migration. Overnight, retries can be cut short the same way until
  the Mac is next properly awake.
- **Timing tests on CI** (2026-11-01, owner decision): GitHub's machines vary by about 1.7× in
  throughput. `performance.spec.ts` allows 2.5 s on CI and 2 s elsewhere, because its throttling
  comes on top of the machine's own speed. The target stays 2 s (SC-002): CI catches real slowdowns,
  and the real site is checked on production (T047). The load test sends a steady 200 requests/s
  (owner decision), each timed from when it was due, so a server falling behind shows as latency.
  Sending as fast as answered measured the machine, with p95 from 169 to 371 ms on identical code.
  It uses its own paced sender because autocannon's rate setting fires each second's requests at once.

## 6. Region and latency (SC-004)

- **Decision**:
  - `"regions": ["fra1"]` (Frankfurt) at the top level of `vercel.json`. Hobby allows a single
    region, and the default `iad1` is in the US.
  - The Turso database goes in the EU region closest to Frankfurt. The integration offers no
    Frankfurt region, so it is `dub1` (Dublin).
- **Rationale**: visitors are in Lithuania. Function and database in neighbouring EU regions keep
  each query short (measured server p95 136 ms, §5). A cold start adds Node start-up, one migration
  check and the queries.
- **Risk**: `regions` validity in services mode is unconfirmed. It isn't in the list of keys
  services mode forbids at the top level. **Fallback**: set the region in the project settings
  (Settings → Functions → Function Regions).

## 7. Observability on Hobby

- Runtime logs are kept for **1 hour** on Hobby, so a failure in the nightly run is gone by
  morning.
- **Decision**:
  - Each source's last error and last success are already stored in the `sources` table and shown
    by `GET /api/v1/health`. That's the lasting record.
  - The cron route also returns a per-source summary, which Vercel shows for manual runs.
  - No log drain, since that's a paid add-on.

## 8. Migration of existing data

Out of scope (spec Assumptions). Migrations create the schema on Turso the first time a function
copy starts. The maintainer then triggers one refresh by hand (quickstart §4).
