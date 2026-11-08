# Quickstart & Validation Guide: Cinema Showtimes Aggregator

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

How to run Seansai locally and prove each user story works. Interfaces are defined in
[contracts/](./contracts/); data shapes in [data-model.md](./data-model.md).

## Prerequisites

- Node.js 24 LTS and npm
- Playwright browsers for end-to-end tests: `npx playwright install --with-deps chromium`

## Setup and run

```bash
npm install                 # installs all workspaces (apps/web, apps/api, packages/shared)
npm run dev                 # API on :3000 (with hourly refresh), web app on :5173 (proxies /api)
```

To run without contacting cinema websites, start the API with fixture data:

```bash
SOURCES_MODE=fixtures npm run dev
```

## Quality gates (must all pass before merge)

```bash
npm run lint                # ESLint, zero errors
npm run format:check        # Prettier
npm run typecheck           # tsc --noEmit in every workspace
npm test                    # Vitest: unit, component, adapter-contract, API integration
npm run test:e2e            # Playwright user-story tests + axe accessibility checks
npm run build               # production build; reports web bundle size
```

## Validation scenarios

Run with `SOURCES_MODE=fixtures` so results are deterministic. Fixture "today" is fixed by
`FIXTURE_NOW` (see `apps/api/tests/fixtures/README.md`).

### US1 — Today's screenings across cinemas (P1)

1. Open `http://localhost:5173/` in a fresh browser profile.
   **Expect**: redirect to `/lt/`, city prompt with "Visa Lietuva" (All of Lithuania) option.
2. Choose **Vilnius**.
   **Expect**: movie list with posters; today's movies first, most screenings first
   ([public-api.md](./contracts/public-api.md) `GET /movies`).
3. Select a movie shown at several Vilnius cinemas.
   **Expect**: one timeline sorted by start time; each row shows cinema, time, hall, special format
   (never 2D), language/subtitles; no screenings that already started.
4. Click **Pirkti bilietą** (Buy ticket) on a row.
   **Expect**: the cinema's page opens in a new tab.
5. Open a movie with no screenings left today.
   **Expect**: "no more screenings today" message with a link to the next date.

### US2 — Choose a different date (P2)

1. On a movie page, pick a date three days ahead.
   **Expect**: URL gains `?date=YYYY-MM-DD`; list shows that day's screenings.
2. Reload the page and open the URL in a new window.
   **Expect**: same movie, date and screenings.
3. Open the date picker.
   **Expect**: no past dates; dates with screenings for this movie are visibly marked.

### US3 — Filters (P3)

1. Switch city to **Visa Lietuva**, then to **Kaunas**.
   **Expect**: movie list and screenings update; reload keeps Kaunas.
2. Filter by one cinema, then by format `3D`, then by original language.
   **Expect**: only matching rows; URL reflects filters; no `2D` choice is offered.
3. Apply filters that match nothing.
   **Expect**: "no screenings match" message with **Clear filters**.

### Language

- Switch to **EN**. **Expect**: URL changes to `/en/…`, interface in English, movie titles
  unchanged, original title shown where different; the choice is remembered after reload.

### Resilience (FR-015)

```bash
SOURCES_MODE=fixtures FIXTURE_FAIL=vue FIXTURE_VUE_LAST_SUCCESS_HOURS=4 npm run dev
```

**Expect**: screenings from other cinemas still shown; a notice says Vue Vilnius times may be
missing or outdated; "last updated" time is shown (`apps/web/tests/e2e/resilience.spec.ts`
automates this scenario).

### Live sources (manual, not in CI)

```bash
npm run sources:check       # fetches each live source once and prints counts per cinema
```

**Expect**: every enabled source reports screenings for today and at least the next 6 days, and
no source reports validation errors. Exception: a source that declares a known limitation
(`today-only`; no source declares one at present) only needs screenings for today; the check
prints the limitation instead of failing.
