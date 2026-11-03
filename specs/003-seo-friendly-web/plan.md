# Implementation Plan: Findable in Search Engines

**Branch**: `003-seo-friendly-web` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-seo-friendly-web/spec.md`

## Summary

Search engines and link previews should get real pages, not an empty shell followed by a city
prompt. The schedule data changes once a day, so the pages become a **daily static snapshot**:

- **Snapshot**: when the daily refresh finishes, it calls a Vercel Deploy Hook. The new build renders
  every public page to static HTML with the app's own React components, using data from the public
  API. Pages are served by the CDN, so crawlers never reach a function or the database.
- **Pages**: each page carries its own title, description, preferred address, language links and
  preview tags. Each language gets one list page per city, at `/{lang}/city/{cityId}`.
- **Taking over in the browser**: first-time visitors' pages are hydrated from data embedded in the
  page. Returning visitors with a remembered city, links with a query string, and visitors to a page
  from an earlier day get a normal client render, as they do today.
- **First visit**: the blocking city dialog is replaced by a choice that doesn't block the page, with
  all of Lithuania shown meanwhile.
- **Real responses**: `/` and unknown languages redirect in the response. Unknown addresses answer
  404, using a page that still boots the app. Search engines get a robots file and a site map.
- **Self-hosting**: nothing is snapshotted. The container keeps working as a single-page app and asks
  not to be listed.

Reasoning and alternatives are in [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 24, unchanged

**Primary Dependencies**: unchanged, and no new packages. `react-dom/server`, React Router's
`createStaticHandler` and `StaticRouterProvider`, TanStack Query's `dehydrate` and `hydrate`, and Vite's
SSR build are all parts of what's already installed.

**Storage**: no schema change. The snapshot is static files inside each deployment.

**Testing**:
- Vitest for page descriptions, the site map, escaping, the API addition and hosting config.
- Playwright against a real snapshot built from the fixture API: content without scripts, status codes,
  hydration without errors, the first-visit flow, and accessibility. It's served with `vite preview`,
  set to `appType: 'mpa'` for preview only, because the development server still needs its fallback to
  `index.html`, plus a small preview-only plugin for directory addresses (research §10).
- Manual checks on the first preview and on production ([quickstart.md](./quickstart.md)).

**Target Platform**: Vercel Hobby, as in 002. The web service stays static, and the API stays one
function. The Docker container stays supported, without a snapshot.

**Project Type**: Web application (npm workspaces: `apps/api`, `apps/web`, `packages/shared`), unchanged

**Performance Goals**:

| Budget | Target |
|--------|--------|
| Main content visible (SC-007), 75% of visits on a typical phone connection | < 2.5 s |
| Time to first byte for pages, from the CDN | No function in the path |
| Compressed HTML: movie page / list page | ≤ 40 kB / ≤ 80 kB |
| JavaScript on first visit (existing budget, build-checked) | ≤ 150 kB compressed |
| Rendering all pages in a build | < 3 min |
| From refresh finished to snapshot live (FR-003 allows 1 hour) | < 10 min |

**Constraints**:
- Free plans only (002 FR-011): Hobby allows 100 deployments a day, and this adds about 1.
- The Content-Security-Policy stays strict, with no inline scripts (research §5).
- Text from cinemas is untrusted and is always escaped in the HTML and JSON written to pages.

**Scale/Scope**: about 448 pages today: 216 movies, 7 city lists and 1 general list, each in 2
languages. Load stays at feature 001's 1,000 visitors a day, plus crawlers. Up to 5,000 page fetches a
day is assumed.

### Usage against free allowances

| Allowance | Added by this feature | Share |
|-----------|-----------------------|-------|
| Deployments, 100 a day | 1 a day, plus pushes | ~1% |
| Function invocations, 1 M a month | About 450 API calls per build ≈ 13.5 k a month | ~1.4% |
| Fast Data Transfer, 100 GB a month | 5,000 pages a day × ~30 kB ≈ 4.5 GB a month | ~4.5% |
| Active CPU, 4 h a month | Pages use none; the build's API calls ≈ 2 min a month | < 1% |
| Turso rows read, 500 M a month | One snapshot a day, roughly 250 k rows ≈ 8 M a month | ~2% |

These are estimates from 002's measured figures. Crawlers rendering pages with JavaScript also call the
API, and those calls are absorbed by the CDN's existing 5-minute cache.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| I. Code Quality | Existing lint, format and type checks apply to the new code. A failed snapshot fails the build, so the last good deployment stays live. A failed hook call is logged and never hides a successful refresh. | ✅ |
| II. Readability First | Page descriptions are one pure module. Snapshot code sits with the other web build scripts. *Why* comments cover the non-obvious choices, such as the cache-busting parameter and robots rules. | ✅ |
| III. Simplicity | No new packages, server or service. Pages are static files, and the only new runtime path is hydration. Added parts are recorded under Complexity Tracking. | ✅ |
| IV. Testing (NON-NEGOTIABLE) | Unit, integration and end-to-end tests cover each story. CI builds a real snapshot from fixtures. | ✅ |
| V. Great UX | The first visit no longer blocks reading. Returning visitors see no flash of another city's content. Page titles improve for screen-reader users too. Accessibility scans extend to the new states. | ✅ |
| VI. Performance | Budgets above, with HTML sizes checked in the build. Pages come straight from the CDN. | ✅ |
| VII. Scalability | Expected load above. The first bottleneck at 10× is below, and page traffic is stateless by design. | ✅ |
| VIII. Conventions | React Router's documented data-mode rendering and React's `hydrateRoot`. Existing folder layout, naming and Conventional Commits. | ✅ |
| Quality Standards | The hook URL is a secret, kept only in environment settings and never logged. Cinema-supplied text is escaped. Refresh and snapshot outcomes are logged. | ✅ |

**Spec changes made during planning** (owner approved, 2026-11-02):
- FR-011 no longer tells crawlers to stay out of the data service. Blocking it would break their
  rendering of pages, so its addresses are marked "don't list" instead (research §7).
- The edge case on started screenings now says readers without scripts may see them until the next
  refresh, which is what a daily snapshot does (research §1).
- User Story 5, FR-019 and SC-009 are removed, as structured data would bring no visible Google benefit
  in Lithuania today (research §8).

**Post-design re-check (after Phase 1)**: still passing. The one contract change to feature 001's API
is additive (`showingAt`), and it has to be live before the snapshot code is deployed (research §3).

### Scalability check (10×: ~10,000 visitors a day, ~1,000 concurrent)

| Resource | At 10× | First to break? |
|----------|--------|-----------------|
| Fast Data Transfer, 100 GB a month | ~150 GB from visitors (002's 0.5 MB each), plus crawlers | **Likely first** |
| Vercel Active CPU, 4 h a month | Same as 002: API calls from visitors, about 1.5–3 h a month. Pages add nothing. | Second |
| Deployments and builds | Unchanged | No |

The first bottleneck at 10× is data transfer, so 002's scalability check no longer names the right one. The
fixes are lighter pages or moving to Pro, with no rewrite.

## Project Structure

### Documentation (this feature)

```text
specs/003-seo-friendly-web/
├── plan.md              # This file
├── research.md          # Decisions and alternatives
├── data-model.md        # Page description, snapshot, API addition
├── quickstart.md        # How to validate it
├── contracts/
│   ├── web-pages.md     # Addresses, responses, head tags, site map, robots
│   └── snapshot.md      # Build and deploy-hook behaviour, hosting changes
└── tasks.md             # Created by /speckit-tasks
```

### Source Code (repository root)

```text
apps/web/
├── public/                     # Site icon, default preview image, boot-gate.js, owner verification file
├── scripts/
│   ├── build-paths.ts          # New: the build's output folder, for the three build scripts
│   └── prerender.ts            # New: fetch data, render pages, write HTML, site map, robots, 404
├── src/
│   ├── entry-prerender.tsx     # New: renders one page to HTML with the app's routes
│   ├── main.tsx                # Chooses hydrate or client render
│   ├── app/
│   │   ├── router.tsx          # Adds the city page route
│   │   └── city.tsx            # City from the address; "all" until one is chosen
│   ├── lib/
│   │   ├── site.ts             # New: the one public address (FR-022)
│   │   └── page-head.ts        # New: title, description, links, preview tags
│   ├── components/organisms/
│   │   └── CityChoice/         # New: the non-blocking first-visit choice
│   ├── pages/                  # Use page descriptions; movie summary; city page
│   ├── i18n/                   # New texts and Lithuanian city forms ("Vilniuje")
│   └── storage/settings.ts     # Also writes the language cookie
└── tests/                      # New unit tests and e2e/seo.spec.ts

apps/api/src/
├── routes/movies.ts            # Adds showingAt
├── routes/cities.ts            # Adds hasMovies
├── db/queries.ts               # One query for the cinemas showing a movie
├── refresh/deploy-hook.ts      # New: asks Vercel to rebuild after a refresh
├── refresh-now.ts, routes/cron.ts  # Call it after a refresh
└── server.ts                   # X-Robots-Tag on the API, and on self-hosted pages

packages/shared/src/api.ts      # showingAt on MovieDetailResponse, hasMovies on CitiesResponse
vercel.json                     # Redirects, no fallback to index.html
```

**Structure Decision**: The existing monorepo is unchanged. Rendering lives in `apps/web`, because it
uses that app's components and stylesheets. It reaches data only through the public API, so the web
build needs no database access or credentials.

## Rollout Order

1. Add `showingAt` to the API and merge it. Builds read the production API, and `MovieDetailResponse`
   must include the field before the snapshot code can validate it.
2. Add `hasMovies` to `/cities` and merge it, before any build reads it (US3).
3. Merge the snapshot, pages and first-visit change.
4. Create the Deploy Hook and put its URL in the home job's `refresh.env` and in Vercel's Production
   environment, so that both refresh routes can call it.
5. Register the site with Google Search Console and submit the site map. This is the owner's step.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| A second Vite build and a snapshot script | FR-001 and FR-002 need real content that matches what people see, and rendering the app's own components is the only way to keep the two equal | A separate plain-HTML template would drift from the app. Title and description tags alone don't meet FR-001. |
| A deploy hook after each refresh | The snapshot has to follow the data (FR-003, SC-004) | A fixed daily schedule could run before the refresh, because the refresh time depends on when the Mac wakes |
| Two ways of starting the app (hydrate or client render) | Returning visitors see a different city from the snapshot | Hydrate-only would show another city's movies before correcting them. Client-render-only recreates the page, including its images, for every new visitor. |
| A small blocking script, `boot-gate.js` | Hides snapshot content before first paint when it isn't for this visitor | The CSP forbids inline scripts, which would be the usual way, and relaxing it weakens the site's security. |
| A language cookie alongside localStorage | `/` must redirect in the response (FR-014) and still honour a remembered language, and only a cookie reaches that rule | Always redirecting to Lithuanian would drop the remembered language, which FR-014 requires keeping |
