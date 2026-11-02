# Contract: Daily refresh endpoint

**Feature**: [../spec.md](../spec.md) (FR-004, FR-005, FR-007, FR-008, FR-009)

## `GET /api/v1/cron/daily`

A fallback since 2026-11-02: the daily refresh runs from a machine at home (quickstart §5), so no
Vercel Cron Job calls this. It refreshes every enabled source, in parallel, then removes past
screenings and stale movies.
Callers:
- Vercel Cron (production only, once a day, `0 22 * * *` UTC);
- the maintainer, by hand.

It's registered only when `CRON_SECRET` is configured.

### Request

| Header          | Value                   |
| --------------- | ----------------------- |
| `Authorization` | `Bearer <CRON_SECRET>`  |

The secret is compared in constant time.

### Responses

**200 OK**: the run finished. Individual sources may still have failed.

```json
{
  "sources": { "apollo": "success", "forum": "failed", "vue": "disabled" },
  "cleanup": { "screenings": 412, "movies": 3 }
}
```

- `Cache-Control: no-store`.
- Every configured source appears exactly once: `success`, `failed` (error recorded on the source,
  which `/health` and the stale notice show), or `disabled` (in `DISABLED_SOURCES`).
- `cleanup` counts the rows removed after all refreshes settled.

**404 Not Found**: the `Authorization` header is missing or wrong, or `CRON_SECRET` isn't
configured. The body is byte-for-byte the API's existing unknown-route body:

```json
{ "error": { "code": "not_found", "message": "There is no such API route." } }
```

No source is contacted and no data changes (SC-007).

### Behaviour

- Never contacts a cinema except through the existing polite HTTP client: User-Agent with
  contact, per-host delay, robots.txt, the kill switch.
- One source failing or throwing doesn't stop the others or the cleanup (FR-009).
- Each source's writes are all-or-nothing (FR-010).
- Must finish within the platform's 300 s function limit (research §3).
- Logs one structured line per source (from `refreshSource`) and one summary line.

### Not part of the public API

This endpoint isn't used by the web app and isn't listed in
[feature 001's public API](../../001-cinema-showtimes/contracts/public-api.md). It's an operations
endpoint.
