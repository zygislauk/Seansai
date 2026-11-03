# Source fixtures

Saved real responses from each cinema source, one folder per source id
(`apollo`, `forum`, `pasaka`, `skalvija`, `atlantis`, `garsas`, `romuva`,
`vue`, `cinamon`). They feed the adapter contract tests and `SOURCES_MODE=fixtures`, so tests and
local runs never contact cinema websites.

Each folder contains:

- `urls.json` — the hand-written list of URLs to capture (absolute URLs; may use the placeholders
  `{today:dd.MM.yyyy}`, `{today:yyyy-MM-dd}` and `{today+14:yyyy-MM-dd}`, filled with today's
  date in Europe/Vilnius). List pages are not followed: list every page the adapter needs.
- `manifest.json` — `{ "<resolved url>": "<file>" }`, written by the capture script.
- `001.json`, `002.html`, … — the saved responses.

Refresh a source deliberately (never in CI):

```bash
SEANSAI_CONTACT=https://github.com/zygislauk/Seansai npm run fixtures:capture -- <sourceId>
```

The capture log below records when each source was captured. In fixture mode the API uses the
earliest capture instant as its clock (unless `FIXTURE_NOW` is set), so "today" and "already
started" match the saved data and no source's screenings are already in the past. Each adapter
replays its own capture instant, so the dated URLs it requests are the ones that were saved; a
source captured on a later day (Forum) simply starts on a later date.

## Source notes

- **Cinamon** — `cinamon-mode: page-state`. The page API
  (`/api/page/home?cinema_id=77139293&timezone=Europe/Vilnius&locale=lt`) answers with JSON, but
  it holds only today's remaining sessions (the same data as the page state), so the adapter reads
  today's sessions from it and declares the limitation `today-only`. Sessions carry no link of
  their own (the site opens them in its script), so tickets link to the Mega schedule page.
- **Fliko sites** (Atlantis, Garsas) — each `urls.json` lists the movie list
  plus eight movie pages; in fixture mode the other movies answer "not found" and are skipped.
  HTML fixtures are saved without their inline `<style>` contents (megabytes of CSS no adapter
  reads).
- **Forum** — captured on 2026-10-31, a day after the others. Its API host has no robots.txt
  (404, no restrictions), but answers that request with HTTP 500 when the request says
  `Accept-Language: *`, the default of Node's `fetch`, which RFC 9309 reads as "disallow
  everything"; the polite client therefore sends `Accept-Language: lt`. `urls.json` lists the
  regions, each region's 14 days of screenings, the movie list, the one movie missing from it
  and each cinema's halls (those answers carry seat maps, so the adapter asks once a day).

<!-- capture-log:start -->
| Source | Captured at (UTC) |
| --- | --- |
| apollo | 2026-10-30T17:39:42.136Z |
| atlantis | 2026-10-30T17:45:40.919Z |
| cinamon | 2026-10-30T17:41:11.578Z |
| forum | 2026-10-31T16:37:09.442Z |
| garsas | 2026-10-30T17:45:56.804Z |
| pasaka | 2026-10-30T17:39:44.737Z |
| romuva | 2026-10-30T17:39:49.023Z |
| skalvija | 2026-10-30T17:39:47.634Z |
| vue | 2026-10-30T17:39:50.105Z |
<!-- capture-log:end -->
