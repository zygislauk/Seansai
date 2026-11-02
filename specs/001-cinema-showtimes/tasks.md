---

description: "Task list for the Cinema Showtimes Aggregator (Seansai)"
---

# Tasks: Cinema Showtimes Aggregator

**Input**: Design documents from `/specs/001-cinema-showtimes/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. The constitution (Principle IV, NON-NEGOTIABLE) requires automated tests for
every feature: unit tests for logic, integration tests for boundaries, end-to-end tests per user
story. Within each story, write the tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested and
demoed on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: User story the task belongs to (US1, US2, US3)
- Every task names the exact file(s) it creates or changes

## Path Conventions

npm workspaces monorepo (see [plan.md → Project Structure](./plan.md#project-structure)):

- `packages/shared/src/` — API contract schemas shared by API and web
- `apps/api/src/`, `apps/api/tests/` — Node.js + Fastify backend
- `apps/web/src/`, `apps/web/tests/` — React + Vite frontend

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo, toolchain and quality gates

- [X] T001 Create root `package.json` with npm workspaces `["apps/*", "packages/*"]`, `"engines": { "node": ">=24" }`, and scripts `dev`, `build`, `lint`, `format`, `format:check`, `typecheck`, `test`, `test:load`, `test:e2e`, `sources:check`, `fixtures:capture` delegating to workspaces; add `.nvmrc` containing `24`
- [X] T002 [P] Create `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `module`/`moduleResolution` `"NodeNext"`/`"Bundler"` as appropriate per workspace, `target: "ES2023"`
- [X] T003 [P] Create `eslint.config.js` (flat config: `typescript-eslint` strict-type-checked, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `eslint-config-prettier`), `.prettierrc` (`singleQuote: true`, `printWidth: 100`, `trailingComma: "all"`) and `.prettierignore` (`dist`, `coverage`, `playwright-report`, `apps/api/tests/fixtures`)
- [X] T004 [P] Scaffold `packages/shared` with `packages/shared/package.json` (name `@seansai/shared`, dependency `zod`), `packages/shared/tsconfig.json` and `packages/shared/src/index.ts`
- [X] T005 [P] Scaffold `apps/api` with `apps/api/package.json` (dependencies `fastify`, `@fastify/static`, `@fastify/etag`, `zod`, `better-sqlite3`, `fast-xml-parser`, `cheerio`, `pino`, `@seansai/shared`; dev `vitest`, `autocannon`, `@types/better-sqlite3`), `apps/api/tsconfig.json`, `apps/api/vitest.config.ts` (excludes `tests/load/`) and `apps/api/vitest.load.config.ts`; scripts `dev` (`node --watch src/main.ts`), `start` (`node src/main.ts`), `typecheck`, `test`, `test:load`, `sources:check`, `fixtures:capture`. The API and `@seansai/shared` run as TypeScript source through Node 24's built-in type stripping, so there is no `tsx` and no API build step (`erasableSyntaxOnly` in `tsconfig.base.json` keeps the code strippable)
- [X] T006 [P] Scaffold `apps/web` with Vite React TypeScript: `apps/web/package.json` (dependencies `react@19`, `react-dom@19`, `react-router`, `@tanstack/react-query`, `@seansai/shared`; dev `vite`, `@vitejs/plugin-react`, `sass`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`), `apps/web/index.html` (`<html lang="lt">`), `apps/web/vite.config.ts` (proxy `/api` → `http://localhost:3000`), `apps/web/tsconfig.json`, `apps/web/vitest.config.ts` (jsdom, setup file `apps/web/tests/setup.ts`)
- [X] T007 [P] Add Playwright with `apps/web/playwright.config.ts` (baseURL `http://localhost:5173`, `webServer` runs `SOURCES_MODE=fixtures npm run dev` from repo root, projects: desktop Chromium + Pixel 7 mobile) and dev dependencies `@playwright/test`, `@axe-core/playwright`
- [X] T008 [P] Create CI workflow `.github/workflows/ci.yml` on push/PR: Node 24, `npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm audit --omit=dev --audit-level=critical` (fails the build on known critical vulnerabilities, constitution Quality Standards), `npm test`, `npm run test:load`, `npm run build`, `npx playwright install --with-deps chromium`, `npm run test:e2e`
- [X] T009 [P] Extend `.gitignore` with `apps/api/data/`, `*.sqlite`, `playwright-report/`, `test-results/`, `dist/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contracts, storage, refresh pipeline, matching and the web app shell that every story
depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Shared contracts

- [X] T010 [P] Define zod schemas and inferred types in `packages/shared/src/api.ts` exactly as in [contracts/public-api.md](./contracts/public-api.md): `Freshness`, `MovieSummary`, `Screening` (`format: "IMAX" | "4DX" | "ScreenX" | "other" | null`), `CitiesResponse`, `MoviesResponse` (items `{ movie, screeningsToday, firstDate }`), `MovieDetailResponse` (`screeningDates`, `availableDates`), `ScreeningsResponse` (`date`, `screenings`, `nextDateWithScreenings`, `freshness`), `ErrorResponse` with codes `invalid_city` · `invalid_date` · `movie_not_found` · `internal_error`; re-export from `packages/shared/src/index.ts`

### API foundations

- [X] T011 [P] Write unit tests in `apps/api/tests/unit/time.test.ts` for Europe/Vilnius helpers: `localDateOf(instant)` (23:30 and 00:30 local cases; a screening "starting after midnight belongs to the calendar date it starts on"), `instantFromLocal("2026-10-30", "13:30")` across the DST change on 2026-10-25, `todayIn(now)`
- [X] T012 [P] Implement the helpers in `apps/api/src/lib/time.ts` using `Intl.DateTimeFormat` with `timeZone: "Europe/Vilnius"` (no time-zone library) so T011 passes
- [X] T013 [P] Create `apps/api/src/config.ts` reading and validating env with zod: `PORT` (default 3000), `DB_PATH` (default `apps/api/data/seansai.sqlite`), `SOURCES_MODE` (`live` | `fixtures`, default `live`), `FIXTURE_NOW` (ISO instant), `FIXTURE_FAIL` (comma-separated source ids), `FIXTURE_<SOURCE>_LAST_SUCCESS_HOURS`, `SEANSAI_CONTACT` (email or the project's `https://` URL, required in `live`), `DISABLED_SOURCES` (comma-separated source ids — the kill switch from research.md §1b)
- [X] T014 [P] Create `apps/api/src/lib/logger.ts` exporting a pino logger (JSON in production, pretty in dev) with redaction of `req.headers.cookie` and `authorization`, plus custom `req`/`res` serializers that log only method, route, status code and response time — **never** `remoteAddress`, `remotePort`, `x-forwarded-for` or user-agent (no personal data in logs, constitution Quality Standards); unit test `apps/api/tests/unit/logger.test.ts` asserts a logged request line contains no IP address
- [X] T015 [P] Write unit tests in `apps/api/tests/unit/polite-http.test.ts` (mocked `fetch`): sends `User-Agent: Seansai/1.0 (+mailto:{SEANSAI_CONTACT})`, or `(+{SEANSAI_CONTACT})` when the contact is an `https://` URL; waits ≥ 500 ms between requests to the same host; 15 s timeout; refuses URLs disallowed by robots.txt with `RobotsDisallowedError` unless the source has `robotsOverride: true` (then logs a warning once per cycle); throws `SourceBlockedError` on HTTP 401/403/429 or an HTML body containing a CAPTCHA marker, with **no retry**; caches robots.txt for 24 h
- [X] T016 Implement `PoliteHttpClient` in `apps/api/src/lib/polite-http.ts` (methods `getText(url)`, `getJson(url, schema)`) and error classes in `apps/api/src/lib/errors.ts` so T015 passes; never sets spoofed browser headers, never rotates IPs, never solves CAPTCHAs (research.md §1b)

### Registry (cities and cinemas)

- [X] T017 [P] Create `apps/api/src/registry/cities.ts` with City records `{ id, nameLt, nameEn }` for `vilnius` (Vilnius), `kaunas` (Kaunas), `klaipeda` (Klaipėda/Klaipeda), `siauliai` (Šiauliai/Siauliai), `panevezys` (Panevėžys/Panevezys), `marijampole` (Marijampolė/Marijampole), `gargzdai` (Gargždai/Gargzdai); "`id` … unique"
- [X] T018 Create `apps/api/src/registry/cinemas.ts` with Cinema records `{ id, name, chain, cityId, address, websiteUrl, sourceId, sourceVenueKeys }` ("The registry, not the feed, decides the city"): `apollo-akropolis` (Vilnius, MCS area `1019`), `apollo-outlet` (Vilnius, area `1024`), `apollo-molas` (Panevėžys, area `1018`); `forum-vingis` (**Vilnius**, cinemaId `f933f355-2e6b-466f-9b97-e267ecd8e266` — the feed wrongly says Kaunas), `forum-kaunas` (`b4662f38-8b50-4533-9eb8-c26ae4394a78`), `forum-klaipeda` (`40025d9f-a5cd-4bb9-bd4b-d01c52558731`), `forum-siauliai` (`4c3fe3b1-90c1-4268-9c9f-d86e91cd2a44`); `pasaka-paupys` (area `1033`), `pasaka-senamiestis` (area `1034`), `pasaka-kalnu-parkas` (area `1042`, seasonal); `skalvija` (Vilnius); `atlantis` (Šiauliai); `garsas` (Panevėžys); `spindulys` (Marijampolė); `minija` (Gargždai); `romuva` (Kaunas); `vue-vilnius` (Vilnius, Vue cinema id `1001`); `cinamon-mega` (Kaunas, pid `77139293`). Export `CinemaRegistry` with `findBySourceKey(sourceId, key)`; `chain` enum `apollo · forum · pasaka · skalvija · atlantis · romuva · garsas · spindulys · minija · vue · cinamon`
- [X] T019 [P] Write unit test `apps/api/tests/unit/registry.test.ts`: every cinema's `cityId` exists in cities, ids are unique, every `(sourceId, sourceVenueKey)` pair is unique, `forum-vingis.cityId === "vilnius"`

### Storage

- [X] T020 Create `apps/api/src/db/schema.sql` and migration runner `apps/api/src/db/index.ts` (`openDb(path)` with WAL mode) with tables: `sources` (`id` TEXT PK, `last_attempt_at`, `last_success_at` nullable, `last_error` nullable); `movies` (`id` TEXT PK, `title` NOT NULL, `original_title`, `match_key` NOT NULL, `year` INTEGER, `duration_minutes`, `age_rating`, `genres` JSON, `poster_url`, `last_screening_at`; UNIQUE(`match_key`, `year`)); `screenings` (`id` TEXT PK = "`{sourceId}:{sourceScreeningId}`", `source_id`, `movie_id` FK, `cinema_id` NOT NULL, `starts_at` NOT NULL UTC, `local_date` NOT NULL, `hall`, `format` (values in data-model.md) or NULL, `spoken_language`, `subtitle_language`, `is_dubbed`, `ticket_url` NOT NULL, `source_title` NOT NULL, `refreshed_at` NOT NULL); `match_reviews` (`id` INTEGER PK, `match_key`, `movie_id_a`, `movie_id_b`, `reason`, `first_seen_at`, `resolution` CHECK IN (`merge`,`keep-separate`) or NULL); indexes on `screenings(local_date, cinema_id)` and `screenings(movie_id, local_date)`
- [X] T021 Write integration tests in `apps/api/tests/integration/repository.test.ts` (temp SQLite file): `replaceSourceScreenings` replaces only that source's future rows in one transaction ("A successful refresh replaces that source's future screenings, so cancelled screenings disappear"); `deletePastScreenings(today)`; `deleteStaleMovies(now)` removes movies "deleted after 30 days without screenings"
- [X] T022 Implement `apps/api/src/db/repository.ts` (`upsertMovie`, `replaceSourceScreenings`, `recordSourceAttempt`, `recordSourceSuccess`, `deletePastScreenings`, `deleteStaleMovies`, `insertMatchReview`) so T021 passes

### Source adapter framework

- [X] T023 [P] Create `apps/api/src/sources/types.ts` with `SourceAdapter`, `AdapterContext`, `AdapterResult` and the zod schema `SourceScreeningSchema` exactly as in [contracts/source-adapter.md](./contracts/source-adapter.md)
- [X] T024 [P] Create `apps/api/src/sources/fixture-http.ts`: a `PoliteHttpClient`-compatible fake that maps request URLs to files under `apps/api/tests/fixtures/{sourceId}/` via each fixture folder's `manifest.json` (`{ "url": "file" }`), and throws `SourceBlockedError` for sources listed in `FIXTURE_FAIL`
- [X] T025 Create `apps/api/scripts/capture-fixtures.ts` (`npm run fixtures:capture -- <sourceId>`): reads the URL list from `apps/api/tests/fixtures/{sourceId}/urls.json` (an array of absolute URLs, written by hand in T047; entries may use the placeholders `{today:dd.MM.yyyy}`, `{today:yyyy-MM-dd}` and `{today+14:yyyy-MM-dd}`), fetches each URL once through `PoliteHttpClient`, saves each response as a numbered file plus `manifest.json` (`{ "<resolved url>": "<file>" }`) in the same folder, and records the capture instant in `apps/api/tests/fixtures/README.md` (used as `FIXTURE_NOW`); for HTML list pages it does not follow links — every page needed is listed explicitly

### Movie matching (FR-005)

- [X] T026 [P] Write unit tests in `apps/api/tests/unit/normalize.test.ts`: lower-case, strip diacritics ("Kopa. Trečia dalis" → "kopa trecia dalis"), remove tags `IMAX`, `4DX`, `(LT sub.)`, `LT`, `ORG`, `dubliuotas`, remove punctuation, collapse spaces; Vue style "ABSOLIUTUS BLOGIS (Resident Evil)" yields original-title key "resident evil"
- [X] T027 [P] Implement `normalizeTitle` and `matchKeyOf({ title, originalTitle })` in `apps/api/src/matching/normalize.ts` so T026 passes
- [X] T028 [P] Write unit tests in `apps/api/tests/unit/match.test.ts`: "confident match when their match keys are equal and either their production years are equal, or one year is missing and durations differ by ≤ 10 minutes"; remake with different year stays separate and creates a MatchReview; "Kopa" vs "Kopa. Antra dalis" stay separate; alias file `merge` forces a merge and `keep-separate` suppresses the review
- [X] T029 Implement `resolveMovie(listing, existingMovies, aliases)` in `apps/api/src/matching/match.ts` and the empty alias file `apps/api/src/matching/aliases.json` (`[{ "matchKey", "movieIdA", "movieIdB", "resolution" }]`) so T028 passes; movie `id` is a stable slug of match key + year (e.g. `digger-2026`)

### Refresh pipeline

- [X] T030 [P] Write unit tests in `apps/api/tests/unit/source-status.test.ts`: `healthy` after success; `degraded` after a failure with `lastSuccessAt` < 3 h ago; `stale` when no success for ≥ 3 h; a new source starts as `stale`
- [X] T031 [P] Implement `deriveSourceStatus(source, now)` in `apps/api/src/refresh/status.ts` so T030 passes
- [X] T032 Write integration test `apps/api/tests/integration/refresh.test.ts` with a stub adapter: valid result is matched and stored and marks success; result failing `SourceScreeningSchema` or a thrown error keeps the previous data and records `last_error`; items whose cinema is not in the registry are dropped and logged ("A screening is stored only if it has a title, a cinema that exists in the registry, and a valid start time"); sources in `DISABLED_SOURCES` are skipped
- [X] T033 Implement `refreshSource(adapter, ctx)` in `apps/api/src/refresh/refresh-source.ts` (run adapter → validate each item → `resolveMovie` → `replaceSourceScreenings` → update source status; log counts of stored/skipped items and new match reviews) so T032 passes
- [X] T034 Implement `startScheduler(adapters)` in `apps/api/src/refresh/scheduler.ts`: run every source once at startup, then every 60 min ± 5 min random jitter per source, independently (one failing source never blocks others); daily at 04:00 Vilnius run `deletePastScreenings` and `deleteStaleMovies`; no-op scheduling in `SOURCES_MODE=fixtures` except the startup run
- [X] T035 Create `apps/api/src/sources/index.ts` exporting the list of configured adapters with per-source options `{ id, enabled, robotsOverride, overrideReason }`; `vue` and `cinamon` set `robotsOverride: true` with reason "Owner decision 2026-10-30, see research.md §1b"; log every override at startup

### HTTP server

- [X] T036 Implement `buildServer({ db, now })` in `apps/api/src/server.ts`: Fastify using the logger and serializers from T014 (do not enable Fastify's default request serializers), `/api/v1` prefix, zod-validated query params returning `400` `ErrorResponse`, error handler that maps unknown errors to `500 internal_error` without leaking details, `Cache-Control: public, max-age=300` + ETag on list responses, `@fastify/static` serving `apps/web/dist` with SPA fallback to `index.html` in production
- [X] T037 [P] Implement `GET /api/v1/health` in `apps/api/src/routes/health.ts` returning `{ status, sources: [{ id, status, lastSuccessAt }] }` and its test in `apps/api/tests/integration/health.test.ts`
- [X] T038 Create `apps/api/src/main.ts`: load config, open DB, run migrations, build server, start scheduler with live or fixture HTTP client per `SOURCES_MODE`, graceful shutdown on SIGTERM

### Web app shell

- [X] T039 [P] Create design tokens and global styles: `apps/web/src/styles/_tokens.scss` (colour, spacing, radius, font-size scales; light and dark via `prefers-color-scheme`; text contrast ≥ 4.5:1), `apps/web/src/styles/_breakpoints.scss` (mobile-first mixins at 480/768/1024 px), `apps/web/src/styles/global.scss` (reset, visible `:focus-visible` outline, `prefers-reduced-motion`)
- [X] T040 [P] Create i18n in `apps/web/src/i18n/lt.ts` (source of truth, typed `Messages`), `apps/web/src/i18n/en.ts` (must satisfy `Messages`), `apps/web/src/i18n/index.tsx` (`I18nProvider`, `useT()`, `formatTime`, `formatDate` with `Intl.DateTimeFormat` in `Europe/Vilnius`, `plural()` via `Intl.PluralRules` for Lithuanian's three forms)
- [X] T041 [P] Write unit test `apps/web/tests/unit/i18n.test.ts`: `en` has every key of `lt`; Lithuanian plurals for 1, 2, 10, 21 screenings ("1 seansas", "2 seansai", "10 seansų", "21 seansas")
- [X] T042 [P] Create safe storage wrapper `apps/web/src/storage/settings.ts` (`getCity`, `setCity`, `getLang`, `setLang` for keys `seansai.city` and `seansai.lang`, every access wrapped in try/catch, works when storage is unavailable) and test `apps/web/tests/unit/settings.test.ts`
- [X] T043 Create typed API client `apps/web/src/api/client.ts` (`getCities`, `getMovies(city)`, `getMovie(id, city)`, `getScreenings(id, city, date)`; parses every response with the `@seansai/shared` schemas; throws `ApiError` with the `ErrorResponse` code) and query hooks in `apps/web/src/api/hooks.ts` (TanStack Query, `staleTime` 5 min)
- [X] T044 Create router and providers in `apps/web/src/app/router.tsx` and `apps/web/src/app/providers.tsx` per [contracts/web-routes.md](./contracts/web-routes.md): `/` redirects to `/{remembered lang or "lt"}/`; `/:lang/` and `/:lang/movie/:movieId` (unknown `lang` → redirect to `/lt/…`); `*` → NotFoundPage; update `<html lang>` on language change; entry in `apps/web/src/main.tsx`
- [X] T045 [P] Create atoms with SCSS Modules in `apps/web/src/components/atoms/`: `Button/`, `Spinner/` (with visually hidden label), `Icon/`, `Badge/`, `Poster/` (fixed 2:3 aspect ratio, `loading="lazy"`, explicit width/height, placeholder image on error or null URL), `VisuallyHidden/`
- [X] T046 Create template `apps/web/src/components/templates/PageLayout/PageLayout.tsx` + `.module.scss`: header with site name, language switch LT/EN (changes `/{lang}/` path and saves `seansai.lang`, FR-017), main landmark, footer slot for "last updated"

**Checkpoint**: Foundation ready — `npm test` passes, the API starts with an empty database, the web
shell renders in both languages.

---

## Phase 3: User Story 1 — See today's screenings of a movie across all cinemas (Priority: P1) 🎯 MVP

**Goal**: Pick a city once, see the currently showing movies, pick one, and see all of today's
remaining screenings across all supported cinemas in that city on one timeline, with buy-ticket
links.

**Independent Test**: With `SOURCES_MODE=fixtures`, open the site, choose Vilnius, select a movie
and confirm today's timeline matches the fixture schedules of every Vilnius cinema
([quickstart.md → US1](./quickstart.md#us1--todays-screenings-across-cinemas-p1)).

### Tests for User Story 1 ⚠️ (write first, confirm they fail)

- [X] T047 [US1] *(Ten sources captured on 2026-10-30, Forum on 2026-10-31. Forum's API answered robots.txt with HTTP 500 only because Node's `fetch` sends `Accept-Language: *`; with `Accept-Language: lt` (now sent by `PoliteHttpClient`) it answers 404, i.e. no restrictions. Forum's list adds `/movie` and `/cinema/{id}/screen` (see T061). Since the captures span two days, fixture mode now runs on the earliest capture instant and each adapter replays its own capture instant. Fliko sites capture the list plus 8 movie pages each; `cinamon-mode: page-state`.)* Write `urls.json` for each source and capture fixtures with `npm run fixtures:capture -- <sourceId>` into `apps/api/tests/fixtures/<sourceId>/`. URL lists:
  - `apollo`: `https://www.apollokinas.lt/xml/TheatreAreas/`, `https://www.apollokinas.lt/xml/Schedule/?area={1019,1024,1018}&dt={today:dd.MM.yyyy}&nrOfDays=14` (one URL per area)
  - `pasaka`: `https://bilietai.kinopasaka.lt/xml/TheatreAreas/`, `https://bilietai.kinopasaka.lt/xml/Schedule/?area={1033,1034,1042}&dt={today:dd.MM.yyyy}&nrOfDays=14`
  - `forum`: `https://restapi.forumcinemas.lt/api/region`, `https://restapi.forumcinemas.lt/api/region/{regionId}/screening?dateTimeFrom={today:yyyy-MM-dd}T00:00:00&dateTimeTo={today+14:yyyy-MM-dd}T00:00:00` for each region id in the `/region` response, then `https://restapi.forumcinemas.lt/api/movie/{movieId}` for each distinct `movieId` (capture in two passes: regions first, then fill in movie URLs from the saved screening files)
  - `skalvija`: `https://skalvija.lt/wp-json/data/v1/get_shows`
  - `atlantis`, `garsas`, `spindulys`, `minija`: `{base}/filmai` plus every `/filmai/{slug}` linked from it (two passes, as for Forum), bases `https://atlantiscinemas.lt`, `https://bilietai.garsas.lt`, `https://spinduliokinas.lt`, `https://gargzdukinas.lt`
  - `romuva`: `https://bilietai.kcromuva.lt/`
  - `vue`: `https://vuekinas.lt/data/filmswithshowings/1001`
  - `cinamon`: **go/no-go check first** — request `https://cinamonkino.com/api/page/home?cinema_id=77139293&timezone=Europe/Vilnius&locale=lt`; record the outcome in `apps/api/tests/fixtures/README.md` as `cinamon-mode: api` (JSON with sessions for more than one date), or `cinamon-mode: page-state` (fallback: capture `https://cinamonkino.com/mega/lt`, today only), or `cinamon-mode: disabled` (neither works; set `enabled: false` for `cinamon` in `apps/api/src/sources/index.ts` and skip T054/T066)
- [X] T048 [P] [US1] Contract test `apps/api/tests/contract/mcs.test.ts`: Apollo JSON and Pasaka XML fixtures produce `SourceScreening[]` with instants from `dttmShowStartUTC`, calendar date from the Vilnius start time (not `dtAccounting`), `ticketUrl` = `ShowURL`, format from `PresentationMethod`, languages from `SpokenLanguage`/`SubtitleLanguage1` ISO codes, venue resolved via area id
- [X] T049 [P] [US1] Contract test `apps/api/tests/contract/forum.test.ts`: screenings from `/region/{id}/screening` joined with `/movie/{id}`; `screeningTimeFrom` offset respected; `printType` → format; `speakingType`/`language`/`subtitles` → languages and `isDubbed`; title/originalTitle/yearOfProduction/duration/posters mapped; Vingis resolves to `forum-vingis` (Vilnius). *Also:* hall names, the ticket link the site uses (`https://forumcinemas.lt/lt/ekranas/?id=…&cid=…`), programme labels and "(dubliuotas)" notes dropped from titles, unknown "OR" language, a missing movie skipped, the once-a-day hall cache
- [X] T050 [P] [US1] Contract test `apps/api/tests/contract/skalvija.test.ts`: body with leading PHP warning HTML still parses; `start_date` Unix seconds → instant; `title[0]` used; generic "Repertuarinis seansas" kept as its own title; `ticketUrl` = `url`. *Implemented differently:* the captured data showed that a show's `title[]` is its programme ("Repertuarinis seansas", "Scanorama"), so the film title, original title, poster and infoline (rating, language, subtitles, year, duration) come from `events[eventid]`; `title[0]` is only the fallback when the event is missing
- [X] T051 [P] [US1] Contract test `apps/api/tests/contract/fliko.test.ts`: Atlantis and Garsas fixtures (`/filmai` list + `/filmai/{slug}` pages) produce screenings per `<time datetime="YYYY-MM-DD">` date header and `HH:MM` time, `ticketUrl` absolute `https://{host}/kasa/seansas/{id}`, duration from "NN min"; no request to any `back.*` host
- [X] T052 [P] [US1] Contract test `apps/api/tests/contract/romuva.test.ts`: JSON array embedded in `fullCalendar({ events: [...] })` is extracted; `start` "YYYY-MM-DD HH:MM" parsed as Vilnius local time; `ticketUrl` = `url`
- [X] T053 [P] [US1] Contract test `apps/api/tests/contract/vue.test.ts`: `/data/filmswithshowings/1001` fixture; `showings[].times[]` parsed from `date_time` + `time` as Vilnius local time **ignoring the `Z` suffix** (fixture `"time": "13:30"` → 13:30 local); `screen_type` → format; `screen_number` → hall "N salė"; `ticketUrl` = `https://vuekinas.lt` + `link`; `title_orginal` → originalTitle; `info_runningtime` "90 min." → 90
- [X] T054 [P] [US1] Contract test `apps/api/tests/contract/cinamon.test.ts`: sessions with `showtime` "YYYY-MM-DD HH:MM:SS" parsed as Vilnius local time, `screen_name` → hall, film title/original/runtime mapped, ticket URL built from the session `pid` as the site does (verify the URL pattern from the captured fixture). *Implemented as:* the captured data has no per-session link (the site opens sessions in its script), so the ticket link is the Mega schedule page `https://cinamonkino.com/mega/repertuaras/lt` (FR-009 fallback); the page API holds only today's sessions, so the mode is `page-state` with `limitations: ["today-only"]`
- [X] T055 [P] [US1] Integration test `apps/api/tests/integration/cities.test.ts`: `GET /api/v1/cities` returns only cities with ≥ 1 cinema, with `cinemaCount`, names in `lang`
- [X] T056 [P] [US1] Integration test `apps/api/tests/integration/movies.test.ts`: `GET /api/v1/movies?city=vilnius` ordering — "Movies with remaining screenings today MUST come first, ordered by their number of screenings today (most first, ties by title); movies that start on later dates MUST follow, ordered by their first screening date and labelled with that date"; `city=all` covers every city; unknown city → `400 invalid_city`; response includes `freshness` with `staleCinemas`
- [X] T057 [P] [US1] Integration test `apps/api/tests/integration/screenings.test.ts`: `GET /api/v1/movies/{id}/screenings?city=vilnius&date={today}` returns one timeline sorted by `startsAt`, ties by cinema name; excludes screenings that already started (FR-007); empty day returns `nextDateWithScreenings`; unknown movie → `404 movie_not_found`; `GET /api/v1/movies/{id}?city=…` returns movie details plus `screeningDates` and `availableDates`
- [X] T058 [P] [US1] Component tests `apps/web/tests/unit/ScreeningTimeline.test.tsx` (rows in time order, each row shows cinema, city, time, hall/format/language when present; "Buy ticket" link has `target="_blank"` and `rel="noopener noreferrer"`), `apps/web/tests/unit/CityPrompt.test.tsx` (shown when no city saved, includes "All of Lithuania", saves choice), `apps/web/tests/unit/MovieGrid.test.tsx` (order preserved, later-date movies labelled with first date, search filters by Lithuanian or original title)
- [X] T059 [P] [US1] End-to-end test `apps/web/tests/e2e/us1-today.spec.ts` covering quickstart US1 steps 1–5, plus an axe scan with zero WCAG 2.1 AA violations on the movie list and movie page

### Implementation for User Story 1

- [X] T060 [P] [US1] Implement MCS adapter in `apps/api/src/sources/mcs/adapter.ts` (`createMcsAdapter({ id, baseUrl, areaIds })`; requests `xml/Schedule/?area={id}&dt={dd.MM.yyyy}&nrOfDays=14`; JSON or XML via `fast-xml-parser`) and register `apollo` (`https://www.apollokinas.lt/xml/`) and `pasaka` (`https://bilietai.kinopasaka.lt/xml/`) so T048 passes
- [X] T061 [P] [US1] Implement Forum adapter in `apps/api/src/sources/forum/adapter.ts` (base `https://restapi.forumcinemas.lt/api`; `/region`, `/region/{id}/screening?dateTimeFrom&dateTimeTo` for 14 days, `/movie/{id}` once per distinct movie per cycle) so T049 passes *Implemented with* one `/movie` list request per cycle plus `/movie/{id}` only for movies missing from it (2 requests instead of 121), and hall names from `/cinema/{id}/screen` at most once a day; registered in `apps/api/src/sources/index.ts`. Matching all fixtures together (`matching-fixtures.test.ts`) then showed the Scanorama label splitting films across cinemas ("SCA26:", "SCA:", "Rozė | Scanorama"), now ignored by the match keys, and two Scanorama films whose year differs by one between Forum and Skalvija, merged in `apps/api/src/matching/aliases.json`
- [X] T062 [P] [US1] Implement Skalvija adapter in `apps/api/src/sources/skalvija/adapter.ts` (`https://skalvija.lt/wp-json/data/v1/get_shows`; strip everything before the first `{`/`[`) so T050 passes
- [X] T063 [P] [US1] Implement Fliko adapter in `apps/api/src/sources/fliko/adapter.ts` (`createFlikoAdapter({ id, baseUrl, cinemaId })` with cheerio over `/filmai` and `/filmai/{slug}`) and register `atlantis` (`https://atlantiscinemas.lt`), `garsas` (`https://bilietai.garsas.lt`), `spindulys` (`https://spinduliokinas.lt`), `minija` (`https://gargzdukinas.lt`) so T051 passes
- [X] T064 [P] [US1] Implement Romuva adapter in `apps/api/src/sources/romuva/adapter.ts` (`https://bilietai.kcromuva.lt/`, extract the `events: [...]` JSON array) so T052 passes
- [X] T065 [P] [US1] Implement Vue adapter in `apps/api/src/sources/vue/adapter.ts` (`https://vuekinas.lt/data/filmswithshowings/1001`, `robotsOverride: true`; on any `SourceBlockedError` stop for this cycle) so T053 passes
- [X] T066 [P] [US1] Implement Cinamon adapter in `apps/api/src/sources/cinamon/adapter.ts` (`robotsOverride: true`; implements the mode recorded in T047: `api` → all published dates from the page API; `page-state` → today's sessions only from the `/mega/lt` page state, parsed without executing site JavaScript, with `limitations: ["today-only"]` exported from the adapter so `sources:check` and quickstart treat Cinamon's missing future dates as a known limitation, not a failure; stop on `SourceBlockedError`) so T054 passes
- [X] T067 [US1] Register all adapters from T060–T066 in `apps/api/src/sources/index.ts` and wire fixture mode so `SOURCES_MODE=fixtures` loads every fixture folder at startup
- [X] T068 [US1] Implement read queries in `apps/api/src/db/queries.ts`: `listCities`, `listMovies(city, today, now)` with FR-003 ordering, `getMovie(id)`, `screeningDates(movieId, city, today)`, `availableDates(today)` (today … furthest published date), `listScreenings(movieId, city, date, now)` (timeline order, ties by cinema name, excludes started screenings today), `freshness(cinemaIds, now)`
- [X] T069 [US1] Implement routes `apps/api/src/routes/cities.ts`, `apps/api/src/routes/movies.ts` (`GET /movies`, `GET /movies/:movieId`) and `apps/api/src/routes/screenings.ts` (`GET /movies/:movieId/screenings`) using the shared schemas, so T055–T057 pass
- [X] T070 [P] [US1] Create molecules in `apps/web/src/components/molecules/`: `MovieCard/` (poster, title, original title if different, age rating, "N seansai šiandien" or first-date label), `ScreeningRow/` (time, cinema + city, hall, format/language badges, "Pirkti bilietą"/"Buy ticket" link in new tab), `CityOption/`, `SearchField/` (labelled input, clear button)
- [X] T071 [P] [US1] Create organisms in `apps/web/src/components/organisms/`: `MovieGrid/` (responsive grid + client-side title search, FR-004), `ScreeningTimeline/` (single list, not grouped by cinema), `CityPrompt/` (modal dialog with focus trap, cities from API + "Visa Lietuva"/"All of Lithuania"), `StaleNotice/` (names stale cinemas, FR-015), `EmptyState/`, `LoadingState/`, `ErrorState/` (plain-language message + retry)
- [X] T072 [US1] Implement `apps/web/src/pages/MovieListPage.tsx` + `.module.scss`: shows CityPrompt when no city saved (FR-013), honours `?city=` from the URL and saves it, renders loading/empty/error states, MovieGrid, StaleNotice and "Atnaujinta HH:MM" in the footer (FR-014)
- [X] T073 [US1] Implement `apps/web/src/pages/MoviePage.tsx` + `.module.scss` for today: movie header (poster, titles, duration, rating), ScreeningTimeline, "no more screenings today" EmptyState with a link to `nextDateWithScreenings`, StaleNotice, last-updated footer
- [X] T074 [US1] Implement `apps/web/src/pages/NotFoundPage.tsx` (unknown route or `movie_not_found`, link back to the movie list)
- [X] T075 [US1] Add all US1 strings to `apps/web/src/i18n/lt.ts` and `apps/web/src/i18n/en.ts`; run T055–T059 and confirm they pass

**Checkpoint**: User Story 1 is fully functional — the MVP can be demoed and deployed.

---

## Phase 4: User Story 2 — Choose a different date (Priority: P2)

**Goal**: While viewing a movie, switch from today to a future date and see that day's screenings;
the date is in the URL.

**Independent Test**: Select a movie, pick a date three days ahead, reload and reopen the URL;
same screenings shown; no past dates selectable
([quickstart.md → US2](./quickstart.md#us2--choose-a-different-date-p2)).

### Tests for User Story 2 ⚠️

- [X] T076 [P] [US2] Extend `apps/api/tests/integration/screenings.test.ts`: future date returns that day's full list (no "already started" filtering); date before today or not in `availableDates` → `400 invalid_date`; screening at 00:30 appears on the date it starts
- [X] T077 [P] [US2] Component test `apps/web/tests/unit/DatePicker.test.tsx`: today selected by default; only `availableDates` selectable; dates in `screeningDates` visibly marked and announced to screen readers; keyboard navigation with arrow keys
- [X] T078 [P] [US2] End-to-end test `apps/web/tests/e2e/us2-date.spec.ts` covering quickstart US2 steps 1–3 with an axe scan

### Implementation for User Story 2

- [X] T079 [P] [US2] Create molecule `apps/web/src/components/molecules/DateChip/` (weekday + day, "Šiandien"/"Today", "has screenings" marker, `aria-pressed`)
- [X] T080 [US2] Create organism `apps/web/src/components/organisms/DatePicker/` (horizontally scrollable row of DateChips over `availableDates`, roving tabindex)
- [X] T081 [US2] Update `apps/web/src/pages/MoviePage.tsx` to read/write `?date=YYYY-MM-DD` (omitted = today; invalid or past date → today with an inline notice, per web-routes.md), fetch screenings for the selected date, and keep the previous list visible with a loading indicator while switching (feedback within 100 ms)
- [X] T082 [US2] Add US2 strings to `apps/web/src/i18n/lt.ts` and `apps/web/src/i18n/en.ts`; run T076–T078 and confirm they pass

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 — Narrow down screenings by city, cinema, and format (Priority: P3)

**Goal**: Change city at any time and filter a movie's screenings by cinema and format/language;
filters live in the URL.

**Independent Test**: On a movie with many screenings, apply each filter, confirm only matching
rows remain, clear filters restores the full list
([quickstart.md → US3](./quickstart.md#us3--filters-p3)).

### Tests for User Story 3 ⚠️

- [X] T083 [P] [US3] Unit test `apps/web/tests/unit/filters.test.ts` for `applyFilters(screenings, { cinemas, formats, audio })`: cinema list filter; format filter; `audio=original` keeps screenings whose spoken language is not dubbed Lithuanian; `audio=dubbed` keeps `isDubbed === true`; screenings with unknown format/language are excluded only when that filter is active
- [X] T084 [P] [US3] Component test `apps/web/tests/unit/FilterBar.test.tsx`: options built only from values present in the current list; selected chips reflected in URL params `cinema`, `format`, `audio`; "Išvalyti filtrus"/"Clear filters" resets
- [X] T085 [P] [US3] End-to-end test `apps/web/tests/e2e/us3-filters.spec.ts` covering quickstart US3 steps 1–3 (city change to "Visa Lietuva" then Kaunas persists after reload) with an axe scan. *Note:* the e2e format step filters Forum Vingis' IMAX screenings of "Odisėja"

### Implementation for User Story 3

- [X] T086 [P] [US3] Implement `applyFilters` and URL (de)serialisation `parseFilters(searchParams)`/`toSearchParams(filters)` in `apps/web/src/lib/filters.ts` so T083 passes
- [X] T087 [P] [US3] Create molecule `apps/web/src/components/molecules/FilterChip/` (toggle button with `aria-pressed`)
- [X] T088 [US3] Create organism `apps/web/src/components/organisms/FilterBar/` (cinema, format and audio groups; collapsible on mobile) so T084 passes
- [X] T089 [US3] Add a city switcher to `apps/web/src/components/templates/PageLayout/PageLayout.tsx` reusing `CityOption` (changing city updates `seansai.city`, the `?city` param and refetches lists). *Implemented as:* organism `CitySwitcher` in the header, opening `CityPrompt` (now closable with a button or Escape); the remembered city moved into a shared `CityProvider` so header and page stay in sync; the `?city` param is updated when the link has one, and the `cinema` filter is dropped because it names the old city's cinemas
- [X] T090 [US3] Update `apps/web/src/pages/MoviePage.tsx` to render FilterBar, apply filters client-side, and show "no screenings match" EmptyState with a one-click clear (US3 scenario 5)
- [X] T091 [US3] Add US3 strings to `apps/web/src/i18n/lt.ts` and `apps/web/src/i18n/en.ts`; run T083–T085 and confirm they pass

**Checkpoint**: All user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Resilience, performance, operations and documentation across all stories

- [X] T092 [P] End-to-end test `apps/web/tests/e2e/resilience.spec.ts` with `FIXTURE_FAIL=forum FIXTURE_FORUM_LAST_SUCCESS_HOURS=4`: other cinemas still listed, StaleNotice names Forum Cinemas, last-updated time shown (FR-015, SC-005) *Implemented with `FIXTURE_FAIL=vue FIXTURE_VUE_LAST_SUCCESS_HOURS=4`* (chosen while Forum had no adapter; either source exercises the same path). Runs on a third Playwright web server (API :3001, web :5174)
- [X] T093 [P] End-to-end test `apps/web/tests/e2e/language.spec.ts`: switching to EN changes the URL to `/en/…`, interface text, keeps movie titles, shows original title where different, and persists after reload (FR-017)
- [X] T094 [P] Implement `apps/api/scripts/sources-check.ts` (`npm run sources:check`): fetches each enabled live source once, prints per-cinema screening counts for today and the next 6 days, validation errors, which sources use `robotsOverride`, and each adapter's declared `limitations` (e.g. Cinamon `today-only` is reported, not counted as a failure); exits non-zero if any source without a matching limitation has no screenings for a day in that range *Note:* also `-- --fixtures` to check the saved data; logic in `apps/api/src/sources/check.ts` (unit-tested). Not yet run against the live sites
- [X] T095 [P] Add bundle budget check `apps/web/scripts/check-bundle-size.ts` run after `vite build`: fail if initial JS > 150 KB gzipped; lazy-load MoviePage route. Add load-time test `apps/web/tests/e2e/performance.spec.ts` (SC-002): against the production build served by the API in fixture mode, on the Pixel 7 project with Chromium network throttling (download 1.6 Mbps, upload 750 kbps, latency 150 ms) and 4× CPU slowdown via CDP, assert the movie list's first poster card and the movie page's first screening row are visible within 2 s of navigation (cold cache) *Also:* the load-time test failed at first (3.6 s), so the API now serves the web build precompressed (`compress-assets.ts` writes .br/.gz at build time, `@fastify/static` `preCompressed`) and compresses JSON (`@fastify/compress`), route loaders start each page's API requests while its code downloads, and `GET /movies/{id}/screenings` takes an optional `date` (default today) so today's screenings no longer wait for the movie details; both pages now appear in about 1.55 s
- [X] T096 [P] Add `apps/api/tests/integration/performance.test.ts`: with a seeded DB of 7,000 screenings, `GET /movies` and `GET /movies/{id}/screenings` respond in < 50 ms at p95 over 200 sequential requests via `inject`. Add load test `apps/api/tests/load/peak.test.ts` (SC-007, run by `npm run test:load`, included in CI after `npm test`): start the real server on a random port with the same seeded DB and use `autocannon` (dev dependency) with 100 concurrent connections for 20 s, mixing `GET /movies?city=vilnius` and `GET /movies/{id}/screenings` for 10 movies; assert p95 latency < 300 ms and zero non-2xx responses *Note:* autocannon reports p90 and p97.5, not p95, so the test asserts p97.5 < 300 ms (stricter)
- [X] T097 [P] Create `Dockerfile` (multi-stage: build all workspaces, runtime `node:24-slim`, non-root user, `DB_PATH=/data/seansai.sqlite`, `VOLUME /data`, `EXPOSE 3000`) and `.dockerignore` *Note:* Docker is not installed on the development machine, so the image has not been built; the runtime stage was simulated (same files, `npm ci --omit=dev --workspace @seansai/api`, production start) and served the app, health and precompressed assets
- [X] T098 [P] Write root `README.md`: what Seansai is, supported cinemas and the Vue/Cinamon override note with the kill switch, how to run (link to quickstart.md), quality gates, how to add a cinema (registry entry + adapter + fixtures + contract test)
- [X] T099 Security review of `apps/api/src/server.ts` and routes: all query params validated, no stack traces in responses, `Content-Security-Policy` and `X-Content-Type-Options` headers for the web app, no secrets in the repo (`SEANSAI_CONTACT` from env only) *Done:* query params were already zod-validated and errors already generic; added `Content-Security-Policy` (no `unsafe-inline`), `X-Content-Type-Options: nosniff` and `Referrer-Policy` on every response, and movie ids validated (malformed → 404, over 100 characters → 414 from Fastify); no secrets found in the repo
- [X] T100 Run every scenario in [quickstart.md](./quickstart.md) plus all quality gates (`lint`, `format:check`, `typecheck`, `test`, `test:e2e`, `build`) and fix any failures *Done* for every fixture scenario (US1–US3, language and resilience are automated end-to-end) and all gates; the manual "Live sources" check (`SEANSAI_CONTACT=… npm run sources:check`) has not been run, because it contacts the cinema websites

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**
- **US1 (Phase 3)**: depends on Foundational
- **US2 (Phase 4)**: depends on Foundational; uses US1's MoviePage and API routes (T069, T073)
- **US3 (Phase 5)**: depends on Foundational; uses US1's MoviePage (T073) and PageLayout (T046)
- **Polish (Phase 6)**: depends on the stories it covers

### Key task dependencies

- T012 ← T011 · T016 ← T015 · T022 ← T020, T021 · T027 ← T026 · T029 ← T027, T028
- T033 ← T016, T022, T023, T029, T031, T032 · T034 ← T033 · T036 ← T010, T013, T014
- T038 ← T034, T035, T036 · T043 ← T010 · T044 ← T040, T042
- Each adapter T060–T066 ← its contract test T048–T054 ← fixtures T047 ← T025
- T068 ← T022 · T069 ← T068, T036 · T072/T073 ← T043, T044, T046, T070, T071
- T081 ← T073, T080 · T090 ← T073, T086, T088

### User Story Dependencies

- **US1 (P1)**: no dependency on other stories — the MVP
- **US2 (P2)**: extends US1's movie page; testable on its own via the date picker and `?date=`
- **US3 (P3)**: extends US1's movie page and layout; testable on its own via filters and city switch

### Within Each User Story

- Tests first (they must fail), then data/queries, then routes, then UI, then strings
- Story complete and its checkpoint verified before moving to the next priority

### Parallel Opportunities

- Setup: T002–T009 in parallel after T001
- Foundational: T010–T015, T017, T019, T023, T024, T026, T028, T030 and T039–T042 in parallel
- US1: all seven adapter contract tests (T048–T054) and all seven adapters (T060–T066) in parallel;
  API integration tests (T055–T057) and web component tests (T058) in parallel; molecules (T070)
  and organisms (T071) in parallel with API routes (T068–T069)
- US2 and US3 can be built in parallel by different people once US1 is done
- Polish: T092–T098 in parallel

---

## Parallel Example: User Story 1

```bash
# All adapter contract tests at once (different files):
Task: "Contract test apps/api/tests/contract/mcs.test.ts"
Task: "Contract test apps/api/tests/contract/forum.test.ts"
Task: "Contract test apps/api/tests/contract/skalvija.test.ts"
Task: "Contract test apps/api/tests/contract/fliko.test.ts"
Task: "Contract test apps/api/tests/contract/romuva.test.ts"
Task: "Contract test apps/api/tests/contract/vue.test.ts"
Task: "Contract test apps/api/tests/contract/cinamon.test.ts"

# Then all adapters at once (one folder each):
Task: "MCS adapter in apps/api/src/sources/mcs/adapter.ts"
Task: "Forum adapter in apps/api/src/sources/forum/adapter.ts"
Task: "Vue adapter in apps/api/src/sources/vue/adapter.ts"
# …and the remaining four

# API and UI in parallel:
Task: "Read queries in apps/api/src/db/queries.ts"
Task: "Molecules in apps/web/src/components/molecules/"
Task: "Organisms in apps/web/src/components/organisms/"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup
2. Phase 2: Foundational (blocks everything)
3. Phase 3: User Story 1
4. **Stop and validate**: run quickstart US1 with fixtures, then `npm run sources:check` live
5. Deploy the container if ready

A smaller first slice is possible inside US1: build the MCS and Forum adapters first (they cover
10 of the 18 venues and every city except Marijampolė and Gargždai), demo, then add the rest.

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → test → deploy (MVP: today's screenings)
3. US2 → test → deploy (future dates)
4. US3 → test → deploy (filters and city switch)
5. Polish → resilience, performance and operations checks

---

## Notes

- [P] tasks touch different files and have no unfinished dependencies
- Vue and Cinamon run with `robotsOverride` by owner decision (research.md §1b); they must stop on
  any sign of blocking and can be disabled with `DISABLED_SOURCES=vue,cinamon`
- Fixtures are captured deliberately (T025/T047) and never fetched in CI
- Commit after each task or logical group; stop at any checkpoint to validate a story on its own
