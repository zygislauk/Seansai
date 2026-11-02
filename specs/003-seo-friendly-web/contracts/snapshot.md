# Contract: Snapshot Build and Hosting Changes

**Feature**: [../spec.md](../spec.md)

Changes to [feature 002's hosting contract](../../002-vercel-deploy/contracts/hosting.md), and how a build
produces pages.

## Build

`npm run build -w @seansai/web` runs, in order:

1. `vite build`: the browser app, with one merged stylesheet.
2. `vite build --ssr src/entry-prerender.tsx --outDir dist-prerender`: the page renderer, outside what is
   served.
3. The existing compression and bundle-size steps. Compression comes first so the snapshot doesn't get
   `.br` and `.gz` copies of every page, which only the self-hosted server uses.
4. `node scripts/prerender.ts`: runs when `VERCEL` or `SNAPSHOT_API_URL` is set, and is skipped otherwise. It
   also checks HTML sizes.

| Setting | Effect |
|---------|--------|
| `VERCEL` set | Snapshot required. It reads `${SITE_URL}/api/v1`. |
| `SNAPSHOT_API_URL` set | Snapshot reads this API instead. Used by CI and local checks. |
| Neither | No snapshot: the Docker image and ordinary `npm run build` |

## Reading data

- Requests: `/cities`, `/movies?city=all`, `/movies?city={id}`, `/movies/{id}?city=all`, and
  `/movies/{id}/screenings?city=all`.
- Each carries `snapshot={build time}`, to avoid reading what the CDN cached before the refresh.
- At most 8 requests at once, each retried twice. Responses are validated with `packages/shared`.

## Failing safely

The build exits non-zero, leaving the previous deployment live, if:

- A request still fails after retries, or a response fails validation.
- The general list has no movies.
- A rendered page lacks its `<h1>` or is over budget.

## The hook

- `apps/api/src/refresh/deploy-hook.ts` sends one `POST` to `VERCEL_DEPLOY_HOOK_URL`.
- Called after a refresh in which at least one source succeeded, from `refresh-now.ts` and the cron route.
- Skipped when unset. Timeout 10 s, no retries, since the next refresh tries again.
- Logs `Snapshot build requested` or an error. The URL is never logged. A failure doesn't change the refresh's
  exit code or result.
- Isn't called on `--if-due` runs that find nothing to do.

## `vercel.json`

```jsonc
{
  "regions": ["fra1"],
  "redirects": [
    { "source": "/", "has": [{ "type": "cookie", "key": "seansai_lang", "value": "en" }],
      "destination": "/en/", "permanent": false },
    { "source": "/", "destination": "/lt/", "permanent": false },
    // Unknown two-letter language prefixes.
    { "source": "/:lang((?!lt|en)[a-z]{2})/:path*", "destination": "/lt/:path*", "permanent": true }
  ],
  "services": {
    "api": { /* unchanged */ },
    "web": {
      "root": "apps/web",
      "framework": "vite",
      // Removed: the catch-all rewrite to /index.html. dist/404.html serves unknown addresses.
      "headers": [ /* unchanged */ ]
    }
  },
  "rewrites": [ /* unchanged */ ]
}
```

`tests/unit/vercel-config.test.ts` is extended to cover these rules.

## Self-hosted server

- Unchanged: the fallback to `index.html`.
- Added: `X-Robots-Tag: noindex` on every response.

## Security

- `VERCEL_DEPLOY_HOOK_URL` lets anyone holding it start deployments, so it's handled as a secret, is revocable
  in Vercel, and isn't committed.
- All cinema-supplied text is escaped when written into HTML or embedded JSON.
- The CSP doesn't change. Embedded JSON blocks aren't executed, and `boot-gate.js` is a same-origin file.
