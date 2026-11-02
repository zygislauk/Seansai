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
- **Failure handling**: a failed hook call is logged as an error and doesn't fail the refresh, since the
  data is saved and the app shows it. Pages stay at the earlier snapshot until the next refresh.
- **Side effects**: every hook call deploys the latest `main`, so any merged change goes live by the next
  morning at the latest. A rollback made in the dashboard is overwritten by the next hook call, so
  rolling back needs the code reverted too. This goes in the runbook.

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
  - `404.html` answers with status 404 inside a Services web service. **Fallback**: service-level
    `routes` with `{ "handle": "filesystem" }` and `{ "src": "/.*", "status": 404, "dest": "/404.html" }`.
  - Paths with non-ASCII ids are served from their directories: 8 of today's 216 movies have such ids,
    for example `was-marielle-weiß` and `спеціальна-операція`. **Fallback**: they get 404 with a working
    page for people and are left out of the site map until fixed.
- **Language cookie**: `seansai_lang`, written only when someone uses the language switch. It holds a
  preference and identifies no one. Visitors who chose a language before this ships have it in
  localStorage only, and `/` sends them to Lithuanian once; the site has been public for days.

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
- **Stored city no longer supported**: treated as nothing remembered, so it's a first visit.

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

## 12. Things found in the data

- **Duplicate titles**: "Čarlis ir Harper" has 3 ids today (`carlis-ir-harper`, `charlie-harper-2025`,
  `charlie-harper-2026`). That's the known split-films problem from feature 001, and it affects SC-002.
  Titles add the year where known, and descriptions include where it's showing. Identical titles can still
  occur for a record with no year and the same places. In that case merging the records is the right fix,
  so the site map check reports them rather than disguising them.
- **No synopses**: descriptions are composed from title, year, genres and where and when it's showing.
- **Posters**: 28 of 216 have none, so they use the default preview image.
