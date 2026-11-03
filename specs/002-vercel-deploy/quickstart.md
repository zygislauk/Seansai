# Quickstart: Validate Free Hosting on Vercel

**Feature**: [spec.md](./spec.md)

How to show that each user story works. §1–§3 run on a laptop. §4–§6 need the Vercel and Turso
accounts. Contracts: [cron-endpoint.md](./contracts/cron-endpoint.md),
[hosting.md](./contracts/hosting.md).

## Prerequisites

- Node.js 24, npm, Vercel CLI ≥ 48.6 (`npm i -g vercel`).
- Docker, for §3 only.
- For §4–§6: a Vercel **Hobby** account and a Turso **Free** account (or the Turso Marketplace
  integration on its Free plan).

## 1. Automated checks (every change)

```bash
npm run lint && npm run format:check && npm run typecheck
npm test                 # includes the new cron, daily-refresh, config and repository tests
npm run test:load        # p95 < 300 ms still holds with the async database client
npm run build && npm run test:e2e
```

Expected: everything passes.

## 2. Both services together under `vercel dev` (US1, US3)

```bash
printf 'SOURCES_MODE=fixtures\nCRON_SECRET=0123456789abcdef0123456789abcdef\n' > .env      # gitignored; delete afterwards
vercel dev --local --listen 3333
```

| Check                                                          | Expected                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| `curl -s 'localhost:3333/api/v1/movies?city=vilnius'`          | JSON movie list (fixture data)                              |
| `curl -s -o /dev/null -w '%{http_code}' localhost:3333/lt/`    | `200` (served by the web service)                           |
| `curl -sI localhost:3333/ \| grep -i content-security-policy`   | the CSP header                                              |
| `curl -s localhost:3333/api/v1/cron/daily`                     | `404` with the `not_found` body                             |
| `curl -s -H 'Authorization: Bearer wrong' localhost:3333/api/v1/cron/daily` | `404`                                          |
| `curl -s -H 'Authorization: Bearer 0123456789abcdef0123456789abcdef' localhost:3333/api/v1/cron/daily` | `200`, every source listed, `cleanup` counts   |

Delete `.env` when done.

## 3. Self-hosting still works (FR-015)

```bash
docker build -t seansai .
docker run --rm -p 3000:3000 -e SOURCES_MODE=fixtures \
  -v "$PWD/apps/api/tests/fixtures:/app/apps/api/tests/fixtures:ro" seansai
curl -s localhost:3000/api/v1/health      # "status":"ok", sources healthy
curl -s localhost:3000/ | head -c 100     # the web app's index.html
```

`npm run dev` with `SOURCES_MODE=fixtures` also still works as described in the README.

## 4. First deploy on free plans (US1, US3)

1. Run `vercel link` and create the project on the **Hobby** team.
2. Set up the database:
   - Run `vercel integration add tursocloud` and choose the free `starter` plan.
   - Create two databases: `seansai` connected to Production, and `seansai-preview` connected to
     Preview.
   - If that asks for a paid plan or a card, stop. Create both databases at turso.tech in the EU
     region nearest Frankfurt instead. Then run `vercel env add TURSO_DATABASE_URL` and
     `vercel env add TURSO_AUTH_TOKEN` once per environment, with that environment's database.
3. Add the remaining variables:
   - `vercel env add CRON_SECRET production` with the output of `openssl rand -hex 32`;
   - `vercel env add SEANSAI_CONTACT` with `https://github.com/zygispr/Seansai`.
4. Deploy a preview by pushing the branch or running `vercel deploy`.
   - Since feature 003, each build reads pages' data from a public API, and fails if it can't or if
     there are no movies. A new project has neither yet, so for its first deployments set
     `SNAPSHOT_API_URL` to an API that has data, such as a self-hosted copy. Remove it once §5 has
     loaded this project's data, and change `SITE_URL` in `apps/web/src/lib/site.ts`.
   - **Expected**: the build succeeds and `regions` is accepted. If not, use the fallback in
     [hosting.md](./contracts/hosting.md).
5. `curl <preview>/api/v1/health`.
   - **Expected**: `status: ok`, every source `stale`. This proves the migrations ran on Turso.
   - If Deployment Protection blocks the call, use `vercel curl`.
6. Deploy to production (merge to `main`), then trigger the first load with the job in §5.
   - **Expected**: every enabled source `success` in the log, in about a minute.
7. Open the production address on a phone and follow feature 001's journeys:
   - choose a city, then pick a movie;
   - change the date, apply filters;
   - open a ticket link;
   - reload a deep link.
   - **Expected**: the same results as a self-hosted copy (SC-001).

## 5. Daily refresh from a machine at home (US2)

Vercel only serves the site: some cinemas refuse requests from it ([research.md §5](./research.md#5-keeping-usage-free-sc-002-sc-005)).
The job runs from its own checkout of `main`, so an unreviewed branch can never migrate or write
production's data.

Set it up once, on a Mac. Run `nvm use 24` first if you use nvm, as the job keeps that Node's path.

```bash
git clone https://github.com/zygispr/Seansai.git ~/.local/share/seansai-refresh

# Private, outside any repository: SEANSAI_CONTACT, plus production's TURSO_DATABASE_URL and
# TURSO_AUTH_TOKEN. To read those, run `vercel env pull <private file> --environment=production` in
# the linked project, copy the three lines across, and delete that file.
mkdir -p ~/.config/seansai && touch ~/.config/seansai/refresh.env && chmod 600 ~/.config/seansai/refresh.env
```

To keep the site's pages current (feature 003), also create a Deploy Hook for `main` under the
project's **Settings → Git → Deploy Hooks**, and add its address as `VERCEL_DEPLOY_HOOK_URL` to
`refresh.env` and to Vercel's Production environment. Treat it as a secret: anyone holding it can
start deployments. Without it, refreshes still update the data, but the pages stay as they were at
the last deployment.

Once that file is filled in:

```bash
cd ~/.local/share/seansai-refresh
mkdir -p ~/Library/LaunchAgents
sed -e "s#__CHECKOUT__#$PWD#" -e "s#__NODE_DIR__#$(dirname "$(which node)")#" -e "s#__LOGS__#$HOME/Library/Logs#" \
  deploy/lt.seansai.refresh.plist > ~/Library/LaunchAgents/lt.seansai.refresh.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/lt.seansai.refresh.plist
```

- **What it does**: it checks every hour while you are logged in and the Mac is awake, and refreshes
  on the first check of each Vilnius day. So it runs once a day, and catches up after sleep or being
  offline. It can't run while the Mac is off.
- **After a failure**: later checks that day retry only the sources that failed, each at most once an
  hour, and the log shows `Retrying the sources that failed`. A cinema that refused the request, or
  whose robots.txt disallows it, isn't asked again until the next day.
- **By hand**: run `~/.local/share/seansai-refresh/scripts/home-refresh.sh`. Within an hour of
  the last run, the limit for every source, it only retries a source that failed over an hour ago.
- **If Node changes**: removing that Node version stops the job, with the reason in the log. To
  change the job, run the `launchctl bootout` below first, then the commands above again.
- **Logs**: `~/Library/Logs/seansai-refresh.log`. With the hook set, a refresh ends with
  `Snapshot build requested`, and a deployment appears in Vercel.
- **To stop it**: `launchctl bootout "gui/$(id -u)/lt.seansai.refresh"`.

Then check:

- On two consecutive days (the release gate), and on each of the first 7 days (SC-003, checked at the
  one-week review):
  - `/health` shows each source's `lastSuccessAt` from that day;
  - the site lists today's screenings and none from yesterday (SC-003).
- Kill switch:
  - Set `DISABLED_SOURCES=forum` in Production, redeploy, and add it to `refresh.env`. Vercel uses it
    to hide the cinemas, and the job to stop contacting them. If a cinema asks Seansai to stop,
    `refresh.env` is the one that matters.
  - After the next run, Forum's cinemas are gone from the site, and the log shows Forum as disabled with no request made to it.
  - Remove the variable from both afterwards.
- Missed refresh: with Forum disabled for longer than 48 h, the site would flag it. Unit tests cover
  the threshold (§1). Live checking is optional.
- If the machine is away for long: `/api/v1/cron/daily` still refreshes from Vercel with the secret,
  though the cinemas that refuse Vercel stay as they were. That counts as the day's attempt, so run
  the job by hand an hour later to catch them up.

## 6. Cost and usage check (US3, SC-002, SC-005)

After a week, and again after the first full month:

- Vercel → Usage: invocations, Active CPU, Provisioned Memory, Fast Origin and Fast Data Transfer
  each under 50% of the Hobby allowance (prorated for a week). No upgrade prompts.
- Turso dashboard: rows read and written, and storage, each under 50% of the Free allowance.
  Plan is Free, with no payment method.
- Responses: `curl -sI '<production>/api/v1/movies?city=vilnius'` twice. The second shows
  `x-vercel-cache: HIT` (CDN caching works, research §5).
