# Data Model: Cinema Showtimes Aggregator

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-30

Stored in SQLite (see [research.md §3](./research.md#3-storage)). All instants are stored in UTC;
calendar dates are computed in `Europe/Vilnius`.

## Entities

### City

Static reference data from the cinema registry (versioned config file in the repo).

| Field | Type | Rules |
|-------|------|-------|
| `id` | string (slug) | e.g. `vilnius`, `kaunas`, `klaipeda`, `siauliai`, `panevezys`; unique |
| `nameLt` | string | e.g. "Vilnius" |
| `nameEn` | string | e.g. "Vilnius" |

### Cinema (Venue)

Static reference data from the cinema registry. The registry, not the feed, decides the city
(Forum's feed reports a wrong city for Vingis — see research §1).

| Field | Type | Rules |
|-------|------|-------|
| `id` | string (slug) | e.g. `forum-vingis`, `apollo-akropolis`; unique |
| `name` | string | Display name, e.g. "Forum Cinemas Vingis" |
| `chain` | enum | `apollo` · `forum` · `pasaka` · `skalvija` · `atlantis` · `romuva` · `garsas` · `vue` · `cinamon` |
| `cityId` | → City | required |
| `address` | string | optional |
| `websiteUrl` | URL | required; fallback ticket link |
| `sourceId` | → Source | which adapter supplies its screenings |
| `sourceVenueKeys` | string[] | the source's own IDs/names for this venue (e.g. MCS `TheatreID`, Forum `cinemaId`) |

### Source

One per adapter configuration. Holds the refresh status shown to users (FR-015).

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | `apollo`, `forum`, `pasaka`, `skalvija`, `atlantis`, `garsas`, `romuva`, `vue`, `cinamon` |
| `lastAttemptAt` | instant | set at every refresh attempt |
| `lastSuccessAt` | instant \| null | set only when a refresh completes and passes validation |
| `lastError` | string \| null | short technical reason; never shown raw to users |
| `status` | enum | derived, see state transitions |

### Movie

A film or event grouping listings of the same title from all cinemas (FR-005).

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | stable slug derived from match key + year, e.g. `digger-2026`; used in URLs |
| `title` | string | local (Lithuanian) display title, from the first source that provided it |
| `originalTitle` | string \| null | shown alongside the title when different and no English title is known (FR-017) |
| `englishTitle` | string \| null | when a source states it (Apollo, Cinamon); shown under the title |
| `matchKey` | string | the normalised title the movie is named after: English, else original, else Lithuanian (research §5) |
| `keys` | string[] | every normalised title the movie is known by (table `movie_keys`); listings match on any of them |
| `year` | integer \| null | production year |
| `durationMinutes` | integer \| null | the most common across its screenings, the shorter on a tie |
| `ageRating` | string \| null | e.g. "N13" |
| `genres` | string[] | optional |
| `posterUrl` | URL \| null | null → placeholder image (FR-003) |

**Uniqueness**: (`matchKey`, `year`) is unique. Listings with the same `matchKey` but conflicting
`year`/duration become separate movies and create a MatchReview entry.

### Screening

One showing of a movie at a cinema.

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | `{sourceId}:{sourceScreeningId}`; unique |
| `movieId` | → Movie | required |
| `cinemaId` | → Cinema | required |
| `startsAt` | instant (UTC) | required |
| `localDate` | date | calendar date of `startsAt` in Europe/Vilnius (edge case: after midnight) |
| `durationMinutes` | integer \| null | as this cinema lists it; the movie shows the most common one |
| `hall` | string \| null | e.g. "6 salė" |
| `format` | enum \| null | `2D` · `3D` · `IMAX` · `4DX` · `ScreenX` · `other`; `2D` is stored as a fact but not shown (FR-008) |
| `spokenLanguage` | ISO 639-1 \| null | e.g. `en` |
| `subtitleLanguage` | ISO 639-1 \| null | e.g. `lt` |
| `isDubbed` | boolean \| null | true when spoken language is a dubbed Lithuanian version |
| `ticketUrl` | URL | screening page at the cinema, else movie page, else cinema website (FR-009) |
| `sourceTitle` | string | the raw title as the cinema published it (for review/debugging) |
| `refreshedAt` | instant | when this row was last written by a successful refresh |

**Indexes**: (`localDate`, `cinemaId`), (`movieId`, `localDate`), (`cinemaId`, `startsAt`).

### MatchReview

Uncertain matches logged for the maintainer (spec clarification Q4).

| Field | Type | Rules |
|-------|------|-------|
| `id` | integer | auto |
| `matchKey` | string | the shared normalised title |
| `movieIdA`, `movieIdB` | → Movie | the two movies kept separate |
| `reason` | string | e.g. "year 2025 vs 2026" |
| `firstSeenAt` | instant | |
| `resolution` | enum \| null | null (open) · `merge` · `keep-separate` — set via the alias file |

## Relationships

```text
City 1 ── * Cinema * ── 1 Source
Cinema 1 ── * Screening * ── 1 Movie
Movie * ── * MatchReview
```

## Validation rules (from requirements)

- A screening is stored only if it has a title, a cinema that exists in the registry, and a valid
  start time (edge case: special events need only these).
- A screening whose cinema is not in the registry is dropped and logged (new venues need a
  registry entry and a city).
- Every adapter output is validated with a schema before it is written; a source whose output
  fails validation is treated as a failed refresh (FR-015) and its previous data is kept.
- Screenings with `startsAt` in the past are not returned for today (FR-007); they are deleted
  from storage once their `localDate` is before today.

## State transitions

### Source status

```text
healthy  ──refresh fails──▶  degraded  ──no success for 3 h──▶  stale
   ▲                            │                                 │
   └────────refresh ok──────────┴──────────refresh ok─────────────┘
```

A new source starts as `stale` until its first successful refresh.

- `healthy`: last attempt succeeded.
- `degraded`: last attempt failed, but data is still < 3 hours old — shown normally, no warning.
- `stale`: no successful refresh for ≥ 3 hours — the UI warns that this cinema's times may be
  missing or outdated (FR-015, SC-005).

### Screening lifecycle

- Created or updated on each successful refresh of its source.
- A successful refresh **replaces** that source's future screenings, so cancelled screenings
  disappear (edge case: schedule changes).
- Removed once its `localDate` is in the past.

### Movie lifecycle

- Created when the first screening for its match key is stored.
- Hidden from the "currently showing" list when it has no upcoming screenings; deleted after
  30 days without screenings.
