# Reading an unknown comic site

A source has to hit exactly five targets. Work them in order and write down the URL,
selectors and pagination signal for each before writing any code. Guessed selectors
produce a source that builds, typechecks, and returns nothing.

## Probing

See if you can launch a browser that you can use to navigate first. Such as claude browser or copilot browser or codex browser.
If you do not have the ability to handle a browser, use playwright & curl to navgiate a page

Fetch pages the way the source will, and look at what actually came back — not what the
site looks like in a browser, which has run JavaScript your source cannot.

If the markup has no titles but the page does in a browser, the data arrives by XHR. Find
it in DevTools → Network → Fetch/XHR, and call that endpoint directly — a JSON API is
always better than scraping the rendered result.

**Cloudflare.** If you get a 403/503, a `<title>Just a moment`, `challenges.cloudflare.com`,
or a `cf_chl` marker, the site is challenge-protected. Set `config.cloudflareResolutionURL`
so the app can hand the user a WebView to solve it, throw `CloudflareError(BASE_URL)` from
the response interceptor (`buildClient` in `client.ts` already does both), and expect
`bun run verify` to report SKIP rather than PASS. After that, if you're controlling the
browser do the challenge and continue or have your human do it for you.

## Target 1 — Home sections

What the landing page offers, plus whatever "popular" / "latest" / category routes exist.
Each becomes a `SectionSpec` (see `forms/sections.ts`):

```ts
{ id, title, subtitle?, style?, viewMore?, load(page) }
```

- `load(page)` returns a full `PagedSearchResult`, so a section and its "view more" page can
  never drift apart — the same function backs both.
- Set `viewMore: false` for a carousel with no paginated equivalent (Batcave's homepage hero).
- Pick `style` from `SectionStyle`: `SimpleHero` for a big carousel, `DetailedTripleRowPaged`
  for a dense grid, `DetailedVerticalListGrouped` for a "latest updates" list.
- If the homepage needs a warm-up request before its sections resolve (cookies, a session),
  implement `willResolveSectionsForPage`.

## Target 2 — Search and filters

Establish three things.

**The search URL shape.** Query-string (`/?s=term`, `/search?kwd=term&p=2`) or path-segment
(`/search/term/latest/page/2`). Try a two-word query and a punctuation-heavy one; some sites
404 on unencoded input, which is why Batcave keeps a `relaxSearchTitle` fallback that strips
punctuation and retries.

**The facets.** Open the site's own filter UI and read the form controls. Map them:

| Site control         | Field builder                 | Read it back with        |
| -------------------- | ----------------------------- | ------------------------ |
| dropdown             | `SearchPicker`                | `filters.option(id)`     |
| checkbox list        | `SearchMultiPicker`           | `filters.options(id)`    |
| include/exclude tags | `SearchExcludableMultiPicker` | `filters.excludable(id)` |
| on/off               | `SearchToggle`                | `filters.toggle(id)`     |
| free text            | `SearchTextField`             | `filters.text(id)`       |
| number               | `SearchStepper`               | `filters.number(id)`     |

Only declare a filter the site actually supports. A filter that the site ignores looks like
a bug to the user.

**Pagination.** Determine which signal ends the list, and return it as `isLastPage`:

- numbered pager — compare the current page against the highest linked page (Batcave)
- `<select name="page">` — read the last `<option value>` (OceComic)
- a "next" link — test for its presence (`.pagination a[rel=next]`)
- `Page X of Y` text — parse both numbers
- API — use the response's own `has_more` / `total`

Never return `isLastPage: false` unconditionally; the app will paginate forever.

## Target 3 — Title view

Find `title`, `cover`, `summary`, `status`, `tags`. Prefer stable hooks — `id`, `data-*`,
semantic class names — over positional selectors; never `nth-child`.

`<meta property="og:image">` and `og:title` are usually the most robust cover/title source
on WordPress-style sites. Covers are frequently lazy-loaded: read attributes in the order
`data-src`, `data-original`, `data-lazy-src`, `srcset`, `src` — the `imageSrc()` helper at
the bottom of each `main.ts` does this and takes the first URL out of a `srcset`.

Map the site's status wording onto `PublicationStatus`, and return `undefined` when it does
not say — do not default to `ONGOING`. If the page exposes AniList/MAL ids, put them in
`trackerInfo`.

## Target 4 — Chapter list

Three places it can live, in increasing order of effort:

1. **In the markup** — a list of anchors. Straightforward.
2. **In an inline script** — `window.__DATA__ = {...}`, `__NEXT_DATA__`, or
   `application/ld+json`. Copy `balancedJson` / `scriptJson` from `src/Batcave/main.ts`:
   they scan for a _balanced_ JSON region, so they survive nested objects that a
   `/\{[\s\S]*?\}/` regex would truncate. For `__NEXT_DATA__` or JSON-LD the script is a
   single well-formed blob, so `JSON.parse($("script#__NEXT_DATA__").html())` is enough.
3. **Behind an AJAX endpoint** — a POST to a controller with the title id. Batcave's
   `getChapterData` is the worked example: derive the id from the `contentId`, POST
   form-encoded via `encodeForm`, parse the JSON envelope, and check its `success` flag
   before trusting `data`.

Deriving the fields: `index` must be 0-based and contiguous after any filtering — build the
array and assign `index` from its length as you push, rather than from the source loop
counter. Use the local `chapterNumber(title, fallback)` helper for `number`, and a date
helper that returns `undefined` on failure so the call site can `?? new Date(0)` — never
hand back an invalid `Date`.

If the site puts the whole chapter list on the title page, you may return them in
`Content.chapters` and omit `getChapters` — but see bit 20 in `api.md` before choosing that.

## Target 5 — Chapter pages

Find the image list. Same lazy-load attribute problem as covers — use `imageSrc()`.
Absolutise every URL with the local `absolute()` helper, which handles protocol-relative
`//`, root-relative, relative, and the `\/`-escaped URLs you get out of inline JSON.

Throw with a useful message when you find zero pages. A silent empty array shows the user a
blank reader with nothing to act on; the throw is your only diagnostic channel.

If images 403 when the reader loads them, the CDN wants a referer. Implement
`willRequestImage` and return a `NetworkRequest` with `origin` and `referer` set to the
host the image belongs to — Batcave maps CDN hosts to their own origin because its images
come from a different domain than its pages.

## Before you write code

You should now have, written down:

- 5 URLs, one per target
- a selector or JSON path for every field you intend to populate
- the pagination signal
- the list of facets the site genuinely supports
- whether images need a referer

Anything still unknown is something to go and check, not to guess.
