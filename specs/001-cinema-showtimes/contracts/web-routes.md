# Contract: Web App URLs

Page addresses are part of the user-facing contract: they must be bookmarkable, shareable and
reload-safe (FR-011). The language is part of the path so shared links open in the same language.

| Path | Page | Notes |
|------|------|-------|
| `/` | Redirect | → `/{lang}/` using the remembered language, else `lt` |
| `/{lang}/` | Movie list | `lang` ∈ `lt`, `en`. Shows the city prompt on first visit (FR-013) |
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

If storage is unavailable, the app still works: it asks for the city on each visit and uses the
language from the URL.
