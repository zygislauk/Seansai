# Implementation Plan: Cinema Showtimes Aggregator

**Branch**: `001-cinema-showtimes` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-cinema-showtimes/spec.md`

## Summary

Seansai lets moviegoers pick a currently showing movie and see all of its screenings across
Lithuanian cinemas on one timeline, for today or a chosen date, filtered to their city.

A **Node.js + TypeScript backend** refreshes each cinema's public schedule every hour through
per-source adapters, merges listings of the same movie conservatively, stores everything in
**SQLite**, and serves a small cached read-only JSON API. A **React + Vite + TypeScript** web app
(atomic design, SCSS Modules, Lithuanian/English) renders the movie list, the screening timeline,
the date picker and the filters, keeping movie/date/filters in the URL.

Research verified live data sources for **Apollo, Forum Cinemas, Pasaka, Skalvija and Atlantis**,
and found two more regular cinemas worth covering: **Romuva** (Kaunas) and **Garsas** (Panevėžys)
([research.md §1a](./research.md#1a-additional-venues-not-in-the-users-original-list)).
**Vue (formerly Multikino) and Cinamon Mega are included by owner decision** although their
`robots.txt` disallows the data paths; they run with an explicit, logged override, stop on any
sign of blocking, and can be switched off without a deploy ([research.md §1b](./research.md#1b-owner-decision-include-vue-and-cinamon-mega-2026-10-30)).

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 24 LTS (API) and modern browsers (web)

**Primary Dependencies**:
- Web: React 19, Vite, React Router, TanStack Query, Sass (SCSS Modules)
- API: Fastify, zod, better-sqlite3, fast-xml-parser, cheerio
- Shared: zod schemas for API contracts (`packages/shared`)
- Quality: ESLint (typescript-eslint, react-hooks, jsx-a11y), Prettier

**Storage**: SQLite file on a persistent volume ([research.md §3](./research.md#3-storage))

**Testing**: Vitest (unit, integration, adapter contract tests with fixtures), React Testing
Library, Playwright + @axe-core/playwright (end-to-end, accessibility)

**Target Platform**: One Linux container in an EU region (API also serves the built web app);
browsers: last 2 versions of Chrome, Edge, Firefox, Safari, plus iOS Safari and Android Chrome;
screen widths from 320 px

**Project Type**: Web application (frontend + backend), npm workspaces monorepo

**Performance Goals**:
- Movie list and screening list visible in < 2 s on a mid-range phone over 4G (SC-002)
- API p95 < 300 ms at the server; target < 50 ms (pre-indexed SQLite reads, cached responses)
- Visible feedback for every action within 100 ms; interactions complete within 1 s
- Initial JS ≤ 150 KB gzipped; posters lazy-loaded with fixed dimensions (no layout shift)

**Constraints**:
- Data no older than 3 hours unless flagged (FR-014, SC-005); refresh hourly
- Respect each source's `robots.txt`, except the owner-approved overrides for Vue and Cinamon
  ([research.md §1b](./research.md#1b-owner-decision-include-vue-and-cinamon-mega-2026-10-30));
  never request ticket-sale paths; ≤ 1 refresh cycle/hour/source
- All times in Europe/Vilnius; WCAG 2.1 AA; Lithuanian default, English option
- No accounts, no personal data stored server-side

**Scale/Scope**:
- ~1,000 visitors/day, peaks of ~100 concurrent (SC-007); design checked at 10x
- 9 cinema operators / ~16 venues / 5 cities (Vilnius, Kaunas, Klaipėda, Šiauliai, Panevėžys)
  in v1; 7 source adapters; ~4–7k screenings stored at any time
- 2 main screens (movie list, movie screenings) + city prompt + not-found page

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
|-----------|------------------------|--------|
| I. Code Quality | ESLint + Prettier + `tsc` strict with zero errors in CI; every source failure handled and surfaced (FR-015); reviews required before merge | ✅ |
| II. Readability First | Atomic design gives a predictable component layout; one adapter per source behind one interface; shared naming from the data model | ✅ |
| III. Simplicity | One language end to end; one deployable container; SQLite instead of a DB server; in-process scheduler instead of a job system; no i18n library; client-side filtering instead of API filter params. Each dependency justified in research.md | ✅ |
| IV. Testing (NON-NEGOTIABLE) | Unit tests (matching, time zones, ordering), adapter contract tests on saved fixtures, API integration tests, Playwright test per user story; no network in CI | ✅ |
| V. Great UX | Stories written from the user's view; loading, empty, error and stale states designed for each screen; plain-language messages; WCAG 2.1 AA checked with axe; mobile-first layout | ✅ |
| VI. Performance | Budgets declared above; cached, pre-sorted API responses; indexed queries; lazy posters; bundle budget checked in build | ✅ |
| VII. Scalability | Load stated (SC-007); 10x analysis below; API stateless apart from SQLite; bounded queries (one city × one date × one movie) | ✅ |
| Quality Standards | Security: all source data validated with zod before storage; no secrets in repo. Observability: structured logs (Fastify/pino) for refreshes, failures, skipped items and match reviews | ✅ |

**Gate result (pre-research)**: PASS. **Gate result (post-design)**: PASS — the design adds no
new projects, layers or patterns beyond those listed.

### Scalability check (10x: ~10,000 visitors/day, ~1,000 concurrent)

- **First bottleneck**: the single container's CPU for JSON serialisation at peak, and SQLite's
  single-writer model if more than one instance is ever needed.
- **Why it holds at 10x**: responses are small and cacheable (`max-age=300` + ETag), so a CDN in
  front absorbs most traffic; refresh work does not grow with visitors.
- **Path beyond 10x (not built now)**: move storage to PostgreSQL and run the scheduler as a
  single separate worker, then run several stateless API instances.

### Data source risk

- Sources are undocumented and can change without notice → adapters are isolated, validated and
  contract-tested; a failing source degrades gracefully (FR-015); `sources:check` detects drift.
- Permission: the spec's "collection is acceptable" assumption holds for 7 of the 9 operators
  based on `robots.txt`; Vue and Cinamon are included by owner decision with the safeguards in
  research.md §1b. Written confirmation from each cinema is a recommended follow-up.

## Project Structure

### Documentation (this feature)

```text
specs/001-cinema-showtimes/
├── plan.md              # This file
├── research.md          # Phase 0: data sources, backend choice, storage, matching, testing
├── data-model.md        # Phase 1: entities, validation, state transitions
├── quickstart.md        # Phase 1: run & validation guide
├── contracts/
│   ├── public-api.md    # HTTP API used by the web app
│   ├── web-routes.md    # Page URLs and remembered settings
│   └── source-adapter.md# Internal adapter interface
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
package.json                 # npm workspaces + root scripts (lint, test, build, dev)
eslint.config.js
.prettierrc
tsconfig.base.json

packages/
└── shared/                  # API contract schemas & types (zod), used by api and web
    └── src/

apps/
├── api/
│   ├── src/
│   │   ├── server.ts        # Fastify app: routes, caching headers, static web files
│   │   ├── routes/          # cities, movies, screenings, health
│   │   ├── refresh/         # scheduler + refresh job (validate → match → store)
│   │   ├── sources/         # one folder per adapter: mcs/, forum/, skalvija/, fliko/, romuva/, vue/, cinamon/
│   │   ├── matching/        # title normalisation, match rules, review log, alias file
│   │   ├── registry/        # cinemas.ts, cities.ts (city assignment per venue)
│   │   ├── db/              # SQLite schema, migrations, queries
│   │   └── lib/             # polite HTTP client, time zone helpers, logger
│   └── tests/
│       ├── fixtures/        # saved source responses per adapter
│       ├── unit/
│       ├── contract/        # adapter fixture tests
│       └── integration/     # API routes against temp SQLite
└── web/
    ├── index.html
    ├── src/
    │   ├── main.tsx
    │   ├── app/             # router, providers, query client
    │   ├── components/
    │   │   ├── atoms/       # Button, Poster, Badge, TimeLabel, Spinner, Icon …
    │   │   ├── molecules/   # ScreeningRow, DateChip, CityOption, FilterChip, SearchField …
    │   │   ├── organisms/   # MovieGrid, ScreeningTimeline, DatePicker, FilterBar, CityPrompt, StaleNotice
    │   │   └── templates/   # PageLayout (header, language switch, footer)
    │   ├── pages/           # MovieListPage, MoviePage, NotFoundPage
    │   ├── api/             # typed API client + TanStack Query hooks
    │   ├── i18n/            # lt.ts, en.ts, useT(), Intl formatters
    │   ├── storage/         # safe localStorage wrapper (city, language)
    │   └── styles/          # _tokens.scss, _breakpoints.scss, global.scss
    └── tests/
        ├── unit/            # component + hook tests (RTL)
        └── e2e/             # Playwright, one spec per user story
```

**Structure Decision**: Web application as an npm workspaces monorepo with two apps (`apps/web`,
`apps/api`) and one shared package (`packages/shared`). The shared package is the single source of
truth for API contracts, so the web app and API cannot drift apart. In production the API serves
the built web app, so the site deploys as one container.

## Complexity Tracking

No constitution violations. Choices that add moving parts (the shared package, TanStack Query,
SQLite) are justified, with rejected simpler alternatives, in [research.md](./research.md).
