---
description: 'Task list for Findable in Search Engines'
---

# Tasks: Findable in Search Engines

**Input**: Design documents from `/specs/003-seo-friendly-web/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Required. Constitution Principle IV says every feature ships with automated tests for its
acceptance criteria. Test tasks come first in each phase and must fail before the implementation tasks.

**Organization**:

- Phase 1: the API addition, which ships on its own first.
- Phase 2: shared setup and the rendering pipeline.
- Phases 3–6: one phase per user story, in priority order. Each ends with a commit. US3 starts with a second API addition, which ships on its own first.
- Phase 7: documents, final checks, production and the owner's steps.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)

## Path Conventions

npm workspaces monorepo: `apps/api/`, `apps/web/`, `packages/shared/`. Tests live in `apps/*/tests/`.

---

## Phase 1: API Addition (First PR)

**Purpose**: The first API change, which has to be live before later builds can work, because builds validate against production's API (research §3). This PR carries only this and the 003 documents. Nothing visible changes.

**⚠️ CRITICAL**: No user story can be deployed until T005 is merged.

- [X] T001 [P] Add failing tests for `showingAt` on `GET /api/v1/movies/:movieId`: "Cinemas with a screening of this movie that hasn't started, within the requested `city`", "Ordered by city name, then cinema name", "Empty when there are none", in `apps/api/tests/integration/movies.test.ts`
- [X] T002 [P] Add a failing test that every `/api/` response, including errors, sends `X-Robots-Tag: noindex`, in `apps/api/tests/integration/server.test.ts`
- [X] T003 Add `showingAt: Array<{ id, name, cityId, cityName }>` to `MovieDetailResponseSchema` in `packages/shared/src/api.ts`, one query in `apps/api/src/db/queries.ts` with no N+1, the field and a `lang` option for `cityName` in `apps/api/src/routes/movies.ts`, and the field in `apps/web/tests/helpers/mock-api.ts`
- [X] T004 Send `X-Robots-Tag: noindex` on `/api/` responses from `apps/api/src/server.ts`, kept out of `SECURITY_HEADERS` because `tests/unit/vercel-config.test.ts` keeps those equal to `vercel.json`'s page headers. Comment on why robots.txt doesn't block the API instead (research §7)
- [X] T005 Document `showingAt` in `specs/001-cinema-showtimes/contracts/public-api.md`, run all quality gates, run a reviewer agent over the change against `.specify/memory/constitution.md` and fix what it finds (Constitution I), then commit. **Ask the owner to approve a PR from this branch, carrying the 003 documents and the API addition**, wait for CI to pass, and merge. After it merges, confirm the PR shows as merged, and confirm `curl https://seansai.vercel.app/api/v1/movies/<id>?city=all` includes `showingAt`, and continue on a new branch from `main`, `003-seo-pages`

**Checkpoint**: Production's API has `showingAt`, and nothing visible has changed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: On the new branch `003-seo-pages`: the settings everything else reads, then what renders a page to HTML and takes over in the browser.

### Setup

- [X] T006 [P] Add the one public address, `export const SITE_URL = 'https://seansai.vercel.app'`, with a comment that a move to `seansai.lt` changes only this line (FR-022), in `apps/web/src/lib/site.ts`
- [X] T007 [P] In `apps/web/vite.config.ts`, using `defineConfig(({ isPreview, isSsrBuild }) => ...)`: set `build.cssCodeSplit: false` so one stylesheet is linked from every page (research §2). Set `build.outDir` from `BUILD_OUT_DIR`, default `dist`, with `-prerender` added for SSR builds, so concurrent builds never share a folder. For `vite preview` only, use `appType: 'mpa'`, because the development server needs its fallback to `index.html`, and add a `configurePreviewServer` plugin that adds the trailing slash when the path is a directory, keeping any query string. Without it, `/lt/movie/x` answers 404 from `x/index.html` (measured, research §10)
- [X] T007a [P] Add `apps/web/scripts/build-paths.ts`, exporting the output folder from `BUILD_OUT_DIR` with default `dist`, and use it in `apps/web/scripts/compress-assets.ts` and `apps/web/scripts/check-bundle-size.ts`, which hardcode `dist` today. `apps/web/scripts/prerender.ts` is its third user (Constitution I)
- [X] T008 [P] Ignore `dist-*/` in `.gitignore`, `.prettierignore` and `eslint.config.js`

### Rendering pipeline

- [X] T009 [P] Add failing tests for the escaping helper: a title containing `</script>`, `<`, `>`, `&` and U+2028/9 can't break out of embedded JSON, and quotes can't break out of attributes, in `apps/web/tests/unit/html-escape.test.ts`
- [X] T010 [P] Add failing tests: `useCity` returns city `all` and `isChosen: false` when nothing is remembered, and a remembered city stays; when the API answers `invalid_city` for a stored city or a `?city=` link, that city is forgotten, the option is removed from the address, and the page shows all of Lithuania with `isChosen: false`, in `apps/web/tests/unit/router.test.tsx`, with `forgetCity` in `apps/web/tests/unit/settings.test.ts`
- [X] T011 Add `escapeHtml` and `serializeForScript` in `apps/web/src/lib/html-escape.ts`
- [X] T012 Change `useCity` in `apps/web/src/app/city.tsx` to return the effective city, `all` until chosen, plus `isChosen`. Remove `city === null` branches from `apps/web/src/api/hooks.ts`, `apps/web/src/pages/MovieListPage.tsx`, `apps/web/src/pages/MoviePage.tsx`, `apps/web/src/components/organisms/CitySwitcher/CitySwitcher.tsx` and `pageContext` in `apps/web/src/app/router.tsx`. Add `forgetCity` to `apps/web/src/storage/settings.ts` and to `city.tsx`, and call it from an effect in both pages on `invalid_city`, since only they can see that error (research §9). The first-visit dialog stops opening here, and US1 adds its replacement
- [X] T013 Show `ErrorState` only when a query has no data at all, so a failed background refetch never replaces content (research §7), with tests, in `apps/web/src/pages/MoviePage.tsx`, `apps/web/src/pages/MovieListPage.tsx` and `apps/web/tests/unit/MoviePage.test.tsx`
- [X] T014 Add `apps/web/src/entry-prerender.tsx`: `renderPage(url, queryClient)` runs `createStaticHandler(createRoutes(queryClient))`, renders `AppProviders` and `StaticRouterProvider` with `hydrate={false}` through `renderToString`, and returns the markup with the dehydrated cache
- [X] T015 Add `apps/web/public/boot-gate.js`, a small blocking script that sets `data-boot="client"` on `<html>` when the address has a query string, `seansai.city` is in localStorage, or `<meta name="snapshot-date">` isn't today in Vilnius, wrapped so unavailable storage counts as nothing remembered. Any query string counts, including ones the app ignores such as `fbclid`, because the worst case is what visitors get today (research §10). Link it from `apps/web/index.html`, and hide `#root` in that state in `apps/web/src/styles/global.scss`
- [X] T016 Change `apps/web/src/main.tsx`: when `document.documentElement.dataset.boot` isn't `client` and `#root` has content, read `#initial-data`, `hydrate` the query cache, resolve the page's lazy routes, then call `hydrateRoot` with `onRecoverableError` logging to the console. Otherwise call `createRoot`, and remove `data-boot` in a layout effect of the first commit so `#root` is shown again, or returning visitors and self-hosted users would see a blank page. A missing or malformed `#initial-data` also falls back to `createRoot`, and removes `data-boot` the same way

**Checkpoint**: One page can be rendered and taken over, and the app runs with no first-visit prompt.

---

## Phase 3: User Story 1 - Reach a movie's screenings from a search (Priority: P1) 🎯 MVP

**Goal**: Every current movie and the general list have real content, their own title and description, stay current, and open straight away for someone arriving from search.

**Independent Test**: Request any current movie's address without running scripts and confirm the response contains its title, facts, and when and where it's showing. Open it in a fresh browser and confirm a person sees the same content.

### Tests for User Story 1 ⚠️

> **Write these first and confirm they fail.**

- [X] T017 [US1] Add a snapshot server to `apps/web/playwright.config.ts` and `SNAPSHOT_PORT` to `apps/web/tests/e2e/ports.ts`: start the fixture API on its own port, wait for it, build with `SNAPSHOT_API_URL` and `BUILD_OUT_DIR=dist-snapshot` so it doesn't collide with the production server's build, then run `vite preview` with `BUILD_OUT_DIR=dist-snapshot` and `API_PORT` set to that API
- [X] T018 [P] [US1] Add failing tests for `pageHead`: unique title per movie including the year when known, description "Up to about 155 characters" in the page's language built from known facts only, missing year, genres or poster are left out rather than guessed, and two records with the same title and year are still reported, in `apps/web/tests/unit/page-head.test.ts`
- [X] T019 [P] [US1] Add failing tests for the deploy hook: one `POST` when at least one source has status `success`, none when all failed or the URL is unset, one retry after a failure or 10 s timeout, a second failure is logged and doesn't change the result, and the URL is never logged, in `apps/api/tests/unit/deploy-hook.test.ts`, with the setting in `apps/api/tests/unit/config.test.ts`
- [X] T020 [P] [US1] Add failing tests for the build's safety checks: a failed request after retries, a response failing validation, an empty general list, a page with no `<h1>` and a page over budget each exit non-zero and write nothing to the output; two pages sharing a title or description log a warning naming them and don't fail the build, in `apps/web/tests/unit/prerender.test.ts`
- [X] T021 [P] [US1] Add failing tests for `CityChoice`: it shows only when no city is chosen, is normal page content rather than a dialog, doesn't take focus, "Keep all of Lithuania" remembers `all` and removes it, and "Choose city" opens the existing dialog, in `apps/web/tests/unit/CityChoice.test.tsx`
- [X] T022 [P] [US1] Add failing no-script tests, with JavaScript disabled, against the snapshot server: a movie page has its title, facts, summary, screenings and ticket links; a movie with none today has its summary and next-date link; `/lt/` has plain links to every movie; `<html lang>` and exactly one `<h1>` are right, in `apps/web/tests/e2e/seo.spec.ts`
- [X] T023 [P] [US1] Add failing browser tests with `page.clock` set to the fixture time (`helpers.ts` gives the instant): a first visit has content at first paint and no prompt covering it, no hydration or CSP messages in the console, no accessibility violations; with a remembered city, no all-of-Lithuania content is ever visible and that city's content then appears; a first-time visitor opening `?date=`, `?city=` or a filter link never sees the plain snapshot, sees the requested view, and gets no hydration messages; with a snapshot from an earlier day, current data replaces it; a failed background API request leaves the content in place, in `apps/web/tests/e2e/seo.spec.ts`
- [X] T024 [US1] Tests that expected the first-visit dialog were moved to the new behaviour in Phase 2, when T012 removed it, with `CityPrompt.test.tsx` opening the dialog from the header. Add `CityChoice` to them: `apps/web/tests/e2e/us1-today.spec.ts`, `apps/web/tests/e2e/us3-filters.spec.ts`, `apps/web/tests/unit/router.test.tsx`, `apps/web/tests/unit/MoviePage.test.tsx`, `apps/web/tests/unit/PageLayout.test.tsx`. `apps/web/tests/unit/CityPrompt.test.tsx` keeps covering the dialog opened from the header
- [X] T024a [P] [US1] Add failing tests for `useDocumentHead`: the document's title, description and `noindex` follow the page as people navigate, and tags already in the head are updated rather than duplicated, in `apps/web/tests/unit/document-head.test.tsx`

### Implementation for User Story 1

- [X] T025 [P] [US1] Add `pageHead(page, lang)` for movie and general list pages, returning `title`, `description` and `robots` as in `specs/003-seo-friendly-web/data-model.md`, in `apps/web/src/lib/page-head.ts`, with new texts in `apps/web/src/i18n/lt.ts` and `apps/web/src/i18n/en.ts`
- [X] T026 [P] [US1] Add `CityChoice` with its stylesheet and index in `apps/web/src/components/organisms/CityChoice/`, new texts in `apps/web/src/i18n/lt.ts` and `apps/web/src/i18n/en.ts`, and show it from `apps/web/src/components/templates/PageLayout/PageLayout.tsx`.
- [X] T027 [US1] Add a visible summary of when and where the movie is next showing to `MovieHeader`, from `screeningDates[0]` and `showingAt` (city names for all of Lithuania, cinema names within a city), in `apps/web/src/pages/MoviePage.tsx` and `apps/web/src/pages/MoviePage.module.scss`, with `getMovie` in `apps/web/src/api/client.ts` and its query key in `apps/web/src/api/hooks.ts` carrying `lang` so city names follow the page's language (FR-005)
- [X] T028 [US1] Add `useDocumentHead(head)` in `apps/web/src/app/document-head.ts`, updating the existing head tags as people navigate, and call it from `apps/web/src/pages/MoviePage.tsx`, `apps/web/src/pages/MovieListPage.tsx` and `apps/web/src/pages/NotFoundPage.tsx`
- [X] T029 [US1] Add `apps/web/scripts/prerender.ts`: read data as in `specs/003-seo-friendly-web/contracts/snapshot.md` (`snapshot={build time}` on every request, "At most 8 requests at once, each retried twice", shared schemas), render `/{lang}/` and `/{lang}/movie/{movieId}` in both languages, write each to `{outDir}/{path}/index.html` from the built `index.html` with `<html lang>`, head tags, `<meta name="snapshot-date">`, markup and `#initial-data`, apply the safety checks and HTML budgets (movie ≤ 40 kB and list ≤ 80 kB compressed), and compare all pages' titles and descriptions, logging a warning for duplicates (SC-002). Commit nothing generated
- [X] T030 [US1] Update the `build` script in `apps/web/package.json`: `vite build`, then `vite build --ssr src/entry-prerender.tsx`, whose output folder comes from T007, then the existing compression and bundle checks, then `node scripts/prerender.ts`, which runs when `VERCEL` or `SNAPSHOT_API_URL` is set and otherwise exits without writing pages
- [X] T031 [P] [US1] Add `apps/api/src/refresh/deploy-hook.ts`, the optional `VERCEL_DEPLOY_HOOK_URL` in `apps/api/src/config.ts`, and call the hook from `runAll` in `apps/api/src/refresh/pipeline.ts`, which serves both the home job and the cron route. Log `Snapshot build requested` or an error
- [X] T032 [US1] Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` and `npm run test:e2e`, then commit `feat(web): serve real movie pages as a daily snapshot (003 US1)` and push to create a preview
- [X] T033 [US1] On the preview, do the checks from `specs/003-seo-friendly-web/quickstart.md` §2 for hydration, CSP and non-ASCII movie addresses. For anything that fails, apply the fallback in `specs/003-seo-friendly-web/research.md` §2, §5 or §6, and record what was measured in that file

**Checkpoint**: US1 works alone. The catch-all rewrite is still in place, so unknown addresses behave as before until US2.

---

## Phase 4: User Story 2 - Search engines find every page, and only the right ones (Priority: P1)

**Goal**: Search engines discover every page from a site map, see one preferred address per page, know each page's language, and get real redirects and not-found responses.

**Independent Test**: Fetch the site map and check every address in it answers directly with success, then follow only plain links from the list page and confirm every movie is reached.

### Tests for User Story 2 ⚠️

- [X] T034 [P] [US2] Add failing tests for canonical addresses from the table in `specs/003-seo-friendly-web/data-model.md` and for `alternates`, "`lt`, `en` and `x-default` (Lithuanian): the same set on both versions", with full addresses from `SITE_URL`, in `apps/web/tests/unit/page-head.test.ts`
- [X] T035 [P] [US2] Add failing tests for the site map (every plain page in both languages, percent-encoded addresses including non-ASCII ids, `lastmod`, no other pages) and for robots.txt, exactly as in `specs/003-seo-friendly-web/contracts/web-pages.md`, in `apps/web/tests/unit/prerender.test.ts`
- [X] T036 [P] [US2] Add failing tests for language memory: `setLang` also writes the cookie "`seansai_lang` ... 1 year, `SameSite=Lax`, `Secure` on HTTPS", and at startup a language already remembered in localStorage is copied to the cookie, so people who chose one before the cookie existed keep it (owner, 2026-11-03). Nothing else writes it, and with no remembered language there is no cookie, in `apps/web/tests/unit/settings.test.ts` and `apps/web/tests/unit/main.test.tsx`
- [X] T037 [P] [US2] Add failing tests for the `redirects` rules and the removed catch-all rewrite in `apps/api/tests/unit/vercel-config.test.ts`, and that a self-hosted server sends `X-Robots-Tag: noindex` on every response, in `apps/api/tests/integration/server.test.ts`
- [X] T038 [P] [US2] Add failing tests against the snapshot server: every `sitemap.xml` address answers 200 directly; an unknown address and an unknown movie answer 404; every page's canonical and language links are present without scripts, in `apps/web/tests/e2e/seo.spec.ts`
- [X] T038a [P] [US2] Add failing tests for `apps/web/src/app/document-head.ts`: addresses with options name the preferred address from the table in `specs/003-seo-friendly-web/data-model.md` (a movie with `?date=` names the plain movie, `?city=all` names `/{lang}/`), and `noindex` from `404.html` is removed when the app has a real page for that address but stays on its not-found page, in `apps/web/tests/unit/document-head.test.tsx`

### Implementation for User Story 2

- [X] T039 [US2] Add `canonical` and `alternates` to `pageHead` in `apps/web/src/lib/page-head.ts`, write them in `apps/web/scripts/prerender.ts`, and have `apps/web/src/app/document-head.ts` apply the table for addresses with options
- [X] T040 [US2] Write `sitemap.xml`, `robots.txt` and `404.html` in `apps/web/scripts/prerender.ts`. `404.html` is the app shell with `robots: noindex`, and `apps/web/src/app/document-head.ts` removes the `noindex` when the app turns out to have a real page for that address
- [X] T041 [P] [US2] Write the `seansai_lang` cookie from `setLang` in `apps/web/src/storage/settings.ts`, with a comment that only the `/` redirect reads it, and copy a remembered language to it at startup from `apps/web/src/main.tsx`
- [X] T042 [P] [US2] Send `X-Robots-Tag: noindex` on every response when serving the web app in `apps/api/src/server.ts`
- [X] T043 [US2] Add `redirects` and replace the web service's catch-all rewrite in `vercel.json`, as in `specs/003-seo-friendly-web/contracts/snapshot.md`
- [X] T044 [US2] Update the CI container check `get /lt/vilnius` if needed so it still proves the self-hosted fallback, and add a `noindex` check, in `.github/workflows/ci.yml`
- [X] T045 [US2] Run all quality gates, commit `feat(web): add site map, preferred addresses and real responses (003 US2)` and push
- [X] T046 [US2] On the preview, do the remaining checks from `specs/003-seo-friendly-web/quickstart.md` §2: 404 status and page, both `/` redirects, the language redirect, `X-Robots-Tag`. Apply the fallback from `specs/003-seo-friendly-web/research.md` §6 if 404 fails, and record the results there

**Checkpoint**: US1 and US2 are the shippable core. Search engines can be told about the site from here.

---

## Phase 5: User Story 3 - Find what's on in a city (Priority: P2)

**Goal**: Each city has its own searchable movie list page in both languages.

**Independent Test**: Take one city's list page from the site map and confirm it has its own title and description naming the city, and lists only movies showing there.

### API addition for User Story 3 (its own PR)

> **⚠️ Merge this before the rest of US3.** The app needs `hasMovies` to decide which city links to show, and builds validate against production's API (research §3), so it has to be live first.

- [X] T046a [US3] On a new branch from `main`, add failing tests for `hasMovies` on `GET /api/v1/cities`: true for a city with a screening that hasn't started, false for a city whose screenings have all started or that has none, and only the shown cinemas count, in `apps/api/tests/integration/cities.test.ts`
- [X] T046b [US3] Add `hasMovies: boolean` to `CitiesResponseSchema` in `packages/shared/src/api.ts`, one query in `apps/api/src/db/queries.ts` that stops at the first screening it finds for each cinema, with no N+1, and the field in `apps/api/src/routes/cities.ts`. Pass `now` to that route, as the movie routes get it. Add the field to `apps/web/tests/helpers/mock-api.ts`, add `GET /cities` to `apps/api/tests/integration/performance.test.ts`, and document the field in `specs/001-cinema-showtimes/contracts/public-api.md`. Every page requests `/cities`, so measure the rows the query reads against the Turso allowance in `specs/003-seo-friendly-web/plan.md`, and record the result in `specs/003-seo-friendly-web/research.md` §11
- [X] T046c [US3] Run all quality gates and a reviewer agent against `.specify/memory/constitution.md`, and fix what it finds (Constitution I). **Ask the owner to approve a PR**, wait for CI, and merge. Confirm the PR shows as merged and that `curl https://seansai.vercel.app/api/v1/cities?lang=lt` includes `hasMovies`, then merge `main` into `003-seo-pages`

### Tests for User Story 3 ⚠️

- [X] T047 [P] [US3] Add failing tests for city page heads: "Kino seansai Vilniuje" in Lithuanian, the English form, the fallback "Kino seansai: {name}" for a city not in the map, a list of every registry city confirming it has a form, and `?city=vilnius` naming `/{lang}/city/vilnius`, in `apps/web/tests/unit/page-head.test.ts`
- [X] T048 [P] [US3] Add failing router tests: `/{lang}/city/{cityId}` sets and remembers that city and an unknown city shows the not-found page. The rendered list page's canonical link follows its address, not the remembered city (FR-012): `/lt/?city=vilnius` names `/lt/city/vilnius`, `/lt/` with Vilnius remembered names `/lt/`, and `/lt/?city=riga` names `/lt/` once the unknown city is forgotten, in `apps/web/tests/unit/router.test.tsx`
- [X] T049 [P] [US3] Add failing end-to-end tests: without scripts a city page names the city and lists only its movies; a person isn't asked for a city; switching city on a city page goes to that city's page, or to `/{lang}/` for all of Lithuania; opening a movie from it shows that city's screenings; without scripts, the general list has a plain link to each city page with current movies, in `apps/web/tests/e2e/seo.spec.ts`. A city with no current movies is covered by T049a, as all 7 fixture cities have movies
- [X] T049a [US3] Add failing tests for a city with no current movies, using a `cities` option added to `mockApi` in `apps/web/tests/helpers/mock-api.ts`: its page shows the empty message, and the general list links only to cities with `hasMovies`, in `apps/web/tests/unit/router.test.tsx`; its page is still written, the build doesn't fail, and it isn't in the site map, in `apps/web/tests/unit/prerender.test.ts`

### Implementation for User Story 3

- [X] T050 [P] [US3] Add the Lithuanian forms for the 7 current cities (Vilniuje, Kaune, Klaipėdoje, Šiauliuose, Panevėžyje, Marijampolėje, Gargžduose) and the English title in `apps/web/src/i18n/lt.ts` and `apps/web/src/i18n/en.ts`, and city pages in `apps/web/src/lib/page-head.ts`. `pageHead` also gets the list address's `?city=` option, to name the preferred address from the table in `specs/003-seo-friendly-web/data-model.md`
- [X] T051 [US3] Add the route `city/:cityId` using `MovieListPage` in `apps/web/src/app/router.tsx`, and take the city from the address in `apps/web/src/app/city.tsx` and `apps/web/src/pages/MovieListPage.tsx`. An unknown city shows `NotFoundPage`. `MovieListPage` passes `pageHead` the `?city=` in its address, not `useCity`'s city, which can be the remembered one
- [X] T052 [US3] Navigate to the chosen city's page when choosing a city on a list page, from `chooseCity` in `apps/web/src/app/city.tsx`
- [X] T053 [US3] Add plain links to every city page with `hasMovies` to the general list, from `useCities`, with no extra request per city, in `apps/web/src/pages/MovieListPage.tsx` and `apps/web/src/pages/MovieListPage.module.scss`
- [X] T054 [US3] Render city pages and add those with `hasMovies` to the site map in `apps/web/scripts/prerender.ts`, and add `/{lang}/city/{cityId}` to `specs/001-cinema-showtimes/contracts/web-routes.md`
- [X] T055 [US3] Run all quality gates, commit `feat(web): add a page for each city (003 US3)` and push

**Checkpoint**: City searches have pages to land on.

---

## Phase 6: User Story 4 - Shared links look right (Priority: P3)

**Goal**: Shared links show the right title, description and image.

**Independent Test**: Run a sample of movie addresses through a link-preview checker and confirm the title, description and image match the movie.

### Tests for User Story 4 ⚠️

- [ ] T056 [P] [US4] Add failing tests: `image` is the poster or the default preview image, `imageAlt` is the title or the site's name, `type` is "`video.movie` for movies, `website` otherwise", in `apps/web/tests/unit/page-head.test.ts`
- [ ] T057 [P] [US4] Add failing no-script tests that a movie page and the list page have every tag listed in `specs/003-seo-friendly-web/contracts/web-pages.md`, and that the site icon and default image answer 200, in `apps/web/tests/e2e/seo.spec.ts`

### Implementation for User Story 4

- [ ] T058 [P] [US4] Add a site icon (`favicon.svg`, plus a PNG fallback) and a 1200×630 default preview image (`og-default.png`) to `apps/web/public/`, and link the icon from `apps/web/index.html`
- [ ] T059 [US4] Add `image`, `imageAlt` and `type` to `pageHead` in `apps/web/src/lib/page-head.ts`, and write the `og:` and `twitter:card` tags in `apps/web/scripts/prerender.ts`
- [ ] T060 [US4] Run all quality gates, commit `feat(web): add link previews and a site icon (003 US4)` and push

**Checkpoint**: All stories work.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documents, final checks, release and the steps only the owner can do.

- [ ] T061 [P] Update feature 001's documents now that the behaviour changes: FR-013 in `specs/001-cinema-showtimes/spec.md`, and first-visit text and new responses in `specs/001-cinema-showtimes/contracts/web-routes.md`
- [ ] T062 [P] Update `specs/002-vercel-deploy/contracts/hosting.md` with the new `vercel.json`, `VERCEL_DEPLOY_HOOK_URL` and the rollback note, and add the hook to `specs/002-vercel-deploy/quickstart.md` §5
- [ ] T063 [P] Describe snapshots, the hook setting, the rollback note and how to move to `seansai.lt` in `README.md`
- [ ] T064 Run `specs/003-seo-friendly-web/quickstart.md` §1 by hand, and check the budgets in `specs/003-seo-friendly-web/plan.md`, recording measured HTML sizes and build time in `specs/003-seo-friendly-web/research.md`
- [ ] T065 Run a reviewer agent over the whole branch against `.specify/memory/constitution.md` (Constitution I), and fix what it finds
- [ ] T066 **Ask the owner to approve**, then open a PR from `003-seo-pages`, wait for CI, merge to `main`, confirm the PR shows as merged and that CI and the production deployment on `main` passed, using `gh`
- [ ] T067 Do `specs/003-seo-friendly-web/quickstart.md` §3 on production, including Facebook's debugger for 10 movies (SC-008) and a phone-sized PageSpeed run (SC-007), and record the results in `specs/003-seo-friendly-web/research.md`
- [ ] T068 **Owner step**: create the Deploy Hook for `main` in Vercel, add `VERCEL_DEPLOY_HOOK_URL` to `~/.config/seansai/refresh.env` and Vercel's Production environment, then confirm one daily cycle as in `specs/003-seo-friendly-web/quickstart.md` §4 (SC-004)
- [ ] T069 **Owner step**: register with Google Search Console and submit the site map, as in `specs/003-seo-friendly-web/quickstart.md` §5, committing the verification file to `apps/web/public/` (FR-021)
- [ ] T070 About 8 weeks after T069, measure SC-005 and SC-006 and record them in `specs/003-seo-friendly-web/research.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **API addition (Phase 1)**: None. T005 merges separately and must be live first, since every later build reads production's API.
- **Foundational (Phase 2)**: After T005 is merged, on `003-seo-pages`.
- **US1 (Phase 3)**: After Phase 2.
- **US2 (Phase 4)**: After US1, as it extends the snapshot script and page descriptions.
- **US3 (Phase 5)**: After US1. Its site map and canonical parts use US2's work, so do it after US2. T046c merges separately and must be live before the rest of US3, as the app and every later build read `hasMovies`.
- **US4 (Phase 6)**: After US1. Independent of US2 and US3.
- **Polish (Phase 7)**: After the stories wanted for release. T068 and T069 come after T066. T070 is about 8 weeks later.

### Within Each User Story

- Tests first, and they must fail.
- Page descriptions and components, then the snapshot script, then quality gates, then a commit.
- Preview checks come after pushing, because preview builds read production's API.

### Parallel Opportunities

- **API addition**: T001, T002.
- **Setup**: T006, T007, T007a, T008.
- **Pipeline**: T009, T010.
- **US1 tests**: T018–T023, T024a. **US1 implementation**: T025, T026, T031.
- **US2 tests**: T034–T038a. **US2 implementation**: T041, T042.
- **US3 tests**: T047–T049.
- **US4**: T056, T057, then T058.
- **Polish**: T061, T062, T063.

`apps/web/src/lib/page-head.ts`, `apps/web/scripts/prerender.ts` and `apps/web/tests/e2e/seo.spec.ts` are shared across stories, so work on them one story at a time.

### Parallel Example: User Story 1 Tests

```text
T018 pageHead tests in apps/web/tests/unit/page-head.test.ts
T019 deploy hook tests in apps/api/tests/unit/deploy-hook.test.ts
T020 build safety tests in apps/web/tests/unit/prerender.test.ts
T021 CityChoice tests in apps/web/tests/unit/CityChoice.test.tsx
```

T022 and T023 share one file, so they're parallel with these but not with each other.

## Implementation Strategy

### MVP First

1. Phase 1, with T005's PR merged, then Phase 2.
2. Phase 3 (US1), and confirm the unproven parts on a preview at T033. **Stop here if hydration or CSP fails, and apply the fallback before building further.**

US1 alone gives readable pages, but don't release it to Google yet. Without US2, unknown addresses still answer 200 and there's no site map.

### Incremental Delivery

- **First release to search engines**: US1 + US2.
- **Next**: US3, for city searches.
- **Then**: US4, for link previews. It's small and could go in earlier.
- Each story can share the second PR or have its own. A release needs T068 for pages to stay current.

### Task Counts

| Phase | Tasks |
|-------|-------|
| API addition | 5 |
| Foundational | 12 |
| US1 | 18 |
| US2 | 14 |
| US3 | 13 |
| US4 | 5 |
| Polish | 10 |
| **Total** | **77** |
