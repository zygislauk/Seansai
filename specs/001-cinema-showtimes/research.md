# Research: Cinema Showtimes Aggregator

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-30

All findings below were verified against the live sites on 2026-10-30 unless stated otherwise.

## 1. Cinema data sources

The spec assumes each cinema publishes its schedule publicly and that collecting it is acceptable
(Assumptions → *Data availability*). Each source was checked for a machine-readable feed and for
its `robots.txt` rules.

| Cinema | Cities (verified) | Source | Format | robots.txt | Verdict |
|--------|-------------------|--------|--------|------------|---------|
| Apollo Kinas | Vilnius (Akropolis, Outlet), Panevėžys (Molas) | `https://www.apollokinas.lt/xml/` (Markus Cinema System feed: `TheatreAreas`, `ScheduleDates`, `Schedule?area=&dt=&nrOfDays=`, `Events`) | JSON | Only `/websales/`, `/account/`, `/mypage/` disallowed | ✅ Use |
| Forum Cinemas | Vilnius (Vingis), Kaunas, Klaipėda, Šiauliai | `https://restapi.forumcinemas.lt/api` (`/region`, `/cinema`, `/region/{id}/screening?dateTimeFrom=&dateTimeTo=`, `/movie`, `/movie/{id}`, `/cinema/{id}/screen`) — the public API behind their own website (its `config.json` names this `apiUrl`) | JSON | No robots.txt (404); main site allows all | ✅ Use |
| Pasaka | Vilnius (Paupio, Senamiesčio; seasonal Kalnų parko estrada) | `https://bilietai.kinopasaka.lt/xml/` (same Markus Cinema System feed as Apollo) | XML | Allows `*`; blocks named AI/training bots only; `Content-Signal: search=yes` | ✅ Use (same adapter as Apollo) |
| Skalvija | Vilnius | `https://skalvija.lt/wp-json/data/v1/get_shows` (WordPress endpoint used by their site) | JSON, but prefixed with PHP warnings | Allows all | ✅ Use, tolerant parsing; title + start + ticket URL only (no format/language) |
| Atlantis | Šiauliai | Server-rendered movie pages `https://atlantiscinemas.lt/filmai` → `/filmai/{slug}` (several days of screenings in the HTML, `<time datetime>` + `/kasa/seansas/{id}` links) | HTML | Main site allows all except `/checkout/`, `/kasa/`; its backend `back.atlantiscinemas.lt` disallows all | ✅ Use HTML pages only; never call the backend |
| Vue (formerly Multikino; `multikino.lt` → `vuekinas.lt`) | Vilnius | `https://vuekinas.lt/data/locations/` (cinema id `1001`) and `/data/filmswithshowings/{cinemaId}` (films with dated showings, hall, format, ticket link) | JSON | **`/data/`, `/api/`, `/iapi/`, `/restapi/` disallowed** | ⚠️ Included by owner decision (§1b) |

**Decision**: Ship all six cinemas from this list plus the additional venues found in §1a. Vue is
included by the project owner's decision despite its `robots.txt` (see §1b for the conditions).

**Rationale**: Every included source is either a documented-style public feed or the public API
that the cinema's own website uses, and none is disallowed by `robots.txt`. Vue explicitly
disallows automated access to its schedule data, so using it would ignore the operator's stated
wishes.

**Alternatives considered**:
- *Headless-browser scraping of Vue's rendered page*: still fetches the disallowed `/data/` URLs
  under the hood; rejected.
- *Third-party showtime aggregators (e.g., paid showtime APIs)*: coverage of small Lithuanian
  venues (Skalvija, Pasaka, Atlantis) is doubtful and costs money; rejected for v1.

### 1a. Additional venues (not in the user's original list)

Searched for other regularly operating cinemas in Lithuania (chain sites, Europa Cinemas network
members, regional cinema reports) and checked each one's website and `robots.txt` on 2026-10-30.

| Venue | City | Why it matters | Source | robots.txt | Verdict |
|-------|------|----------------|--------|------------|---------|
| Kauno kino centras **Romuva** | Kaunas | Oldest working cinema in Lithuania; Kaunas' main arthouse cinema (Europa Cinemas member) | `https://bilietai.kcromuva.lt/` embeds its full calendar as a JSON array (`title`, `start`, `url`) | Allows all | ✅ Add (new small adapter) |
| Kino centras **Garsas** | Panevėžys | Panevėžys' arthouse cinema (Europa Cinemas member since 2009) | Ticket shop `https://bilietai.garsas.lt/filmai` uses the **same Fliko site template as Atlantis** | Allows all except `/checkout/`, `/kasa/` | ✅ Add (reuses Fliko adapter) |
| **Cinamon Mega** | Kaunas | Second multiplex in Kaunas (mainstream releases) | Page state holds today's sessions (`showtime: "YYYY-MM-DD HH:MM:SS"`, cinema `pid` `77139293`); the site's app loads pages from `https://cinamonkino.com/api/page/{name}?cinema_id=&timezone=&locale=` (inferred from its JS bundle, **not yet verified**) | `/api/` disallowed | ⚠️ Included by owner decision (§1b) |
| **Dainava** | Alytus | Listed as operating in regional-cinema reports | No online schedule or ticket shop found | — | ❌ Not possible without a public schedule |

Not added: one-off or seasonal screening venues (e.g., cultural centres with occasional film
nights, outdoor summer cinemas), because they are not regular cinemas; they can be added later if
users ask for them.

**Decision**: Add Romuva and Garsas to v1. Garsas needs no new code
(the Fliko adapter, renamed from "atlantis"), and Romuva needs one small adapter. Cinamon Mega is
also included, by owner decision (§1b).

**Rationale**: Romuva and Garsas are the main arthouse cinemas in Lithuania's 2nd and 5th largest
cities, so leaving them out would leave gaps in Kaunas and Panevėžys. Reusing the Fliko adapter
makes Garsas nearly free to support.

**Alternatives considered**: for Cinamon, evaluating the embedded page state (allowed path) gives
today's screenings only and requires deeply parsing minified scripts; kept only as a fallback if
the page API cannot be used.

### 1b. Owner decision: include Vue and Cinamon Mega (2026-10-30)

The project owner decided to include Vue and Cinamon Mega although their `robots.txt` disallows
the data paths, after reviewing the legal notes in this document's follow-ups (not legal advice).
Conditions, so the decision stays low-risk and reversible:

- Each of the two sources has `robotsOverride: true` with a written reason in the source config;
  every override is logged at startup. All other sources keep strict `robots.txt` checks.
- **No circumvention**: on HTTP 401/403/429, a CAPTCHA page, or any other sign of blocking, the
  adapter stops, the source is marked failed (FR-015), and it is not retried until the next cycle;
  no IP rotation, header spoofing or browser emulation.
- Same politeness as other sources: identifying `User-Agent` with contact, hourly at most,
  sequential requests with delay.
- Only facts are stored (titles, times, hall, format, language, ticket link). No synopses or other
  copyrighted text from these two sites; posters are linked, not copied.
- A kill switch (`DISABLED_SOURCES=vue,cinamon`) disables them without a deploy.
- The permission emails to Vue and Cinamon stay on the follow-up list; if either refuses, the
  source is disabled.

**Operational rules for all sources** (good-citizen collection):
- Identify the client with a descriptive `User-Agent` that includes a contact address.
- One refresh cycle per source per hour, requests sent sequentially per source with a small delay.
- Never request ticket-sale paths (`/websales/`, `/kasa/`, `/checkout/`); only link users to them.
- Re-check each source's `robots.txt` at startup and once a day; skip a source whose rules start
  disallowing the paths used, and flag it as unavailable (FR-015) — except sources with an
  explicit owner override (§1b).

**Follow-ups (not blocking)**:
- Email each cinema to say what Seansai does and that it links back for ticket sales; ask Vue and
  Cinamon for permission or a feed. The EU *sui generis* database right can apply to collected listings, so
  explicit permission is the safest basis long-term. This is a risk note, not legal advice.

### Source data quirks found

- **Forum**: the `/cinema` endpoint reports Vingis' city as "Kaunas" although its address
  (Savanorių pr. 7) is in Vilnius → city assignment comes from our own cinema registry, not the
  feed. A "Sandėlys" region exists without a matching cinema → ignored unless it has screenings,
  then mapped via the registry. The API host has no robots.txt (404), but its error page fails
  with HTTP 500 when the request says `Accept-Language: *` (the default of Node's `fetch`); a 5xx
  robots.txt means "disallow everything" (RFC 9309), so the polite client sends
  `Accept-Language: lt` (found 2026-10-31). Screenings carry no ticket link: the site opens
  `https://forumcinemas.lt/lt/ekranas/?id={screeningId}&cid={cinemaId}`. One `/movie` request
  lists the movies (121 of 122 on 2026-10-31); only missing ones are fetched one by one. Hall
  names come from `/cinema/{id}/screen`, whose answer includes seat maps (~0.6 MB), so they are
  fetched once a day. Titles carry programme labels and version notes ("SCA'26: Išganymas",
  "Pamatyk kine: Kiti (2001)", "Užmirštoji sala (dubliuotas)"), which the adapter drops; the
  Scanorama label in other cinemas' titles ("SCA26:", "SCA:", "Rozė | Scanorama") is ignored when
  matching, and the Sunday family series ("Šeimų sekmadienis: Rozė", "Rozė | Sekmadienis su vaikais")
  is dropped from the title shown and matched on. Years such as "1753" occur and are treated as unknown.
- **Apollo/Pasaka (MCS)**: `dttmShowStart` is local time without offset; `dttmShowStartUTC` is
  UTC → use the UTC field. `dtAccounting` is the cinema's business day and can differ from the
  calendar date after midnight → the spec's rule (calendar date of start, Europe/Vilnius) wins.
  Multi-day queries work via `nrOfDays`.
- **Skalvija**: response body starts with PHP warning HTML before the JSON → strip everything
  before the first `{`/`[`; `start_date` is a Unix timestamp; titles are arrays; generic entries
  such as "Repertuarinis seansas" exist and are shown under that title.
- **Atlantis / Fliko sites** (Atlantis, Garsas): times are local `HH:MM`
  grouped under `<time datetime="YYYY-MM-DD">` date headers on `/filmai/{slug}` pages; each site's
  `back.*` backend disallows all crawling and must not be called.
- **Vue**: showing `date` values end in `Z` but are actually local Vilnius time (e.g.
  `"time": "13:30"` with `"date": "2026-10-30T13:30:00Z"`) → parse `date_time` + `time` as local
  time and ignore the `Z`. Ticket link is relative (`/pirkti-bilieta/santrauka/1001/{film}/{session}`).
- **Cinamon**: `showtime` is local time without offset; cinema `pid` for Mega is `77139293`.
- **Romuva**: calendar events are embedded in the ticket page as a JSON array; `start` is local
  time (`YYYY-MM-DD HH:MM`); no format or language fields.

### Owner decision: do not show 2D (2026-11-02)

2D is the default viewing experience, so the web app shows neither a 2D badge nor a 2D filter
(FR-008, FR-012). It is hidden in the web app only: adapters, the database and the API keep `2D`.
That needs no migration or refresh, and keeps "known to be 2D" apart from "cinema did not say"
(`null`). Normalising 2D to `null` in the adapters was rejected because it would lose that fact.

---

## 2. Backend: Node.js vs .NET

**Decision**: **Node.js 24 LTS with TypeScript**, using **Fastify** for the HTTP API.

**Rationale**:
- *Simplicity (Principle III)*: the frontend is TypeScript, so a TypeScript backend means one
  language, one toolchain (ESLint, Prettier, Vitest, tsc) and one package manager across the repo.
- *Shared contracts*: API types and validation schemas live in one shared package used by both
  the API and the web app, so a contract change breaks the build instead of production. With .NET,
  types would be duplicated or generated from OpenAPI — an extra step to keep in sync.
- *Workload fit*: the backend is I/O-bound (fetch feeds, parse JSON/XML/HTML, serve small cached
  JSON). Node's async I/O is a natural fit, and the load target (≈100 concurrent users, SC-007) is
  far below either runtime's limits, so .NET's raw throughput advantage does not matter here.
- *Ecosystem for this job*: mature, well-maintained libraries for each parsing need (`zod` for
  validation, `fast-xml-parser` for XML, `cheerio` for HTML).

**Alternatives considered**:
- *.NET 10 (ASP.NET Core minimal APIs + hosted background service)*: excellent performance,
  strong typing, and built-in background services. Rejected because it adds a second language and
  toolchain and duplicates contract types, with no performance need that justifies it.
- *Node with Express*: older middleware model, no built-in schema validation; Fastify is faster
  and has first-class TypeScript and JSON-schema support.
- *Node with Hono*: also good, but Fastify is more established for a long-running Node server.
- *No backend (scheduled job writing static JSON to a CDN)*: very cheap to host, but splits the
  system across a CI scheduler, object storage and a CDN, and CI cron timing is not reliable
  enough for the 3-hour freshness requirement (FR-014). Rejected for v1; the API's HTTP caching
  gives most of the same benefit.

## 3. Storage

**Decision**: **SQLite** (via `better-sqlite3`) in a single file next to the API.

**Rationale**: The full dataset is small (≈15 cinemas × up to ~3 weeks of screenings ≈ a few
thousand rows). SQLite persists across restarts (so the site works immediately after a deploy,
even if a cinema is down), supports the needed queries (by city, date, movie) with indexes, and
needs no separate server. It also stores source status and the match-review log.

**Alternatives considered**:
- *In-memory only*: simplest, but data is lost on restart and the first visitors after a deploy
  would see nothing until every source refreshed.
- *PostgreSQL*: needed only if several API instances must share state; not needed at 10x load.
  Migration path is documented in plan.md (Scalability).

## 4. Refresh scheduling

**Decision**: An in-process scheduler in the API service refreshes each source every **60
minutes** (with random jitter of ±5 minutes), plus once on startup. Each source refresh is
independent; one failing source never blocks others.

**Rationale**: FR-014 allows at most 3 hours of staleness; hourly refreshes tolerate two
consecutive failures before data becomes stale, and the load on cinema servers stays low.

**Alternatives considered**: external cron / job queue — extra infrastructure not justified for
eleven small sources.

## 5. Movie matching across cinemas (FR-005)

**Decision**: Deterministic, conservative matching:
1. **Normalise** titles: lower-case, strip diacritics, remove format/language tags (`3D`, `IMAX`,
   `4DX`, `(LT sub.)`, `LT`, `ORG`, `dubliuotas`, etc.), remove punctuation, collapse spaces.
2. **Title keys**: every movie is known by all its normalised titles — the **English** title (when
   a source states it: Apollo's international titles, Cinamon's translations), the original
   title, and the Lithuanian title — with a leading "The"/"A"/"An" ignored. The movie is named
   (and its id derived) after the English title when known, else the original, else the
   Lithuanian title.
3. Two listings are a **confident match** when they share **any** title key **and** nothing known
   contradicts it: production years equal when both are known; otherwise durations within
   **15 minutes** when both are known (Vue lists running times 11–13 minutes shorter than
   Apollo's, apparently without ads); a listing with neither (Romuva) matches on the title alone.
4. Everything else stays a **separate movie**; pairs that share a title but conflict on year or
   duration, or that would match more than one movie, are written to the **match-review log**.

*Owner decision 2026-10-30*: "the same movie shouldn't appear twice" — matching uses the English
title where available and shared titles in any language, instead of only the original title. On
the fixture data this turns 238 title groups into 195 movies with no title shared between two
movies. The English title is shown under the Lithuanian one.
5. A small, versioned **manual alias file** lets the maintainer confirm or reject pairs found in
   the review log.

**Rationale**: Wrong merges are worse than duplicates (spec clarification). Exact keys plus a
year/duration check are predictable, easy to unit-test, and avoid false merges of remakes or
sequels (different years).

**Alternatives considered**: fuzzy string similarity (Levenshtein/Jaro-Winkler) — catches more
duplicates but risks wrong merges (e.g., "Kopa" vs "Kopa. Antra dalis"); external IDs (IMDb) —
not provided by most sources.

## 6. Frontend stack details

| Concern | Decision | Rationale | Alternatives rejected |
|---------|----------|-----------|-----------------------|
| Framework/build | React 19 + Vite, TypeScript strict | User requirement | — |
| Component structure | Atomic design: `atoms/`, `molecules/`, `organisms/`, `templates/`, plus `pages/` | User requirement; keeps components reusable (Principle V consistency) | — |
| Styling | SCSS Modules (`*.module.scss`) + shared design tokens in `styles/` (colours, spacing, breakpoints) | User requirement; modules prevent class-name clashes | Global SCSS only — clashes as the app grows |
| Routing / URL state | React Router (data mode) | Movie and date must be in the URL (FR-011) | Hand-rolled history handling |
| Data fetching | TanStack Query | Built-in loading/error/stale states and caching per movie+date; avoids hand-written cache logic | Plain `fetch` in effects — reimplements caching and race handling |
| i18n (LT default, EN) | Typed message catalogues (`lt.ts`, `en.ts`) + native `Intl` (`DateTimeFormat`, `PluralRules` for Lithuanian's three plural forms) | Two languages and a modest number of strings; no library needed | `react-i18next` — capable, but more than this needs |
| Remembered city/language | `localStorage`, wrapped so the app works if storage is unavailable | FR-013/FR-017, no accounts | Cookies — unnecessary |
| Code quality | ESLint (typescript-eslint, react-hooks, jsx-a11y) + Prettier, run in CI | User requirement; Principle I | — |

## 7. Testing strategy

**Decision**:
- **Vitest** for unit and integration tests in all packages.
- **React Testing Library** for component tests.
- **Source adapter contract tests**: saved real responses from each cinema (fixtures) are parsed
  and compared with expected normalised screenings; a separate, manually-triggered "live check"
  verifies the sources still respond in the expected shape.
- **API integration tests**: Fastify `inject` against a temporary SQLite database.
- **Playwright** end-to-end tests for each user story, with `@axe-core/playwright` for
  accessibility checks (WCAG 2.1 AA, Principle V).

**Rationale**: Principle IV requires unit, integration and end-to-end coverage; fixtures keep
tests deterministic and independent of cinema websites (no flaky network tests in CI).

## 8. Hosting

**Decision**: One Linux container (Node API serving the built web app as static files, SQLite on
a persistent volume) on any EU-region container host; a CDN or the host's edge cache in front.
The exact provider is chosen at deploy time and does not affect the design.

**Rationale**: One deployable unit is the simplest thing that meets SC-007; an EU region keeps
latency low for Lithuanian users.
