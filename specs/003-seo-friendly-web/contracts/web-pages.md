# Contract: Public Pages for People and Crawlers

**Feature**: [../spec.md](../spec.md)

Extends [feature 001's web routes](../../001-cinema-showtimes/contracts/web-routes.md). What's below is
promised on the production address. Changes require a spec change.

## Addresses and responses

| Request | Response |
|---------|----------|
| `/` with the cookie `seansai_lang=en` | Temporary redirect to `/en/` |
| `/` otherwise | Temporary redirect to `/lt/` |
| `/{lang}/` | 200, general movie list |
| `/{lang}/city/{cityId}` | 200, that city's movie list. **New.** |
| `/{lang}/movie/{movieId}` | 200, the movie |
| The above with `?date=`, `?city=`, `?cinema=`, `?format=`, `?audio=` | 200, the same file. The app applies the options as it does today. |
| `/xx/...` with an unknown two-letter language | Permanent redirect to `/lt/...`, keeping the rest of the address |
| Any other unknown address, an unknown movie or an unknown city | 404, with a page that still boots the app and shows its not-found page |
| `/sitemap.xml`, `/robots.txt` | 200 in the proper format |
| `/api/...` | As today, plus `X-Robots-Tag: noindex` |

`{lang}` is `lt` or `en`. All pages keep the security headers from feature 002.

## What each page contains in its first response

For every page in the site map, without running scripts:

- `<html lang="{lang}">`
- `<title>`, and `<meta name="description">`
- `<link rel="canonical">` with the full preferred address ([rules](../data-model.md#preferred-address))
- `<link rel="alternate" hreflang="lt|en|x-default">`, with full addresses
- `og:title`, `og:description`, `og:image`, `og:url`, `og:type`, `og:locale`, `twitter:card`
- One `<h1>` and the page's main content inside `#root`
- A site icon link

| Page | Main content |
|------|--------------|
| General list | Every current movie with a plain link to its page, and links to every city list that has movies |
| City list | That city's movies with plain links. The city named in the title, description and `<h1>`. |
| Movie | Title, facts, summary of when and where it's next showing, the screenings for today or the next-date link, and each screening's ticket link |

These match what a first-time visitor sees at that address (FR-002).

## First visit

- Content appears immediately, showing all of Lithuania.
- A city choice sits at the top of the page in normal reading order: it doesn't block, cover or take focus.
- "Choose city" opens the existing dialog. Choosing there remembers that city, and on a list page goes to that
  city's page.
- "Keep all of Lithuania" remembers `all`.
- Either answer removes the choice, and it doesn't come back on that device. The header's city switcher is
  always available.

## Crawl instructions

`/robots.txt`, exactly:

```text
User-agent: *
Allow: /

Sitemap: {SITE_URL}/sitemap.xml
```

The API isn't blocked, because crawlers need it to render pages. `X-Robots-Tag: noindex` keeps it out of
results instead.

## Copies other than production

| Copy | Behaviour |
|------|-----------|
| Vercel previews and earlier deployments | Vercel sends `X-Robots-Tag: noindex`. Canonical links name the production address. |
| Self-hosted container | No snapshot, site map or robots file. Every response sends `X-Robots-Tag: noindex`. The app works as a single-page app, including the new first-visit flow. |
