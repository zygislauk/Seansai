# Contract: Web App URLs

Page addresses are part of the user-facing contract: they must be bookmarkable, shareable and
reload-safe (FR-011). The language is part of the path so shared links open in the same language.

| Path | Page | Notes |
|------|------|-------|
| `/` | Redirect | → `/{lang}/` using the remembered language, else `lt`. On Vercel it's a real redirect, using the `seansai_lang` cookie |
| `/{lang}/` | Movie list | `lang` ∈ `lt`, `en`. On a first visit, shows all of Lithuania with a city choice that doesn't block the page (FR-013) |
| `/{lang}/city/{cityId}` | Movie list for a city | Remembers that city. An unknown city shows the not-found page. Choosing a city on a list page goes to that city's page |
| `/{lang}/movie/{movieId}` | Screenings for today | Same as `?date=` today |
| `/{lang}/movie/{movieId}?date=YYYY-MM-DD` | Screenings for a date | Invalid/past date → today, with a notice |

## Query parameters

| Param | Pages | Values | Notes |
|-------|-------|--------|-------|
| `city` | all | city id or `all` | Overrides the remembered city for this link, so shared links show the same screenings; also saved as the new remembered city |
| `date` | movie | `YYYY-MM-DD` | Omitted = today (US2 scenario 1) |
| `cinema` | movie | comma-separated cinema ids | Filter (US3) |
| `format` | movie | comma-separated formats: `3D`, `IMAX`, `4DX`, `ScreenX`, `other` | Filter (US3); `2D` is not a filter and is ignored like any unknown value |
| `audio` | movie | `original`, `dubbed` | Language filter (US3): original language with subtitles, or dubbed |

Unknown parameters are ignored; unknown `movieId` shows a "movie not found" page with a link to the
movie list.

## Remembered on the device (localStorage)

| Key | Value | Requirement |
|-----|-------|-------------|
| `seansai.city` | city id or `all` | FR-013 |
| `seansai.lang` | `lt` · `en` | FR-017 |

If storage is unavailable, the app still works: it offers the city choice on each visit and uses
the language from the URL.

## Responses on Vercel

Pages are static files from a daily snapshot, so these are real responses
([feature 003](../../003-seo-friendly-web/contracts/web-pages.md)):

| Request | Response |
|---------|----------|
| `/` | 307 to `/lt/`, or `/en/` with the `seansai_lang=en` cookie |
| An unknown two-letter language, such as `/de/movie/x` | 308 to the same page in Lithuanian |
| A page in the snapshot, with or without options | 200 |
| Any other address, such as an unknown movie or city | 404, with a page that boots the app. A movie newer than the snapshot still opens |
| `/sitemap.xml`, `/robots.txt` | 200 |

The self-hosted container has no snapshot. It answers every page address with the app, and sends
`X-Robots-Tag: noindex`.
