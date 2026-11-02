# Feature Specification: Findable in Search Engines

**Feature Branch**: `003-seo-friendly-web`

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "make the web app SEO-friendly"

## Clarifications

### Session 2026-11-02

- Q: What should a first-time visitor see, given that a dialog blocks the page until a city is chosen
  (feature 001, FR-013)? → A: The content for all of Lithuania straight away, with a city choice that
  doesn't block the page.
- Q: Which city pages should exist? → A: One movie list page per city, and one movie page covering
  all cities. Movie pages are not repeated per city.
- Q: Which public address does this feature target? → A: `seansai.vercel.app` for now. The owner plans
  to move to `seansai.lt` later, and that move isn't part of this feature.
- Q: Should pages carry a structured description of the movie and its screenings? → A: No. Google's
  event results don't cover Lithuania or Lithuanian, so it would bring no visible benefit today. This
  removed User Story 5, FR-019 and SC-009. Other numbers are unchanged.
- Q: Should crawlers be kept out of the data service? → A: No. They need it to render pages, so its
  addresses stay reachable and ask not to be listed (FR-011).
- Q: Which readers may see a screening that has already started? → A: Only readers without scripts,
  until the next data refresh. This follows from pages being a daily snapshot.

## Current State

Checked on the public site and in the code on 2026-11-02. These are the problems this feature exists
to fix:

- Every address returns the same near-empty page: one title ("Seansai"), one description and no
  movies, until the page's scripts have run.
- With no city chosen, which is always the case for a search engine, the scripts show only a city
  prompt. The movie page shows no movie at all, and the list page shows only its heading.
- Addresses that don't exist answer "success" with that same page, so search engines can't tell
  them from real pages. The robots file, site map and site icon addresses behave the same way, so
  none of the three exists.
- The Lithuanian and English versions of a page aren't marked as translations for search engines.
- `/` sends visitors to their language only after scripts have run.
- 216 movies are listed across Lithuania, and many have no screening on a given day, so a movie page
  can have little to show for today. The site has no synopses, and 28 of the 216 have no poster.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reach a movie's screenings from a search (Priority: P1)

Someone searches for a movie's title and "seansai" (screenings). Seansai appears in the results with
a title and description that make clear what the page offers. They open it and see that movie and
its screenings straight away.

**Why this priority**: This is the feature's main value. People look for specific movies, and each
movie page answers that search. If these pages can't be read and listed, nothing else here matters.

**Independent Test**: Request any current movie's address without running scripts and confirm that
the response contains the movie's title, its facts, and when and where it is showing. Then open the
same address in a fresh browser and confirm a person sees the same content.

**Acceptance Scenarios**:

1. **Given** a movie is currently listed, **When** a reader that doesn't run scripts requests its
   page, **Then** the response contains the movie's title, available facts (poster, duration,
   genres, age rating, year), its screenings and their ticket links.
2. **Given** any two movie pages, **When** their search-result title and description are compared,
   **Then** they differ, and each names its movie and says what the page offers.
3. **Given** a movie has no screening today, **When** its page is requested, **Then** the page still
   says when and where the movie is next showing.
4. **Given** a first-time visitor arrives from a search result, **When** the page opens, **Then** they
   see the movie and its screenings across Lithuania straight away, with a city choice that doesn't
   block the page (FR-006).
5. **Given** a movie is no longer listed, **When** its address is requested, **Then** the response is
   a real "not found", and people still see the existing not-found page with its link to the list.

---

### User Story 2 - Search engines find every page, and only the right ones (Priority: P1)

A search engine can discover every current movie through ordinary links and a site map, understand
which address is the preferred one for each page, and know which language each version is in. It
doesn't waste effort on filtered views or list duplicates.

**Why this priority**: Readable pages only help if they are found and don't compete with copies of
themselves. Date and filter options can otherwise turn each movie into hundreds of near-identical
addresses.

**Independent Test**: Fetch the site map and check that every address in it answers directly with
success, then follow only plain links from the list page and confirm every movie is reached.

**Acceptance Scenarios**:

1. **Given** the movie list page, **When** a reader that doesn't run scripts requests it, **Then** it
   contains the current movies, each with an ordinary link to its page.
2. **Given** the site map, **When** it is fetched, **Then** it lists every list page and current
   movie page, in both languages, and nothing else.
3. **Given** an address with date, filter or city options in it, **When** it is requested, **Then** it
   works exactly as it does today and names the matching page without those options as its preferred
   address (FR-012).
4. **Given** a page exists in Lithuanian and English, **When** either is requested, **Then** it names
   the other as its translation and states its own language.
5. **Given** `/` or an address with an unknown language, **When** it is requested, **Then** the
   response itself redirects to the right page; a returning visitor with a remembered language still
   ends up in that language.
6. **Given** an address that doesn't exist, **When** it is requested, **Then** the response is a real
   "not found".

---

### User Story 3 - Find what's on in a city (Priority: P2)

Someone searches for "kino seansai Vilniuje" (screenings in Vilnius). Seansai appears with a page
about that city's movies, and they see that city's list without having to choose it.

**Why this priority**: City searches are the other common way people look for screenings, but they
aren't tied to one movie, so they come after movie pages.

**Independent Test**: Take one city's list page from the site map and confirm it has its own title
and description naming the city, and lists only movies showing there.

**Acceptance Scenarios**:

1. **Given** a city with supported cinemas, **When** its page is requested without running scripts,
   **Then** it names the city in its title, description and main heading, and lists only the movies
   showing there.
2. **Given** a person opens a city's page, **When** it loads, **Then** that city's movies are shown
   without asking for a city, and that city becomes their remembered city.
3. **Given** a person is on a city's page, **When** they switch city, **Then** they go to the new city's
   page, or to the general list page if they choose all of Lithuania.
4. **Given** a person opens a movie from a city's page, **When** the movie page loads, **Then** it shows
   that city's screenings, at the one address that movie has.

---

### User Story 4 - Shared links look right (Priority: P3)

Someone pastes a movie's link into Messenger, Facebook or another app. The preview shows the movie's
title, a short description and its poster instead of a bare "Seansai".

**Why this priority**: Friends deciding on a movie together share links, and a clear preview brings
people to the site. It helps, but it isn't how most searchers find the site.

**Independent Test**: Run a sample of movie addresses through a link-preview checker and confirm the
title, description and image match the movie.

**Acceptance Scenarios**:

1. **Given** a movie with a poster, **When** its link is shared, **Then** the preview shows its title,
   description and poster.
2. **Given** a movie without a poster, or the movie list page, **When** the link is shared, **Then**
   the preview uses a general Seansai image.

---

### Edge Cases

- **Data service down when a page is requested**: the response says "temporarily unavailable". It is
  never an empty success, which could replace the listing, and never "not found", which could
  remove the page from search results.
- **Data not refreshed because the owner's Mac is off (002)**: pages are still served with the newest
  data available and its "updated at" time, so nothing claims to be fresher than it is.
- **A screening started since the page was produced**: readers without scripts may still see it, until
  the next data refresh. In the running app people never see it, as FR-007 of feature 001 requires.
- **A movie's address changes because duplicate listings were merged**: the old address leads to the
  surviving movie's page rather than "not found", when the system knows the two are the same movie.
- **A shared link with `?city=`**: it keeps working and keeps saving that city for people.
- **Stored city no longer supported**: treated as a first visit (FR-006).
- **A city with no current movies**: its page shows the existing empty message and leaves the site map
  until movies return. A city that loses all its supported cinemas answers "not found".
- **Titles with Lithuanian letters**: appear correctly in search results, previews and the site map.
- **Test copies of the site (previews, self-hosted)**: are never listed by search engines.
- **Crawlers requesting many pages at once**: people's page speed and the free-plan limits still hold
  (FR-018).

## Requirements *(mandatory)*

### Functional Requirements

**Readable pages**

- **FR-001**: Every movie page and movie list page MUST deliver its main content in the initial
  response, so a reader that doesn't run scripts gets it: for a movie, its title, facts, screenings
  and ticket links; for a list, the movies with links to their pages.
- **FR-002**: That content MUST match what a first-time visitor to the same address sees. Search
  engines MUST NOT be given different content from people.
- **FR-003**: Content delivered this way MUST NOT be more than 1 hour older than the newest published
  schedule data.
- **FR-004**: With no city in the address and none remembered, which includes every search engine,
  pages MUST show content for all of Lithuania. Returning visitors keep seeing their remembered city.
- **FR-005**: Every movie page MUST say, in words people can also see, when and where the movie is
  next showing, even if it has no screening on the shown date.
- **FR-006**: A first-time visitor MUST see the page's content straight away, alongside a city choice
  that doesn't block reading, scrolling or keyboard use and doesn't take focus. It stays until they
  choose a city or dismiss it. Dismissing it remembers all of Lithuania, so they aren't asked again;
  the city switcher in the header still changes it. This replaces the first-visit dialog in feature
  001 (FR-013 there). The dialog remains for changing the city from the header.

**Page descriptions**

- **FR-007**: Every page MUST have its own search-result title and description, in the page's language,
  built only from facts the site holds. For a movie: its title, year or genre where known, and when
  and where it is showing.
- **FR-008**: Every page MUST have exactly one main heading, and the page's language MUST be stated in
  the initial response.
- **FR-009**: Each city with supported cinemas MUST have its own movie list page in both languages,
  named for that city ("Kino seansai Vilniuje"), with its own address. Opening one MUST remember that
  city. Movie pages MUST NOT be repeated per city: each movie has one page per language, and a person's
  chosen city decides which screenings it shows.

**Discovery and addresses**

- **FR-010**: The site MUST publish a site map of the general list page, every city list page with
  current movies, and every current movie page, in both languages. It MUST reflect each data refresh,
  within the limit in FR-003.
- **FR-011**: The site MUST publish instructions for crawlers that allow the public pages and point to
  the site map. Crawlers need the data service to render pages, so its addresses MUST stay reachable
  and instead ask not to be listed.
- **FR-012**: Every page MUST name its preferred address. A movie address with date, filter or city
  options MUST name the plain movie page, and a list address with a city option MUST name that city's
  list page. These addresses MUST otherwise keep working as they do today.
- **FR-013**: Each page MUST name its counterpart in the other language, with Lithuanian as the default
  for searchers whose language is neither.
- **FR-014**: Requests for `/` and for unknown language prefixes MUST receive a real redirect in the
  response. The remembered-language behaviour for returning visitors MUST keep working.
- **FR-015**: Unknown addresses and movies no longer listed MUST receive a real "not found" response.
  Temporary failures MUST receive a real "temporarily unavailable" response.
- **FR-016**: Only the public production address MUST be listed as preferred or be open to crawlers;
  other copies of the site MUST ask not to be listed.

**Sharing and limits**

- **FR-017**: Every page MUST provide a link-preview title, description and image: the movie's poster
  if it has one, otherwise a general Seansai image. The site MUST also have a site icon.
- **FR-018**: Pages MUST keep meeting feature 001's speed and load targets (SC-002, SC-007 there) and
  feature 002's free-plan rule (FR-011 there), now including crawler traffic.
- **FR-020**: Everything people can do today MUST keep working as it does, including search, dates,
  filters, the language and city switchers, shared links and accessibility (feature 001).
- **FR-021**: The owner MUST be able to prove ownership of the site to search engines' free owner
  tools, without a paid domain.
- **FR-022**: The public address MUST be set in one place, so that preferred addresses, the site map
  and link previews all follow it when the site moves to its own domain.

### Key Entities

- **Public page**: an address people and search engines can open. It has a language, a preferred
  address, a counterpart in the other language, a title, a description and a preview image.
- **Site map entry**: one current public page, with when its data last changed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of the addresses in the site map, a reader that doesn't run scripts gets the
  page's main content, title and description in the first response.
- **SC-002**: No two site map addresses share a search-result title or description.
- **SC-003**: 100% of the site map's addresses answer directly with success, and 100% of a sample of
  unknown addresses answer "not found".
- **SC-004**: A movie that stops being listed leaves the site map, and its address answers "not found",
  within 1 hour of the data refresh that removed it.
- **SC-005**: Within 8 weeks of the site being submitted to Google, at least 80% of submitted movie
  pages are reported as indexed in Google's owner tools.
- **SC-006**: Within 8 weeks of submission, for at least 5 of 10 sampled movies now showing, a Google
  search from Lithuania for "[title] seansai" shows Seansai on the first results page. This is a
  target, since search engines decide their own rankings.
- **SC-007**: Movie and list pages show their main content in under 2.5 seconds on a typical phone
  connection, for at least 75% of visits.
- **SC-008**: A sample of 10 movie links shows the correct title, description and image in Facebook's
  and Messenger's link previews.
- **SC-010**: Monthly hosting and database cost stays at zero.

## Assumptions

- **Google first, in Lithuanian**: Google is the main target because most Lithuanian searches go
  through it. Other search engines benefit from the same work, and Lithuanian pages are the priority
  when a trade-off is needed. English pages are listed too.
- **Address**: the preferred public address stays `seansai.vercel.app` for now, because feature 002
  requires everything to stay free. The owner plans to move to `seansai.lt` later. That move, including
  its redirects from the old addresses and telling search engines about it, is a separate piece of
  work, and FR-022 keeps it small. Search standing may dip for a while after the move.
- **No synopses**: the site doesn't collect them, so descriptions are composed from known facts. Adding
  synopses would likely improve rankings, but it means collecting new data and is out of scope.
- **Out of scope**: link building, paid search, advertising, analytics, blog or editorial content,
  promotion on other sites, and structured descriptions for richer search results.
- **Screening pages**: individual dates aren't separate search targets. They stay usable but point to
  the plain movie page (FR-012).
- **Posters** in previews stay on the cinemas' own image hosting, as they do on the pages today.
- **Cinemas' awareness**: being findable makes the site more visible to the cinemas whose schedules it
  shows. Screening links keep sending people to the cinemas' own ticket pages (feature 001, FR-009).
- **Dependencies**: the daily refresh from feature 002 keeps movie data current. The owner registers
  the site with search engines' owner tools, using their own account.
- **Changes to feature 001**: FR-006 changes its FR-013, and FR-009 adds city list addresses to its web
  address contract. Feature 001's documents are updated when this is implemented, so they keep
  describing what is live until then.
