# Feature Specification: Cinema Showtimes Aggregator

**Feature Branch**: `001-cinema-showtimes`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "when choosing where to watch a movie, I always check different cinemas to choose a time that best suits me. I'd like to make a website that would let me choose a movie from currently showing movies and then see all possible movie screening times from different venues for today by default and then you could choose a future date if wanted. Possible venues that come to mind for Lithuania: apollo, forum cinemas, vue, pasaka, skalvija, atlantis"

## Clarifications

### Session 2026-10-30

- Q: How many visitors should the site be built for in its first version? → A: Small public
  site: about 1,000 visitors a day, peaks of about 100 at once (Friday and weekend evenings).
- Q: On a first visit, before the user has picked a city, which screenings should the site
  show? → A: Ask once for a city (with an "All of Lithuania" choice), then remember it.
- Q: How should a movie's screenings be laid out on the page? → A: One timeline sorted by start
  time; each row shows the cinema.
- Q: When the site can't tell for sure whether two cinema listings are the same movie, what should
  it do? → A: Merge only confident matches; show uncertain ones as separate movies and log them
  for the maintainer to review.
- Q: In what order should movies appear in the "currently showing" list? → A: Movies showing
  today first, ordered by number of screenings (most first); movies that start on later dates
  come after, labelled with their first date.

### Session 2026-11-02

- Q: Should screenings show a "2D" tag? → A: No (owner decision). 2D is the default viewing
  experience and nearly every screening in Lithuania is 2D, so only special formats (3D, IMAX, 4DX,
  ScreenX, other) are tagged and offered as filters. A movie shown in 2D and IMAX therefore still
  offers an IMAX filter, on its own.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See today's screenings of a movie across all cinemas (Priority: P1)

A moviegoer opens the website and sees the list of movies currently showing in Lithuanian
cinemas. They pick a movie and immediately see every remaining screening of it today, from every
supported cinema, in one place, ordered by start time. Each screening shows the venue, start time,
and key details (hall, format, language/subtitles). From any screening they can jump to that
cinema's own page to buy a ticket.

**Why this priority**: This is the core value: replacing the habit of checking several cinema
websites one by one with a single view. On its own it already solves the user's problem for the
most common case ("where can I see this tonight?").

**Independent Test**: Open the site, select any currently showing movie, and confirm that the
screening list for today matches what each supported cinema publishes on its own website for that
movie and day.

**Acceptance Scenarios**:

1. **Given** the user opens the website for the first time, **When** the page loads, **Then** they
   see all of Lithuania, and are offered once a choice of city beside the content.
2. **Given** the user has chosen a city, **When** the home page loads, **Then** they see all movies
   that have at least one upcoming screening at a supported cinema in that city (or anywhere, for
   "All of Lithuania"), each with its title and poster, ordered as described in FR-003.
3. **Given** the user is viewing the movie list, **When** they select a movie, **Then** they see all
   of today's not-yet-started screenings of that movie at the supported cinemas in their chosen
   city, sorted by start time.
4. **Given** the user sees a screening, **When** they look at it, **Then** it shows the cinema name,
   city, start time, and any available hall, special format (e.g., 3D, IMAX; 2D, the default, is
   not shown), and language/subtitle details.
5. **Given** the user chooses a screening, **When** they select "Buy ticket", **Then** they are
   taken to that cinema's own page for that screening (or the movie's page at that cinema if no
   direct screening link is available), opened in a new tab.
6. **Given** a movie has no more screenings today, **When** the user selects it, **Then** they see a
   clear message saying so and a shortcut to the next date that has screenings.

---

### User Story 2 - Choose a different date (Priority: P2)

The user wants to plan ahead, e.g. for the weekend. While viewing a movie's screenings, they switch
from today to a future date and see that day's screenings across all cinemas.

**Why this priority**: Planning ahead is a frequent, but secondary, use case; today's view covers
the most common need.

**Independent Test**: Select a movie, pick a future date, and confirm the listed screenings match
the cinemas' published schedules for that date.

**Acceptance Scenarios**:

1. **Given** the user is viewing a movie's screenings, **When** the page first opens, **Then** today's
   date is selected by default.
2. **Given** the user is viewing a movie's screenings, **When** they choose a future date, **Then**
   the list updates to show all screenings of that movie on that date at the supported cinemas in
   the chosen city.
3. **Given** the date picker is shown, **When** the user looks at the available dates, **Then** only
   today and future dates for which at least one cinema has published a schedule can be chosen,
   and dates on which the selected movie has screenings are visibly distinguished.
4. **Given** the user has selected a movie and date, **When** they share or reload the page link,
   **Then** the same movie and date are shown.

---

### User Story 3 - Narrow down screenings by city, cinema, and format (Priority: P3)

The user only cares about cinemas in their city, or wants to see only original-language
screenings. They filter the screening list by city, cinema, and format/language.

**Why this priority**: Improves convenience once the list gets long, but the core comparison
works without it.

**Independent Test**: Apply each filter on a movie with many screenings and confirm only matching
screenings remain, and that clearing filters restores the full list.

**Acceptance Scenarios**:

1. **Given** a movie with screenings in several cities, **When** the user changes their city (or
   picks "All of Lithuania"), **Then** the movie list and screenings update to that choice.
2. **Given** a screening list, **When** the user selects one or more cinemas, **Then** only
   screenings at those cinemas are shown.
3. **Given** a screening list, **When** the user filters by format or language (e.g., original
   language with subtitles, dubbed, 3D), **Then** only matching screenings are shown.
4. **Given** the user has chosen filters, **When** they return to the website later on the same
   device, **Then** their city choice is remembered.
5. **Given** filters remove every screening, **When** the list is empty, **Then** the user sees a
   message explaining that no screenings match and a one-click way to clear the filters.

---

### Edge Cases

- **Same movie, different titles**: cinemas may list the same movie under slightly different
  names (Lithuanian vs. original title, extra tags like "(LT subtitrai)" or "3D"). These MUST be
  shown as one movie, not duplicates. Different films with similar titles (e.g., a remake and
  the original, or two parts of a series) MUST NOT be merged; when unsure, they stay separate.
- **A cinema is unavailable**: if schedule data from one cinema cannot be refreshed, screenings from
  the other cinemas are still shown; once that cinema's data has not been refreshed for 3 hours,
  the user is told which cinema's times may be missing or out of date.
- **Schedule changes**: if a cinema changes or cancels a screening, the site reflects the change at
  the next refresh; the cinema's own page remains the source of truth when buying.
- **Screenings around midnight**: a screening starting after midnight belongs to the calendar date
  it starts on.
- **Screening in progress**: today's screenings that have already started are hidden.
- **Movie with no remaining screenings at all**: it disappears from the "currently showing" list.
- **Special events** (premieres, festival screenings, live broadcasts) that cinemas list alongside
  regular screenings are shown like movies if they have a title and a start time.
- **No schedule yet**: if no cinema has published a schedule for a date, that date cannot be
  selected.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST collect current and upcoming screening schedules from every
  supported cinema.
- **FR-002**: The system MUST cover all locations of the supported cinemas across Lithuania, in
  every city where they operate.
- **FR-003**: The system MUST show a list of all movies with at least one upcoming screening at a
  supported cinema in the chosen city, with title and poster (or a placeholder when no poster is
  available). Movies with remaining screenings today MUST come first, ordered by their number of
  screenings today (most first, ties by title); movies that start on later dates MUST follow,
  ordered by their first screening date and labelled with that date.
- **FR-004**: Users MUST be able to search the movie list by title (Lithuanian or original).
- **FR-005**: The system MUST treat listings of the same movie from different cinemas as a single
  movie, even when their titles differ in language or formatting. Listings MUST be merged only
  when the match is confident; uncertain matches MUST be shown as separate movies and recorded
  for the maintainer to review. A wrong merge is treated as worse than a duplicate.
- **FR-006**: When a user selects a movie, the system MUST show all its screenings for the selected
  date at the supported cinemas in the chosen city (see FR-013), with today selected by default.
  Screenings MUST be shown as a single timeline sorted by start time (not grouped by cinema),
  with the cinema named on each row; screenings starting at the same time are ordered by cinema
  name.
- **FR-007**: For today, the system MUST hide screenings that have already started.
- **FR-008**: Each screening MUST show cinema name, city, date, start time, and, when the cinema
  provides them, hall, format, and language/subtitle details. 2D is the default and MUST NOT be
  shown; only special formats are.
- **FR-009**: Each screening MUST link to the corresponding page on the cinema's own website so the
  user can buy a ticket there.
- **FR-010**: Users MUST be able to choose any date from today up to the furthest date for which at
  least one cinema has published screenings.
- **FR-011**: The selected movie and date MUST be reflected in the page address, so the view can be
  bookmarked, shared, and reloaded.
- **FR-012**: Users MUST be able to filter screenings by city, by cinema, and by format/language.
  Format filters offer special formats only, not 2D, and appear whenever one would narrow the list.
- **FR-013**: On a user's first visit, the system MUST show all of Lithuania and offer a choice of
  city once, beside the content rather than blocking it (changed by feature 003's FR-006). It MUST
  remember the answer on the same device without requiring an account. The movie list and
  screenings MUST be limited to the chosen city, and the user MUST be able to change it at any time.
- **FR-014**: Schedule data MUST be refreshed at least every 3 hours, and the page MUST show when the
  data was last updated.
- **FR-015**: If data from a cinema could not be refreshed, the system MUST keep showing data from
  other cinemas; once a cinema's data has not been successfully refreshed for 3 hours (see FR-014,
  SC-005), the system MUST clearly indicate which cinema's information may be missing or outdated.
- **FR-016**: All dates and times MUST be shown in Lithuanian local time.
- **FR-017**: The interface MUST be available in Lithuanian (default) and English, with a visible
  language switch; the chosen language MUST be remembered on the same device. Movie titles are
  shown as the cinemas publish them, with the original title also shown where available.
- **FR-018**: The website MUST be fully usable on mobile phones and desktop browsers.
- **FR-019**: The website MUST NOT require users to sign in.

### Key Entities

- **Cinema (Venue)**: a cinema location where screenings take place; has a name, chain/operator
  (e.g., Apollo, Forum Cinemas), city, address, and website link.
- **Movie**: a film or event that is currently showing; has a display title, original title,
  poster, and optionally duration, age rating, and genre. One movie groups the listings of the
  same film from all cinemas.
- **Screening**: one showing of a movie at a cinema; has the movie, cinema, date and start time,
  and optionally hall, format, language/subtitles, and a link to buy tickets.
- **Data Source Status**: for each cinema, when its schedule was last successfully refreshed and
  whether the latest refresh failed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from opening the website to seeing every screening of a chosen movie
  today at the supported cinemas in their city in under 15 seconds and no more than 2 selections
  (3 on the first visit, including choosing the city).
- **SC-002**: The movie list and a movie's screening list appear in under 2 seconds on a typical
  mobile connection.
- **SC-003**: At least 98% of the screenings published by supported cinemas for the next 7 days
  appear on the website, with correct cinema, date, and start time.
- **SC-004**: Fewer than 1% of movies appear as duplicates because of differing titles across
  cinemas, and no screening is ever shown under the wrong movie.
- **SC-005**: Screening data shown is never more than 3 hours older than the cinemas' own
  schedules, except where the site explicitly flags a cinema as out of date.
- **SC-006**: 9 out of 10 test users can find a screening that suits them and reach the cinema's
  ticket page without help on their first visit.
- **SC-007**: The site serves about 1,000 visitors a day with peaks of 100 people using it at the
  same time (Friday and weekend evenings) while still meeting SC-002, and the design can grow to
  10x that load without a rewrite.

## Assumptions

- **Supported cinemas (initial list)**: Apollo Kinas, Forum Cinemas, Vue (formerly Multikino),
  Pasaka, Skalvija, and Atlantis, as named by the user, plus Romuva (Kaunas), Garsas (Panevėžys)
  and Cinamon Mega (Kaunas), found during planning
  research, and Arlekinas (Klaipėda), added by owner decision on 2026-11-04. Which of these currently operate, and where, MUST be verified
  during planning; more cinemas can be added later.
- **Data availability**: each supported cinema publishes its schedule publicly on its website
  (or a public feed), and collecting that data for display with a link back to the cinema is
  acceptable. This MUST be verified per cinema during planning.
- **Ticketing**: ticket purchase happens on the cinema's own website; this website does not sell
  tickets, show seat availability, or show prices.
- **Audience**: the website is public and free to use for anyone; there are no user accounts in
  this version.
- **Date range**: the furthest selectable date depends on how far ahead cinemas publish schedules,
  typically 7–14 days.
- **Out of scope for this version**: movie reviews and ratings, trailers, notifications or alerts,
  favourites/watchlists, and price comparison.
