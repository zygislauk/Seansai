# Quickstart: Validating Findability

**Feature**: [spec.md](./spec.md). Responses are defined in
[contracts/web-pages.md](./contracts/web-pages.md).

## 1. Locally, against the fixture data

```bash
SOURCES_MODE=fixtures PORT=3000 node apps/api/src/main.ts &
SNAPSHOT_API_URL=http://localhost:3000/api/v1 npm run build -w @seansai/web
npm run preview -w @seansai/web
```

Expected, on the preview server's address:

| Check | Expected |
|-------|----------|
| `curl <preview>/lt/` | Movie titles and links in the HTML, not an empty `#root` |
| `curl <preview>/lt/movie/<id>` | Title, facts, summary line, its own `<title>`, canonical and language links |
| `curl <preview>/lt/city/vilnius` | "Kino seansai Vilniuje" in `<title>` and `<h1>` |
| `curl <preview>/sitemap.xml` | Every plain page, in both languages |
| Open `/lt/` in a fresh browser profile | Content immediately, the non-blocking city choice, no console errors |
| Set a city, reload | No flash of all-of-Lithuania content |

Automated: `npm run test`, `npm run test:e2e` (including `seo.spec.ts`).

## 2. On the first preview: things research could not confirm

Preview URLs may need `vercel curl` if Deployment Protection is on.

| Check | Expected | If not |
|-------|----------|--------|
| `curl -I <preview>/lt/nonexistent` | Status 404 | Add the `routes` fallback (research §6) |
| Browser at that address | The app's not-found page | Fix `404.html` |
| `curl -I <preview>/lt/movie/was-marielle-weiß` (percent-encoded), and a Cyrillic id | 200 | Research §6 fallback |
| `curl -I <preview>/` | Temporary redirect to `/lt/` | Check `redirects` |
| Same with `--cookie seansai_lang=en` | Redirect to `/en/` | Check the `has` rule |
| `curl -I <preview>/de/movie/x` | Permanent redirect to `/lt/movie/x` | Check the source pattern |
| `curl -I <preview>/lt/` | `X-Robots-Tag: noindex`, all security headers | See research §7 |
| Browser console on a first visit | No CSP violation, no hydration errors | Research §2 and §5 fallbacks |

## 3. After merging to production

```bash
curl -s https://seansai.vercel.app/lt/ | grep -c '<a '
curl -sI https://seansai.vercel.app/lt/ | grep -i x-robots-tag   # none expected on production
curl -sI https://seansai.vercel.app/api/v1/cities | grep -i x-robots-tag   # noindex
curl -s https://seansai.vercel.app/robots.txt
curl -s https://seansai.vercel.app/sitemap.xml | grep -c '<loc>'
```

Check `X-Robots-Tag` on the current production deployment's own unique address, from `vercel ls` (FR-016):

```bash
curl -sI https://<deployment-address>/lt/ | grep -i x-robots-tag
```

`noindex` is the good result. If it's absent, the page's canonical link still names the public address, so
record that in research §7 and don't add anything.

Then:

- Read the build log for duplicate title or description warnings (SC-002). For each one, merge the records.

- Paste 10 movie addresses into [Facebook's Sharing Debugger](https://developers.facebook.com/tools/debug/)
  (SC-008).
- Check a phone-sized [PageSpeed Insights](https://pagespeed.web.dev/) run (SC-007).

## 4. The daily cycle

1. Add `VERCEL_DEPLOY_HOOK_URL` to `~/.config/seansai/refresh.env` and to Vercel's Production environment.
2. After the next refresh, `~/Library/Logs/seansai-refresh.log` shows `Snapshot build requested`.
3. A deployment marked as triggered by the hook appears in Vercel, and finishes within 10 minutes.
4. The `lastmod` values in `/sitemap.xml` show the new date.

If `lastmod` falls behind `/api/v1/health`'s `lastSuccessAt`, the hook or the build failed: check the home job's
log, then the deployment in Vercel. Pages stay as they were until an update succeeds (FR-003).

**Rollback note**: a dashboard rollback lasts only until the next hook call, which deploys the latest `main`.
Revert the code on `main` as well.

## 5. Owner steps for search engines

1. Add a URL-prefix property for the production address in
   [Google Search Console](https://search.google.com/search-console), and prove ownership with the HTML file
   (committed to `apps/web/public/`).
2. Submit `sitemap.xml`.
3. Optionally do the same in Bing Webmaster Tools.
4. Note the date. SC-005 and SC-006 are measured 8 weeks later.
