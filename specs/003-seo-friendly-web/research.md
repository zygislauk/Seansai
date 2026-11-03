# Research: Findable in Search Engines

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-11-02

Findings marked **Verify** rest on documentation or reasoning and have not been tried here. The first
preview deployment has to confirm them ([quickstart.md §2](./quickstart.md)). Each has a fallback.

## 1. How pages get real content

- **Decision**: A static snapshot of every public page, rendered during a Vercel build that the daily
  refresh triggers.
- **Rationale**:
  - On Vercel the data changes once a day, so a daily snapshot matches how the data behaves.
  - Pages come from the CDN, with no cold start. Measured cold starts are about 2.35 s to first byte
    (002 research §5), which would otherwise hit rarely visited movie pages most of all.
  - Crawler traffic can't use up function or database allowances (FR-018).
  - A failed build leaves the last good deployment live, so pages can't become empty or "not found"
    because of a data failure. That satisfies the spec's edge case on the data service being down.
  - Removing a movie's file gives a real 404 with no runtime code.
- **Accepted trade-off**: a snapshot is only as new as the last refresh. Between refreshes:
  - Readers without scripts can see screenings that have already started, and, after midnight until the
    next refresh, a "today" that has become yesterday.
  - People and script-running crawlers aren't affected, because the app fetches current data on load.
  - The spec's edge case on started screenings was reworded to say so. FR-003 is still met, since it
    limits the snapshot's age relative to the data.
- **Alternatives considered**:
  - **Rendering each request in the API function, cached by the CDN**: always has the right "today",
    but cold starts land on the first byte of pages, crawlers spend function and database allowances,
    and the function has to bundle the web app's server build across two services. That bundling is
    unproven on Services, which are in Beta. It's the first thing to reconsider if the snapshot's
    "today" turns out to matter.
  - **React Router framework mode**: a rewrite of routing and build for one feature (Principle III).
  - **Title and description tags only, relying on Google to run scripts**: fails FR-001. Google itself
    still recommends server rendering or pre-rendering because ["not all bots can run
    JavaScript"](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics),
    and link previews don't run scripts.
  - **Generating pages on the Mac and uploading them**: needs a place to upload to, and the free-plan
    rule rules out Blob storage (002 hosting contract).

## 2. Rendering with the app's own code

- **Decision**: `vite build --ssr` builds `src/entry-prerender.tsx`. For each page it fills a
  `QueryClient` with that page's data, runs React Router's `createStaticHandler`, and calls
  `renderToString` on `StaticRouterProvider` with `hydrate={false}`.
- **Rationale**: This is React Router's documented data-mode route to server rendering. The router already
  uses data-mode routes, and its lazy routes are resolved by the handler.
- **Why the code is nearly ready**: `settings.ts` already survives missing `window` through its
  `try/catch`, the only other browser calls are inside effects, and `queryClient.query` returns cached
  data while it's fresh, so loaders make no request during rendering.
- **Stylesheets**: `build.cssCodeSplit: false` merges the five CSS files (about 5 kB compressed in
  total) into one linked from the page, so a snapshot is styled before any script runs. CSS module class
  names are stable between the client and SSR builds.
- **Verify**: `StaticRouterProvider`'s output hydrates against `RouterProvider` without a mismatch.
  **Fallback**: client-render every visitor, keeping the snapshot visible until the router is ready.

## 3. Where a build gets its data

- **Decision**: The build reads the public production API, at `${SITE_URL}/api/v1`, validated with the
  shared schemas.
- **Rationale**: The web build needs no database credentials, and it exercises the same contract as the
  browser. Importing the API in-process would run database migrations during a build, before that
  deployment was known to be good.
- **Consequences**:
  - **API changes must be additive and live first**. A build validates against production's API, not its
    own commit's. Hence the [rollout order](./plan.md#rollout-order).
  - **Previews show production data**, not `seansai-preview`, in their snapshot. Their app still calls
    their own API after load. Previews are not listed, so this is harmless.
  - **The CDN must be bypassed**: API responses are cached for 5 minutes per URL including its query
    string (002 research §5), so a build right after a refresh could read old data. Requests add
    `?snapshot=<build time>`, which the API's schemas ignore.
- **Safety**: the build fails if the general movie list comes back empty, or if any request fails after
  retries. Otherwise one bad response could publish a site of 404s and get pages removed from Google.

## 4. Triggering the build

- **Decision**: After a refresh in which at least one source succeeded, `POST` to a [Deploy
  Hook](https://vercel.com/docs/deploy-hooks) for `main`, from both refresh routes (home job and
  `/api/v1/cron/daily`). The URL is an optional setting, `VERCEL_DEPLOY_HOOK_URL`.
- **Rationale**: Hooks are free, limited to 60 calls an hour, and need no credentials except the URL.
  Repeat calls cancel earlier builds. Hobby allows 100 deployments a day.
- **Failure handling**: a failed hook call is retried once after 30 s, to cover a brief network problem just
  after the Mac wakes. A second failure is logged as an error and doesn't fail the refresh, since the data is
  saved and the app shows it. Pages stay at the earlier snapshot until the next refresh, as FR-003 allows.
  A failed build shows only in Vercel, so the `lastmod` values in `/sitemap.xml` are the check for it
  (quickstart §4).
- **Side effects**: every hook call deploys the latest `main`, so any merged change goes live by the next
  morning at the latest. A rollback stops those deployments going live until it's undone (corrected
  2026-11-03 from [Vercel's docs](https://vercel.com/docs/instant-rollback); this first said the next hook
  call would overwrite it). The runbook is in the README.

## 5. Security headers and embedded data

- **Decision**: Embed page data in `<script type="application/json">`. The CSP stays as it is.
- **Rationale**: That type is a data block, not executed, so `script-src 'self'` doesn't apply to it.
  **Verify** in Playwright that the browser reports no CSP violation.
- **Escaping**: movie titles and other text come from cinema websites. All JSON written to HTML escapes
  `<`, `>`, `&` and U+2028/9, and every attribute is HTML-escaped. A unit test feeds in a title
  containing `</script>`.

## 6. Addresses and responses on Vercel

- **Decision**:
  - Pages are written as `dist/{lang}/.../index.html`, and the web service drops its catch-all rewrite to
    `index.html`.
  - `dist/404.html` is a copy of the app shell, so people on an unknown address still get the app's
    not-found page, and a person who opens a new movie before its page exists still gets the movie.
  - `/` redirects with `redirects` in `vercel.json`: a rule matching the `seansai_lang` cookie first, then
    Lithuanian. Temporary, because the destination varies by visitor.
  - Unknown two-letter language prefixes redirect permanently to `lt`. Other unknown addresses are 404.
- **Evidence**: Vercel [documents](https://vercel.com/kb/guide/custom-404-page) serving a `404.html` from
  the output directory.
- **Verify**:
  - `404.html` answers with status 404 inside a Services web service. **Fallback**: a service-level
    rewrite to `/404.html` with `statusCode: 404`. Rewrites only apply once no file matches. The fallback
    was needed: see below.
  - Paths with non-ASCII ids are served from their directories: 8 of today's 216 movies have such ids,
    for example `was-marielle-weiß` and `спеціальна-операція`. **Fallback**: they get 404 with a working
    page for people and are left out of the site map until fixed.
- **Language cookie**: `seansai_lang`, written when someone uses the language switch, and at startup when
  localStorage already holds a language (owner, 2026-11-03). It holds a preference and identifies no one.
  Without the startup copy, visitors who chose a language before this ships would land on Lithuanian from `/`
  on every visit until they next used the switch. With it, that happens at most once.

### Measured on the first preview (2026-11-03)

The preview's snapshot was built on Vercel from production's API, in 51 s of build time. All **Verify** items for
US1 held, so no fallback was needed:

| Check | Result |
|-------|--------|
| `StaticRouterProvider` output hydrates against `RouterProvider` (§2) | Yes, in Chromium: the snapshot's DOM is kept, the app responds, and the console is clean |
| Embedded JSON under the CSP (§5) | No violation, with the production CSP sent by Vercel |
| Non-ASCII movie addresses (§6) | 200 for `was-marielle-weiß` (percent-encoded) and a Cyrillic id |
| A movie with a 102-character id | 200, after raising the API's limit on ids (found by the first real build, and fixed first in its own PR) |

The 404 status and page, the redirects and `X-Robots-Tag` depend on `vercel.json` changes in US2, so they're measured below.

**On previews only**, a movie missing from the preview's database shows "Movie not found" once the app takes
over, because the snapshot comes from production's data and the app calls the preview's own API (§3). That day
the two shared 155 movies of about 215. Production's snapshot and API read the same data.

A full build from production's data wrote 434 pages. The largest list page was 26.9 kB and the largest movie
page 8.5 kB compressed, against budgets of 80 kB and 40 kB, with no duplicate titles or descriptions.

### Measured on the US2 preview (2026-11-03)

Measured with `vercel curl` and in Chromium under the real CSP, on a remote build of the final `vercel.json`. The
exceptions are `sitemap.xml` and `robots.txt`, last checked on a local build of it, and the site map's count and
`/api/v1/nope`, last checked on an earlier preview of this branch.

**`404.html` isn't used on its own.** Without a rule, an unknown address answered 404 with Vercel's plain
`NOT_FOUND` text, even though Vercel's guide says an emitted `404.html` is served automatically. The web service
therefore has `{ "source": "/(.*)", "destination": "/404.html", "statusCode": 404 }`.

Rejected, after trying it: service-level `routes` with `{ "handle": "filesystem" }` and a 404 rule, which Vercel's
own 404 guide recommends. Vercel's `vercel.json` reference marks `handle` as deprecated in favour of rewrites, so
Constitution VIII rules it out. It also silently dropped the service's `headers`, though the reference says the two
can be used together: every page lost its CSP and assets lost their long cache lifetime, with no build error. So
`tests/unit/vercel-config.test.ts` rejects `routes` on this service. `statusCode` on a rewrite is in Vercel's
[published schema](https://openapi.vercel.sh/vercel.json), though not in the reference's prose. It compiles to the
same rule after the filesystem check.

Testing tip: a `vercel deploy --prebuilt` of a build made on this Mac answers 500 from the API, while a remote build
of the same code doesn't. The likely cause is a native module built for macOS, though that wasn't confirmed.

| Check | Result |
|-------|--------|
| `/lt/nonexistent`, `/lt/movie/no-such-movie-2026` | 404, `text/html`, with `404.html`'s content and all security headers |
| The same in a browser | The app's not-found page, `noindex` kept, no canonical link, clean console |
| A movie in the database with no page in the snapshot (`instruktorius`) | 404 for crawlers. A person sees the movie, `noindex` is removed, and it names its own address |
| `/`, and `/` with `seansai_lang=lt` | 307 to `/lt/` |
| `/` with `seansai_lang=en` | 307 to `/en/` |
| `/de/movie/x`, `/de` | 308 to `/lt/movie/x`, `/lt/`. Query strings are kept |
| `/lt/`, a movie, `sitemap.xml`, `robots.txt` | 200 with all security headers. `application/xml` and `text/plain` for the last two |
| `/assets/*` | `public, max-age=31536000, immutable`. A missing asset's 404 gets this too, which only matters if a rollback brings that file name back |
| `/api/v1/cities`, `/api/v1/nope` | `noindex` on both, as a 200 and a JSON 404 |
| `X-Robots-Tag` on the preview's pages | `noindex`, sent by Vercel. Production is checked at T067 |
| `sitemap.xml` | 434 addresses, the same pages as the snapshot |
| Language in a browser | No cookie before a choice. The switch writes it. A language already in localStorage is copied at startup, `Secure`, `Lax`, for a year. `/` then goes to `/en/` |

Redirects are answered before the web service's routes, so they carry no security headers. They have no content
to protect.

## 7. Search-engine rules that shaped the design

- **Don't block the API in robots.txt**: Google says not to block resources a page needs, and that
  [robots.txt doesn't keep URLs out of search](https://developers.google.com/search/docs/crawling-indexing/robots/intro).
  If `/api/` were blocked, Google's rendering would see failed background requests. `detail.isError` is
  true after a failed refetch even with data, so the page would show its error state to Google. So:
  - robots.txt allows everything and names the site map.
  - API responses send `X-Robots-Tag: noindex`.
  - Pages show the error state only when they have no data at all. This also helps people on poor
    connections.
  - This changed the spec's FR-011.
- **Language links** ([Google](https://developers.google.com/search/docs/specialty/international/localized-versions)):
  each version lists itself and the other, with full addresses, and the set is reciprocal. `x-default`
  points at the Lithuanian page.
- **Other copies of the site**: Vercel sends [`X-Robots-Tag:
  noindex`](https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines) on preview
  deployments and on earlier production deployments, so FR-016 needs no code there. The self-hosted server
  sends the same header. **Verify** on the current production deployment's own unique URL. Canonical
  links cover it either way.
- **Owner verification**: a URL-prefix property in Search Console can be proved with a file or a meta tag,
  which fits a `vercel.app` address where DNS isn't available (FR-021).

## 8. Structured data: left out

- **Decision** (owner, 2026-11-02): No `Movie` or `ScreeningEvent` data on pages. User Story 5, FR-019 and
  SC-009 were removed from the spec.
- **Rationale**: Google's [event rich results](https://developers.google.com/search/docs/appearance/structured-data/event)
  are limited to a list of regions and languages that **doesn't include Lithuania or Lithuanian**, and
  "only support pages that focus on a single event", while a movie page lists many screenings. It would give
  no visible Google benefit today (Principle III).
- **Alternative considered**: Adding it anyway for other search engines, since the data is in hand. It can
  be added later without changing anything else, if Google's coverage changes.

## 9. First visit

- **Decision**: `useCity` returns the effective city, `all` when nothing is remembered, plus whether one was
  chosen. A new `CityChoice` organism appears at the top of the page when none was. It offers "Choose city",
  which opens the existing dialog, and "Keep all of Lithuania", which remembers `all`.
- **Why it isn't a dialog**: Google warns against intrusive pop-ups, and a dialog would take focus away from
  what a searcher came to read. It's normal page content in reading order, so it's read and reached with the
  keyboard like anything else.
- **Stored city no longer supported**: only the pages can tell, from the API's `invalid_city` error, so `useCity`
  can't decide this alone. The page calls `forgetCity`, which clears the stored city and removes any `?city=`
  from the address. The visitor is then in the first-visit state. A `/{lang}/city/{cityId}` address with an
  unknown city is different: it's the not-found page.

## 10. Returning visitors and the first paint

- **Decision**: `boot-gate.js`, a small blocking script in `<head>`, sets `data-boot="client"` on `<html>`
  when the address has a query string, when localStorage holds a city, or when the snapshot's date isn't
  today in Vilnius. CSS hides `#root` in that state. `main.tsx` reads that attribute: unset means
  `hydrateRoot`, set means `createRoot`, and it removes the attribute when the first render commits, so
  `#root` is shown again.
- **Rationale**: Without it, a returning Vilnius visitor sees all of Lithuania's movies flash before their
  own. With it, they get what they get today, and first-time visitors get the snapshot straight away.
- **Query strings**: a snapshot only ever holds the plain page, so a link with `?date=`, `?city=` or a filter
  would otherwise show the wrong content and then fail to hydrate. Any query string counts, even ones the app
  ignores such as `fbclid`, which keeps the rule simple. Those visitors get what they get today.
- **Comparison**: `main.tsx` has only one source for the decision, so the two can't disagree. `hydrateRoot`
  falls back to a client render if there's a mismatch (for example if Node and the browser format a date
  differently), and `onRecoverableError` logs it. Playwright fails on any such message.
- **Without scripts**: the gate doesn't run, so the content stays visible.
- **Testing the snapshot locally** (measured 2026-11-02 on Vite 8.3.5 with a throwaway site): `vite preview` in
  `mpa` mode answers 404 for `/lt/movie/x` when the file is `lt/movie/x/index.html`, though `/lt/movie/x/`
  works. A `configurePreviewServer` middleware that adds the slash when the path is a directory made it answer
  200, including with a query string and a percent-encoded non-ASCII id, while unknown addresses stayed 404. This
  is about Vite's preview server only: Vercel's behaviour for such paths is still checked on the first preview.

## 11. City pages

- **Decision**: `/{lang}/city/{cityId}`, mirroring `/{lang}/movie/{movieId}`, using existing city ids. The
  page's city comes from the address and is saved as the remembered city. Choosing another city navigates
  to that city's page.
- **Lithuanian grammar**: "Kino seansai Vilniuje" needs the locative, which the data doesn't have. `lt.ts`
  gets a map of the 7 current cities. A city not in the map falls back to "Kino seansai: {name}", and a test
  reports any registry city missing from the map.
- **Discovery**: the general list page links to every city page, and the site map lists them. A city's
  own link appears only while it has movies.
- **Knowing which cities have movies**: `/cities` gains `hasMovies`, so the snapshot and the running app show
  the same links (FR-002). The field has to be live before the code that reads it (§3). Rejected:
  - Fetching all 5 city lists on each visit loads data that isn't shown (Constitution VI).
  - Working it out only in the snapshot makes the links differ once the app takes over.
  - Linking every supported city needs no API change, but sends crawlers to empty pages.

- **Rows read by `hasMovies`** (measured with `.scanstats` on a local copy of the 7,000-screening test
  database, with 18 cinemas plus one with no screenings; Turso's own counter wasn't used). The query stops at
  each cinema's first screening:

  | | Rows read per call | Worst case a month, each URL missing the 5-minute cache every time |
  |---|---|---|
  | Existing indexes only | ~62,000 | ~1,070 M, over the 500 M allowance |
  | New index `(cinema_id, starts_at)` | 18 | ~0.3 M, under 0.1% |

  The worst case is 2 URLs × 288 misses a day × 30 days. Real traffic misses less often, but the first row
  has too little margin even so, so migration 5 adds the index. It costs about 320 kB at that size and one
  more index to write on each daily refresh, against 002's ~2% of the rows-written allowance. Rolling back is
  safe: older code ignores the index.
- **Effect on the movie list**: `/movies` now searches the new index. With a full fortnight ahead that's
  about the same rows (6,928 against 7,000). Time was about the same in one measurement and a few ms slower in
  another, both well within the 50 ms budget.
  It reads less later in a schedule's life, once more screenings have started.

## 12. Things found in the data

- **Duplicate titles**: "Čarlis ir Harper" has 3 ids today (`carlis-ir-harper`, `charlie-harper-2025`,
  `charlie-harper-2026`). That's the known split-films problem from feature 001, and it affects SC-002.
  Titles add the year where known, and descriptions include where it's showing. Identical titles can still
  occur for a record with no year and the same places. In that case merging the records is the right fix,
  so the build logs a warning naming them rather than disguising them, and doesn't fail
  ([contract](./contracts/snapshot.md#failing-safely)).
- **No synopses**: descriptions are composed from title, year, genres and where and when it's showing.
- **Posters**: 28 of 216 have none, so they use the default preview image.

## 13. Measured budgets (2026-11-03)

From the preview of commit `3b1bef2`, whose snapshot was built on Vercel from production's API and has 442
pages. Compressed sizes are gzip of what the preview served. Movie pages are a sample of 10, as the build
itself fails any page over budget, and it passed.

| Budget (plan.md) | Target | Measured |
|------------------|--------|----------|
| List page, compressed | ≤ 80 kB | 27.5 kB (`/lt/`), 23.7 kB (`/lt/city/vilnius`), 3.7 kB (the smallest city page) |
| Movie page, compressed | ≤ 40 kB | 7.5 kB at most in the sample |
| JavaScript on first visit, compressed | ≤ 150 kB | 140.3 kB |
| Rendering all pages in a build | < 3 min | About 29 s, reading production's API |
| Whole build, then deployed | No target | 41 s, deployment finished 50 s after the build started |

No duplicate title or description warnings in that build's log (SC-002). The 10-minute target from refresh
to live can only be measured once the hook exists (T068). First paint (SC-007) is measured on production
(T067).

Quickstart §1 also passed by hand against the fixture data on 2026-11-03: content straight away, the
non-blocking choice, choosing a city going to its page, no flash after a reload, and nothing in the console.
The fixture data is older than today, so that browser run took the client-render path. Hydration is covered
by `seo.spec.ts`, whose tests fix the clock.
