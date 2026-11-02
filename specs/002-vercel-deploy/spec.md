# Feature Specification: Free Public Hosting on Vercel

**Feature Branch**: `002-vercel-deploy`

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "I need to deploy this app to Vercel. Implement what we agreed on, keep it free"

## Clarifications

### Session 2026-10-31

Decisions agreed with the project owner before this specification was written:

- Q: Where is the site hosted? → A: Vercel, on the free Hobby plan, as one project with two parts:
  the web pages, and the data service on the `/api/` paths. Neither part calls the other privately.
- Q: Where does the schedule data live? → A: In a hosted database on its free plan. Turso was
  chosen because it keeps the existing database format; a file-snapshot approach was rejected.
- Q: How often is data refreshed? → A: Once a day, because the free plan allows scheduled work at
  most once a day. The owner accepted this.
- Q: Budget? → A: It is a hobby project: everything MUST stay free.
- Q (2026-11-02, after production): Pasaka and Cinamon refuse requests from Vercel with HTTP 403, so
  where should refreshing run? → A: The owner chose to treat all venues the same: every source is
  refreshed once a day from the owner's machine at home, and Vercel only serves the site. The owner
  accepted that the site stops updating while that machine is off or they are logged out, and that
  this routes around those cinemas' refusal of Vercel's requests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use Seansai at a public web address (Priority: P1)

A moviegoer opens Seansai's public web address on their phone or computer. They do everything
feature 001 offers (choose a city, browse movies, see every screening of a movie, switch dates,
filter, open a cinema's ticket page) and get the same results as on a self-hosted copy. Bookmarked
and shared links open the right page.

**Why this priority**: Without a public address nobody but the developer can use Seansai. This
story alone delivers the product to its users.

**Independent Test**: Deploy, load the saved test data once, then follow feature 001's user
journeys at the public address. Every journey works and shows the same movies and screenings as a
self-hosted copy with the same data.

**Acceptance Scenarios**:

1. **Given** the site is deployed and has data, **When** a visitor opens the public address,
   **Then** they see the city prompt or their city's movie list exactly as in feature 001.
2. **Given** a visitor has a link to a movie's screenings for a date, **When** they open or reload
   it, **Then** that page opens directly, not a "page not found" error.
3. **Given** two visitors open the site at the same moment, possibly served by different servers,
   **When** they look at the same movie, **Then** both see the same screenings.
4. **Given** the site has not been visited for hours, **When** the next visitor arrives, **Then**
   they see the full movie list without any data having to be fetched from cinemas first.

---

### User Story 2 - Schedules stay current without anyone stepping in (Priority: P2)

Once a day, the first time the owner's machine is on and they are logged in, Seansai collects the latest schedules from all
supported cinemas and removes screenings that are over. A visitor sees the coming days' screenings.
If a cinema could not be read, the site still shows everything else and flags that cinema once its
data is more than two days old.

**Why this priority**: Without refreshing, the data is useful for at most a few days. It depends
on Story 1, which makes the site reachable.

**Independent Test**: With the machine used normally for two days, each day's screenings are listed
and the previous day's are gone, with no manual action. Then disable one cinema and check that the
site flags it once its data is more than 48 hours old.

**Acceptance Scenarios**:

1. **Given** the site is deployed in production and the machine is on with the owner logged in at
   some point in the day,
   **When** the daily refresh is due, **Then** every enabled cinema's schedule is updated and past
   screenings are removed, without anyone acting.
2. **Given** one cinema's website fails during the daily refresh, **When** the refresh finishes,
   **Then** the other cinemas are still updated, that cinema keeps its previous screenings, and the
   failure is recorded.
3. **Given** a cinema has had no successful refresh for more than 48 hours, **When** a visitor views
   movies in its city, **Then** the site says that cinema's information may be missing or
   outdated, as feature 001 does.
4. **Given** visitors are using the site, **When** they browse, **Then** no request is ever sent to
   a cinema's website because of their visit.

---

### User Story 3 - The maintainer runs it at zero cost (Priority: P3)

The project owner deploys new versions from the repository, previews each change before it goes
live, can refresh the data on demand (for example right after the first deploy), and can stop
fetching from any cinema with the existing kill switch. The site costs nothing to run, and the
self-hosted container still works for anyone who prefers it.

**Why this priority**: It keeps the site sustainable for a hobby project, but visitors don't depend
on it directly.

**Independent Test**: Deploy a change and check it on its preview address. Trigger a refresh with
the maintainer's secret and confirm data appears; try without the secret and confirm nothing
happens. After a month, the hosting and database billing pages show no charges. Separately, build
and run the self-hosted container with saved test data and confirm it works as before.

**Acceptance Scenarios**:

1. **Given** the maintainer has the refresh secret, **When** they trigger a refresh, **Then** all
   enabled cinemas are refreshed and they get a per-source summary of the outcome. A source is
   one cinema operator's schedule feed and can cover several cinemas.
2. **Given** someone without the secret, or with a wrong one, **When** they try to trigger a
   refresh, **Then** nothing happens and the response is the same as for an address that does
   not exist.
3. **Given** the maintainer lists a cinema source in the kill switch, **When** the next refresh
   runs, **Then** that source is not contacted and its cinemas disappear from the site, as in
   feature 001.
4. **Given** the site has run in production for a full month at expected traffic, **When** the
   maintainer checks the hosting and database accounts, **Then** there are no charges and no
   free-plan limit has been reached.
5. **Given** someone runs the self-hosted container, **When** it starts, **Then** it behaves as
   before this feature, including its hourly refresh and 3-hour staleness rule.

### Edge Cases

- **The daily refresh does not run or fails for every cinema**, for example because the machine is
  off: visitors keep seeing the previous data. Once it is more than 48 hours old, every affected
  cinema is flagged.
- **The refresh is cut off by the platform's time limit**: each cinema's update is all-or-nothing,
  so a cinema has either its complete new schedule or its complete previous one, never a mix.
- **The refresh is triggered twice at once** (manual and scheduled): the data ends up the same as
  after one refresh, with no duplicate screenings.
- **First deploy**: the database is empty until the first refresh. Visitors see the existing "no
  screenings" state, and the maintainer triggers a refresh right after deploying.
- **Cinemas that publish only today's sessions (Cinamon)**: the site lists none of that cinema's
  screenings for today until the day's refresh has run, and no flag warns of this, because the
  48-hour threshold has not passed. On a day the machine stays off they are missing all day. Changes
  made after the refresh wait for the next day's run. This is an accepted, documented gap.
- **Approaching a free-plan limit**: the providers warn by email. The site must never move to a
  paid tier automatically.
- **Preview deployments**: they use their own database, separate from production's, so a preview
  (including one with a database change) can never alter production's data or its structure. They
  never run the daily refresh, so previews cannot double the load on cinema websites. The
  maintainer fills a preview's database by hand when needed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The site MUST be publicly reachable at one web address that serves both the pages and
  their data. Data addresses stay under `/api/`, as in feature 001.
- **FR-002**: Every page address MUST open the right page when opened directly, reloaded,
  bookmarked or shared. An unknown data address MUST return feature 001's existing "not found"
  answer.
- **FR-003**: Schedule data MUST be stored so that every visitor sees the same data no matter which
  server answers, and the data MUST survive restarts, redeploys and periods with no traffic.
- **FR-004**: In the hosted deployment, schedule data MUST be refreshed automatically once a day
  from the owner's machine, at any time of day, the first time that machine is on with the owner
  logged in. This replaces feature 001's FR-014 ("at least every 3 hours") for the hosted deployment
  only. FR-014's "show when the data was last updated" part still
  applies.
- **FR-005**: The daily run MUST also remove past screenings and old movies, under feature 001's
  existing rules.
- **FR-006**: In the hosted deployment, a cinema MUST be flagged as possibly outdated once its data
  has had no successful refresh for 48 hours. This replaces feature 001's 3-hour threshold (FR-015,
  SC-005) for the hosted deployment only.
- **FR-007**: Serving visitors MUST NOT cause any request to a cinema's website. Cinemas MUST be
  contacted only by the daily refresh or a refresh triggered by the maintainer, under the existing
  politeness rules: identification, delays, robots.txt and the kill switch.
- **FR-008**: The maintainer MUST be able to trigger a refresh on demand with a secret. Without the
  correct secret, the trigger MUST do nothing and answer exactly as an address that does not exist.
- **FR-009**: A failure at one cinema during a refresh MUST NOT stop the other cinemas or the
  cleanup. The failure MUST be recorded, so the site can flag the cinema, and logged.
- **FR-010**: Each cinema's update within a refresh MUST be all-or-nothing.
- **FR-011**: The site MUST run entirely within the free plans of its hosting and database
  providers. At feature 001's expected load (SC-007 there), usage MUST stay within every free
  allowance, and no provider may be set up to charge automatically. If a provider's free plan
  can't be set up without payment details through one route, a free route without them MUST be
  used instead.
- **FR-012**: Pages MUST carry the same browser security protections as the self-hosted version
  (content restrictions, no framing, no content-type sniffing, limited referrer).
- **FR-013**: Database credentials, the refresh secret and the contact address MUST be set in the
  hosting provider's settings and MUST NOT be stored in the repository.
- **FR-014**: Each change MUST be viewable on its own preview address before it goes live. Only
  production's database gets the daily refresh.
- **FR-015**: The self-hosted container and local development MUST keep their current behaviour:
  hourly refresh, 3-hour staleness, local data file, and the saved-test-data mode.
- **FR-016**: The project documentation MUST explain how to deploy Seansai for free, which settings
  are needed, and how the hosted deployment's refresh and staleness rules differ from self-hosting.

### Key Entities

- **Refresh run**: one collection of schedules from all enabled cinemas followed by the cleanup.
  It has a start time, an outcome per source (updated, failed, or disabled) and the number of
  screenings and movies removed. It is started by the job at home or by the maintainer.
- **Refresh secret**: a value known only to the maintainer. Holding it is the only way to start a
  refresh from the hosted deployment.
- **Schedule data**: the movies, screenings and per-source refresh status defined in feature 001.
  Unchanged by this feature, except that it now lives in a shared hosted store.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At the public address, every user journey of feature 001 passes its end-to-end
  checks, with the same results as a self-hosted copy holding the same data.
- **SC-002**: Running the site costs €0 a month. After the first full month in production, the
  hosting and database billing pages show no charges.
- **SC-003**: On 7 consecutive days on which the machine is on, the site lists that day's screenings
  and none from previous days, with no manual action.
- **SC-004**: The movie list and a movie's screenings appear within feature 001's 2-second target
  (SC-002 there) for visitors in Lithuania. The first visit after the site has been idle for an hour
  or more appears within 3 seconds.
- **SC-005**: At feature 001's expected load (about 1,000 visitors a day), monthly usage stays below
  50% of every free-plan allowance of the hosting and database providers.
- **SC-006**: Visitors never cause requests to cinema websites. This is checked two ways:
  - an automated check proves that a newly started hosted server makes 0 requests to cinemas and
    starts no refresh, even after two hours with no refresh triggered;
  - on the live site, the logs of a server started by a visitor after an hour of inactivity show 0
    cinema requests.

  (Logs on the free plan last only one hour, so a week of logs can't be reviewed.)
- **SC-007**: 100% of refresh attempts without the correct secret change no data and contact no
  cinema.

## Assumptions

- The owner has, or will create, a free Vercel Hobby account and a free Turso account, either
  directly or through Vercel's Marketplace. The project is non-commercial, as the Hobby plan
  requires.
- The free plans' current terms apply, checked on 2026-10-31:
  - Vercel Hobby allows scheduled jobs at most once a day, started anywhere within the scheduled
    hour.
  - Turso Free includes 5 GB of storage, 500 million rows read and 10 million rows written per
    month, with no credit card required.
  - Seansai's data is about 1 MB with around 3,000 rows, so it fits easily.
- Feature 001's product behaviour is unchanged apart from FR-004 and FR-006 above, which apply only
  to the hosted deployment.
- The 48-hour threshold allows for the daily refresh running at any time of day, and one missed day
  is not flagged. A longer gap is.
- Preview deployments get their own database on the same free database account. The free plan
  allows up to 100 databases, so the separation costs nothing.
- The public address is the default one Vercel provides. A custom domain is out of scope.
- The site's existing `/api/` data paths, response formats and web pages don't change. The web pages
  already call the data service at relative addresses.
- Moving existing self-hosted data into the hosted database is out of scope. The hosted site fills
  itself on its first refresh.
