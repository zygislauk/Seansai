# Contract: Source Adapter (internal)

Each cinema data source is implemented as an adapter behind one interface, so sources can be
added or fixed without touching the rest of the system.

```ts
interface SourceAdapter {
  /** Matches Source.id in the data model, e.g. "forum". */
  readonly id: string;

  /**
   * Fetch and normalise all published screenings from today up to the source's furthest
   * published date. Must not write to storage and must not throw for a single bad item:
   * bad items are skipped and counted in `skipped`.
   */
  fetchScreenings(context: AdapterContext): Promise<AdapterResult>;
}

type AdapterContext = {
  now: Date;                       // injected for deterministic tests
  http: PoliteHttpClient;          // User-Agent, delay between requests, timeout, robots check
  registry: CinemaRegistry;        // maps source venue keys → Cinema ids
};

type AdapterResult = {
  screenings: SourceScreening[];
  skipped: Array<{ reason: string; raw: string }>;  // logged, not shown to users
};

type SourceScreening = {
  sourceScreeningId: string;
  cinemaId: string;                // resolved through the registry
  startsAt: Date;                  // exact instant (UTC)
  title: string;                   // as published
  originalTitle: string | null;
  year: number | null;
  durationMinutes: number | null;
  ageRating: string | null;
  genres: string[];
  posterUrl: string | null;
  hall: string | null;
  format: "2D" | "3D" | "IMAX" | "4DX" | "ScreenX" | "other" | null;
  spokenLanguage: string | null;
  subtitleLanguage: string | null;
  isDubbed: boolean | null;
  ticketUrl: string;
};
```

## Rules every adapter must follow

1. Output is validated against the `SourceScreening` schema by the refresh job; an adapter whose
   result fails validation, or that throws, counts as a failed refresh. The previous data for that
   source is kept (FR-015).
2. Only paths allowed by the source's `robots.txt` are requested, unless the source config sets
   `robotsOverride: true` with a written reason (only `vue` and `cinamon`, research.md §1b).
   Ticket-sale paths are never requested, only returned as `ticketUrl`. On HTTP 401/403/429 or a
   CAPTCHA/block page the adapter throws `SourceBlockedError`; it never retries or circumvents.
3. Times are converted to exact instants using the source's offset or UTC field; when the source
   gives local time only, it is interpreted in `Europe/Vilnius`.
4. A successful result **replaces** all of that source's future screenings in storage.
5. Every source is listed for the same days: today through today + 90 days (Vilnius dates,
   `apps/api/src/sources/horizon.ts`). An adapter that asks its source for a date range asks for
   exactly these days; the refresh job drops any screening after the last one, whichever adapter
   returned it.

## Adapters in v1

| Adapter | Cinemas | Notes |
|---------|---------|-------|
| `mcs` (configured twice: `apollo`, `pasaka`) | Apollo Kinas, Pasaka | Markus Cinema System feed; JSON (Apollo) or XML (Pasaka) |
| `forum` | Forum Cinemas | REST API; screenings per region + the movie list (single movies only when missing) + hall names once a day |
| `skalvija` | Skalvija | WordPress JSON with PHP-warning prefix; title/start/ticket URL only |
| `fliko` (configured per site: `atlantis`, `garsas`) | Atlantis, Garsas | Server-rendered `/filmai/{slug}` pages of the shared Fliko site template; never calls the `back.*` backends |
| `romuva` | Romuva | JSON calendar array embedded in the ticket page; title/start/ticket URL only |
| `arlekinas` | Arlekinas | The site's JSON API: films and showings for a date range, then each film's page for languages, age rating and genres; no hall or format |
| `vue` | Vue Vilnius | `/data/filmswithshowings/1001`; local times despite `Z` suffix; `robotsOverride` |
| `cinamon` | Cinamon Mega (Kaunas) | Page API `/api/page/home?cinema_id=77139293&…` for today's sessions and the calendar of dates, then `/api/schedule?…&date=` for each later date; `robotsOverride` |

## Contract tests

Each adapter has fixture-based tests: saved real responses in `apps/api/tests/fixtures/{source}/`
→ expected `SourceScreening[]`. Fixtures are refreshed deliberately (by a script) when a source
changes, never fetched during CI.
