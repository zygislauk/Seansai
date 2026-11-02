# Contract: Public HTTP API

Read-only JSON API consumed by the web app. Base path: `/api/v1`. All responses are
`application/json; charset=utf-8`. Types are defined once as schemas in `packages/shared` and
imported by both the API and the web app.

## Conventions

- **Dates**: `date` = `YYYY-MM-DD` in Europe/Vilnius. **Instants**: ISO 8601 with offset,
  e.g. `2026-10-30T21:35:00+02:00`.
- **City filter**: `city` = a city id (e.g. `vilnius`) or `all`. Required on list endpoints.
- **Language**: `lang` = `lt` (default) or `en`; affects only server-provided labels (city names).
  Movie titles are returned as published (FR-017).
- **Caching**: list responses send `Cache-Control: public, max-age=300, s-maxage=300` and an
  `ETag`. `s-maxage` lets Vercel's CDN cache them for 5 minutes and is removed before the
  browser; self-hosted it has no effect
  ([002 hosting contract](../../002-vercel-deploy/contracts/hosting.md#api-response-caching-change-to-feature-001s-public-api)).
- **Errors**: non-2xx responses use

  ```json
  { "error": { "code": "invalid_date", "message": "date must be today or later" } }
  ```

  Codes: `invalid_city`, `invalid_date`, `movie_not_found`, `not_found` (unknown API route),
  `internal_error`.

## Shared objects

```ts
type Freshness = {
  updatedAt: string;          // oldest lastSuccessAt among the cinemas included in the response
  staleCinemas: Array<{ id: string; name: string; lastSuccessAt: string | null }>; // FR-015
};

type MovieSummary = {
  id: string;                 // e.g. "digger-2026"
  title: string;              // as published, Lithuanian
  originalTitle: string | null;
  englishTitle: string | null; // when a cinema states it; shown under the title
  posterUrl: string | null;   // null → placeholder
  ageRating: string | null;
  durationMinutes: number | null;
};

type Screening = {
  id: string;
  startsAt: string;           // instant
  cinema: { id: string; name: string; cityId: string; cityName: string };
  hall: string | null;
  format: "2D" | "3D" | "IMAX" | "4DX" | "ScreenX" | "other" | null; // the web app does not show "2D" (FR-008)
  spokenLanguage: string | null;     // ISO 639-1
  subtitleLanguage: string | null;   // ISO 639-1
  isDubbed: boolean | null;
  ticketUrl: string;
};
```

## `GET /api/v1/cities`

Cities with at least one supported cinema, for the first-visit city prompt (FR-013).

```json
{ "cities": [ { "id": "vilnius", "name": "Vilnius", "cinemaCount": 6 } ] }
```

## `GET /api/v1/movies?city={city}`

The "currently showing" list for a city, already ordered as required by FR-003: movies with
remaining screenings today first (most screenings today first, ties by title), then movies that
start on later dates (by first date).

```json
{
  "movies": [
    { "movie": { "...": "MovieSummary" }, "screeningsToday": 12, "firstDate": "2026-10-30" },
    { "movie": { "...": "MovieSummary" }, "screeningsToday": 0, "firstDate": "2026-11-06" }
  ],
  "freshness": { "...": "Freshness" }
}
```

Search by title (FR-004) is done client-side over this list (≤ a few hundred items).

## `GET /api/v1/movies/{movieId}?city={city}`

Movie details plus the dates on which it has screenings in the city (US2: dates with screenings
are visibly distinguished).

```json
{
  "movie": { "...": "MovieSummary", "genres": ["drama"], "year": 2026 },
  "screeningDates": ["2026-10-30", "2026-10-31", "2026-11-02"],
  "availableDates": ["2026-10-30", "2026-10-31", "2026-11-01", "...", "2026-11-19"]
}
```

`availableDates` = today … furthest date any cinema has published (FR-010). `404 movie_not_found`
if the id is unknown.

## `GET /api/v1/movies/{movieId}/screenings?city={city}&date={date}`

`date` is optional and defaults to today (Europe/Vilnius, server clock), so the web app can ask
for today's screenings in parallel with the movie details instead of waiting for
`availableDates`; the response's `date` says which day was answered.

All screenings of the movie on that date in the city, as one timeline sorted by `startsAt`, ties
by cinema name (FR-006). For today, screenings that have already started are excluded (FR-007).

```json
{
  "date": "2026-10-30",
  "screenings": [ { "...": "Screening" } ],
  "nextDateWithScreenings": "2026-10-31",
  "freshness": { "...": "Freshness" }
}
```

- `nextDateWithScreenings` is set when `screenings` is empty (US1 scenario 6), else `null`.
- `400 invalid_date` for a date before today or not in `availableDates`.

## `GET /api/v1/health`

Liveness plus per-source status, for monitoring (not used by the UI).

```json
{ "status": "ok", "sources": [ { "id": "forum", "status": "healthy", "lastSuccessAt": "..." } ] }
```

## Format/language filters (FR-012)

Filtering by cinema, format and language happens client-side on the screenings response (one
movie × one date × one city is at most a few dozen rows), so the API needs no filter parameters.
