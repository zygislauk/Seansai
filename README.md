# Seansai

Seansai shows every screening of a movie across Lithuanian cinemas on one timeline, so you can
pick the time that suits you instead of checking each cinema's website. Choose your city once,
pick a movie, and see today's remaining screenings (or any later date), with a link to buy the
ticket on the cinema's own site. The interface is in Lithuanian and English.

The feature spec, plan and design documents are in
[specs/001-cinema-showtimes/](specs/001-cinema-showtimes/).

## Supported cinemas

| City      | Cinemas                                                                                                                                                | Source                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Vilnius   | Apollo Akropolis, Apollo Outlet, Pasaka Paupys, Pasaka Senamiestis, Pasaka Kalnų parko estrada (seasonal), Skalvija, Vue Vilnius, Forum Cinemas Vingis | MCS feeds, Skalvija API, Vue, Forum |
| Kaunas    | Kauno kino centras Romuva, Cinamon Mega, Forum Cinemas Kaunas                                                                                          | Romuva page, Cinamon, Forum         |
| Klaipėda  | Forum Cinemas Klaipėda                                                                                                                                 | Forum                               |
| Šiauliai  | Atlantis Cinemas, Forum Cinemas Šiauliai                                                                                                               | Fliko pages, Forum                  |
| Panevėžys | Apollo Molas, Kino centras Garsas                                                                                                                      | MCS feed, Fliko pages               |

**Known gaps**

- **Cinamon** publishes only today's sessions in a form we can read (`today-only`), and its ticket
  links point to the cinema's schedule page.

### Robots.txt overrides and the kill switch

Seansai fetches politely: it identifies itself in the User-Agent with a contact address, waits
between requests, honours robots.txt and stops at any sign of blocking (no retries, no browser
disguise, no CAPTCHA solving). **Vue** and **Cinamon** disallow automated access in robots.txt;
the project owner decided on 2026-10-30 to fetch them anyway, once an hour
([research.md §1b](specs/001-cinema-showtimes/research.md)). Every override is logged at startup.
To stop fetching them at once, set:

```bash
DISABLED_SOURCES=vue,cinamon
```

## Run it

Requires Node.js 24 and npm. The full guide, including how to validate each user story, is in
[quickstart.md](specs/001-cinema-showtimes/quickstart.md).

```bash
npm install
SOURCES_MODE=fixtures npm run dev    # saved data, no cinema websites contacted
SEANSAI_CONTACT=https://github.com/zygispr/Seansai npm run dev    # live data, refreshed hourly
```

The API runs on <http://localhost:3000>, the web app on <http://localhost:5173>.

**In production** one container serves both the API and the built web app:

```bash
docker build -t seansai .
docker run -p 3000:3000 -v seansai-data:/data -e SEANSAI_CONTACT=https://github.com/zygispr/Seansai seansai
```

| Variable                                 | Meaning                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `SEANSAI_CONTACT`                        | Email or project URL sent in the User-Agent. Required for live data.                     |
| `DISABLED_SOURCES`                       | Comma-separated source ids never fetched (the kill switch). See quickstart §5 on Vercel. |
| `DB_PATH`                                | SQLite file. `/data/seansai.sqlite` in the container.                                    |
| `PORT`, `HOST`                           | Where the server listens (`3000`, `0.0.0.0` in the container).                           |
| `SOURCES_MODE`                           | `live` (default) or `fixtures` for the saved test data.                                  |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Turso database instead of a file. Required on Vercel.                                    |
| `CRON_SECRET`                            | Enables the fallback refresh route (`/api/v1/cron/daily`). At least 32 hex characters.   |
| `VERCEL_DEPLOY_HOOK_URL`                 | Asks Vercel for a new snapshot after a refresh. A secret. Unset means no call.           |

## Deploy to Vercel (free)

Seansai can run on Vercel's **Hobby** plan with its data in **Turso's Free** plan, at no cost.
Hobby is for non-commercial use only. The step-by-step guide, with the checks for each step, is
in [specs/002-vercel-deploy/quickstart.md](specs/002-vercel-deploy/quickstart.md).

- **Two services** in one project ([vercel.json](vercel.json)): the web app is served as static
  files by Vercel's CDN, and the API runs as one function in Frankfurt (`fra1`) for `/api/*`.
- **Database**: run `vercel integration add tursocloud` and choose the free `starter` plan, or
  create the databases at [turso.tech](https://turso.tech) and add `TURSO_DATABASE_URL` and
  `TURSO_AUTH_TOKEN` with `vercel env add`. Use **two databases**, one for Production and one
  for Preview, so a preview can never change production's data.
- **Variables**: set `SEANSAI_CONTACT` for Production and Preview, and `CRON_SECRET`
  (`openssl rand -hex 32`) for Production only.
- **Refreshing**: some cinemas refuse requests from Vercel, so a scheduled job on a machine at home
  refreshes every source once a day into Turso, and retries failed ones hourly unless the cinema
  refused (setup in [quickstart.md §5](specs/002-vercel-deploy/quickstart.md)). The machine only needs to be on, with you
  logged in, for about a minute a day. Visits never contact a cinema. A cinema is flagged as possibly outdated
  after **48 hours** on Vercel, instead of the 3 hours that apply to self-hosted copies, which still
  refresh hourly.
- **Monitoring**: Hobby keeps runtime logs for only an hour, so `GET /api/v1/health` (each
  source's status and last successful refresh) is the lasting record of how refreshes went.

## Findable in search engines

On Vercel, every public page is a static file in a **daily snapshot**, so search engines and link
previews get real content without running scripts. The design is in
[specs/003-seo-friendly-web/](specs/003-seo-friendly-web/).

- **How it stays current**: when a refresh updates at least one source, it calls the Deploy Hook in
  `VERCEL_DEPLOY_HOOK_URL` (setup in [quickstart.md §5](specs/002-vercel-deploy/quickstart.md)). The
  build reads the public API and renders each movie and city in both languages. If that build fails,
  the previous deployment stays live.
- **Without the hook**, the data still updates, but the pages stay as they were at the last deployment.
- **Trying it locally**: start an API, then build with `SNAPSHOT_API_URL` set
  ([quickstart.md §1](specs/003-seo-friendly-web/quickstart.md)). Without that setting or `VERCEL`,
  `npm run build` writes no pages.
- **Self-hosted copies** have no snapshot. They run as a single-page app and ask not to be listed.
- **Rolling back**: a rollback stops every later deployment going live, including the daily hook's, so
  pages stay as they were until you undo it with **Undo Rollback** or `vercel promote`. Hobby can only roll
  back to the previous deployment, and after a daily rebuild that may hold the same code. See below.

**If a merge breaks production's API**, a fix can't deploy by itself, because each build reads the live
API rather than its own commit's, and fails when that's broken:

1. Roll back in Vercel, which also restores the previous API. If the previous deployment holds the same
   bad code, promote an older one with `vercel promote`.
2. Push the fix. Its build reads the restored API and succeeds, but doesn't go live yet.
3. Use **Undo Rollback** or `vercel promote` on that deployment, which also turns automatic deployments
   back on.

As a last resort, set `SNAPSHOT_API_URL` in Vercel to another API with data, reachable without Vercel's
Deployment Protection, and remove it once the fix is live.

**To move to `seansai.lt`**:

1. Attach the domain to the Vercel project, as builds read their data from the public address.
2. Change `SITE_URL` in [apps/web/src/lib/site.ts](apps/web/src/lib/site.ts) and merge. That one line
   moves every preferred address, language link, preview tag and the site map.
3. Redirect the old address to the new one in Vercel, and add the new address to Google Search Console.

## Quality gates

All must pass before merging (CI runs them on every push):

```bash
npm run lint            # ESLint, zero errors
npm run format:check    # Prettier
npm run typecheck       # TypeScript in every workspace
npm test                # unit, component, adapter-contract and API integration tests
npm run test:load       # a steady 200 requests/s for 20 s: p95 < 300 ms, no errors
npm run build           # production build; fails if the initial JS exceeds 150 kB gzipped
npm run test:e2e        # Playwright user stories, accessibility (axe), resilience, load time
```

`npm run sources:check` fetches each live source once and reports screenings per cinema for the
next 7 days (manual; `-- --fixtures` checks the saved data instead).

## Project layout

```text
packages/shared/   API contract schemas (zod), used by the API and the web app
apps/api/          Node.js + Fastify API, SQLite (libSQL client; Turso on Vercel), refresh, source adapters
apps/web/          React + Vite web app (atomic design, SCSS Modules)
specs/             Feature spec, plan, research, contracts, tasks
```

## Adding a cinema

1. **Registry**: add the cinema to `apps/api/src/registry/cinemas.ts` with its city and the key
   its source uses for it (the registry, not the feed, decides the city). Add the city to
   `cities.ts` if it is new.
2. **Adapter**: if the cinema uses a source Seansai already reads (an MCS feed, Fliko pages), add
   its key to that adapter. Otherwise create `apps/api/src/sources/<source>/adapter.ts`
   implementing `SourceAdapter` ([contracts/source-adapter.md](specs/001-cinema-showtimes/contracts/source-adapter.md)),
   and register it in `apps/api/src/sources/index.ts`. Check the site's robots.txt first.
3. **Fixtures**: list the URLs in `apps/api/tests/fixtures/<source>/urls.json` and run
   `npm run fixtures:capture -- <source>`.
4. **Contract test**: add `apps/api/tests/contract/<source>.test.ts` asserting the adapter's output
   from the fixtures (times in Vilnius time, ticket links, formats, languages).
