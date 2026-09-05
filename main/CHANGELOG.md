# Changelog

Notable changes to the extensions in this repository, grouped by extension —
each one versions independently (see `info.version` in its `main.ts`). Dates
are UTC. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Batcave (current: v1.7.1)

### 2026-09-05 — @mana-app/types 0.0.25

- Migrated to the `ChapterSource` interface. `getChapters`/`getChapterData` moved
  off `ContentSource` in 0.0.25; the old declaration still compiled, so nothing
  flagged it.
- Dropped `SearchSortStyle`, removed from the types package. No source passed a
  sort style, so the rendered form is unchanged.
- Page fetches now go through `getText`, so a listing carrying malformed UTF-8
  is recovered through a WebView instead of failing the request.

### 2026-08-25

- **Search filters work again.** The genre filter was declared through
  `getSearchFilters`, which no longer exists in `@mana-app/types` — the app
  never saw it. It is now a `getSearchForm` tags section, and the selected
  genre is read through `FilterReader` rather than an `as string` cast that
  always yielded `undefined`.
- Chapter dates are parsed from the site's `DD.MM.YYYY` format via the shared
  `parseDate` instead of a local regex.
- The `window.__DATA__` chapter payload is extracted with a balanced-brace
  scanner, so a nested object no longer truncates the chapter list.
- Removed `config.disableTagNavigation`, which was dropped from `SourceConfig`.
- Network client, image referer rules and parsing moved onto the shared toolkit.

## KakarotComics (current: v1.2.1)

### 2026-09-05 — @mana-app/types 0.0.25

- Migrated to the `ChapterSource` interface. `getChapters`/`getChapterData` moved
  off `ContentSource` in 0.0.25; the old declaration still compiled, so nothing
  flagged it.
- Dropped `SearchSortStyle`, removed from the types package. No source passed a
  sort style, so the rendered form is unchanged.

### 2026-08-25 — Settings fix

- **Settings could fail to open.** Preference values were read with
  `ObjectStore.string()` regardless of their type, and that accessor throws when
  the stored value is not a string — one non-string value took down the whole
  preference form. Values are now stored natively and read with the accessor
  matching their type, with every read wrapped so a corrupt or legacy value
  falls back to its default instead of failing the form.
- Preference values are no longer double JSON-encoded. Values written by the
  previous version are still read correctly.
- The publisher allowlist is no longer blanked when the publisher list cannot be
  fetched — a selection is only reconciled against the option list when that
  list is non-empty, so an unreachable server no longer wipes the saved choice
  on the next edit.
- Preference element ids are the full store key again, matching the convention
  used before the refactor.
- A picker whose options cannot be loaded is no longer emitted with an empty
  options list, and a section left with no renderable fields is dropped rather
  than sent empty. When the publisher list is unreachable the settings screen
  now shows the server field plus a note explaining what is missing, instead of
  a control the app cannot present.

### 2026-08-25

- **Search filters work again** — type, publisher, character and year are now a
  `getSearchForm` list section, read through `FilterReader`.
- Preferences (API base URL, publisher allowlist) are built from a declarative
  spec and persisted through `PreferenceStore`. Existing settings are preserved:
  the store keeps the original `kakarot-comics.*` keys and falls back to reading
  a raw string when the stored value predates JSON encoding.
- The network client is built lazily on first use rather than in
  `onEnvironmentLoaded`, which the runtime does not await.

### 2026-08-13 — Initial implementation

- Browses a self-hosted comic-api catalogue: publishers, characters, series,
  and issues, with search, a publisher-allowlist preference, and page
  reading proxied through the server.

## OceComic (current: v1.2.1)

### 2026-09-05 — @mana-app/types 0.0.25

- Migrated to the `ChapterSource` interface. `getChapters`/`getChapterData` moved
  off `ContentSource` in 0.0.25; the old declaration still compiled, so nothing
  flagged it.
- Dropped `SearchSortStyle`, removed from the types package. No source passed a
  sort style, so the rendered form is unchanged.
- Card titles are cut at the U+FFFD the WebView substitutes even when the title
  comes from the `title` attribute, not just from the visible link text.

### 2026-08-25 — Listing pages load again

- **Sections failed with "String could not be serialized with encoding: Unicode
  (UTF-8)".** ocecomic.com truncates card titles and blurbs at a fixed byte
  count, cutting multi-byte characters in half, so listing pages ship bytes that
  are not valid UTF-8. Mana decodes response bodies natively before a source
  sees them, so the request rejected outright — five of eight "New Comics" pages
  sampled were affected. Pages the bridge cannot decode are now re-read through
  an auxiliary WebView, whose parser substitutes U+FFFD for the malformed bytes
  instead of failing.
- Card titles are read from the untruncated `title` attribute rather than the
  truncated link text, so results no longer end in "...".

### 2026-08-25

- **Search filters work again.** The genre filter never reached the app, and the
  `filters[id] as string` read would have returned `undefined` even if it had —
  browsing was pinned to "all" regardless of what the user picked.
- Removed `Content.isNSFW`, replaced by `contentRating`; a "Mature" genre now
  maps to `ContentRating.MATURE`.
- Removed `config.disableTagNavigation`.

## ZipComic (current: v1.1.1)

### 2026-09-05 — @mana-app/types 0.0.25

- Migrated to the `ChapterSource` interface. `getChapters`/`getChapterData` moved
  off `ContentSource` in 0.0.25; the old declaration still compiled, so nothing
  flagged it.
- Dropped `SearchSortStyle`, removed from the types package. No source passed a
  sort style, so the rendered form is unchanged.
- Page fetches now go through `getText`, so a listing carrying malformed UTF-8
  is recovered through a WebView instead of failing the request.

### 2026-08-25

- Dropped the empty filter list and the placeholder "Default" sort — the site
  exposes neither, and the source no longer advertises search-form or sort
  intents it cannot honour.
- Chapter dates are parsed from the chapter table instead of being hardcoded to
  the epoch.
- Removed `Content.isNSFW` and `config.disableTagNavigation`.

### 2026-08-03

- Registered `www.zipcomic.com` in `owningLinks`.
- Initial implementation.

## Template (current: v2.0.1)

### 2026-09-05 — @mana-app/types 0.0.25

- Migrated to the `ChapterSource` interface. `getChapters`/`getChapterData` moved
  off `ContentSource` in 0.0.25; the old declaration still compiled, so nothing
  flagged it.
- Dropped `SearchSortStyle`, removed from the types package. No source passed a
  sort style, so the rendered form is unchanged.

### 2026-08-25

- Rewritten against the current `@mana-app/types` API and split into a
  per-source toolkit: `parse.ts` (page reading), `source.ts` (filters,
  sections, preferences, query strings) and `client.ts` (network client and
  Cloudflare detection), alongside `model.ts` and `main.ts`.
- Demonstrates `getSearchForm`, `getSortOptions`, `getPreferenceMenu`, home
  sections wired to their own "view more" listings, and a lazily built network
  client.
