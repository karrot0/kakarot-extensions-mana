---
name: mana-extension
description: Create or update a Mana content source (extension) in this repo. Use when adding a comic/manga site as a source, scaffolding a new extension, fixing or extending an existing one, migrating a source to the current @mana-app/types API.
---

# Building Mana extensions

A source is a TypeScript class exported as `Target` that Mana instantiates and calls.
The app only calls methods it detects on that instance, so **which methods you define
decides what the app shows**. Get that wrong and the feature does not exist.

Work in four phases. Do not skip ahead: every phase depends on facts established by the
one before it.

## Phase 1 — Recon

Never write selectors from memory. Fetch the real pages first and confirm every
selector against actual markup.

Read `references/recon.md` and work through its five targets in order:

1. **Home sections** — what the home page offers, and its category/popular/latest routes
2. **Search + filters** — the search URL shape, the facets the site exposes, and how it paginates
3. **Title view** — when going to the main page of a content, title, cover, summary, status, tags
4. **Chapter list** — inline markup, an inline-script JSON blob, or an AJAX endpoint
5. **Chapter pages** — the image list, its lazy-load attributes, and any referer requirement

Write down, before coding: the exact URL for each of the five, the selector or JSON path
for every field, and the pagination signal.

## Phase 2 — Scaffold

```bash
bun run new-source <Name> --id <id> --url <https://site>
```

Copies `templates/source/` to `src/<Name>/`, rewrites the class and `info` block, seeds the
CHANGELOG section and README row. Then drop an icon at `assets/<Name>.png`
(repo root, not inside the source directory).

A source directory holds only what is specific to its site (the icon lives in the root
`assets/` folder, named after the source). Everything sources have in common lives once
in `lib/` and is inlined into each `.mana` bundle at build time:

```
src/<Name>/
  model.ts      site constants, filter/sort definitions, API types
  main.ts       info, config, the source class, then its URL builders and parsers
lib/
  source.ts     BaseSource: lazy network client, home sections, "view more" listings
  client.ts     network client + Cloudflare detection
  html.ts       fetchHtml and the cheerio helpers (text, imageSrc, absolute, slug, ...)
  forms/        query.ts filters.ts search.ts sections.ts preferences.ts index.ts
```

Never copy anything from `lib/` into a source. Fix shared code in `lib/` and every source
picks it up on the next build.

## Phase 3 — Implement

Read `references/api.md` for the type surface and the intent rules, and
`references/toolkit.md` for what `lib/` already does — search forms, filter reading,
home sections, preferences, query strings and the common cheerio helpers are all there,
so do not hand-roll them.

Site-specific parsers and URL builders go at the bottom of `main.ts`, below the class, and
the class itself only fetches and orchestrates: use cheerio directly for traversal, import
the small helpers from `lib/html.ts`, and only write a local helper when the site needs
something `lib/html.ts` does not do. Copy the shape from `templates/source/` rather than
inventing a new one.

Three rules that are not obvious and cause silent breakage:

- **Method presence is the feature flag.** `getSearchForm` is what makes filters appear;
  `getSortOptions` is what makes sorting appear; `getSectionsForPage` _and_
  `resolvePageSection` are both required for a home page. Do not define a method you
  cannot back with real data — an empty sort list is worse than no sort list.
- **Read filters through `FilterReader`.** A `SELECT` filter hands back an `Option`
  object, not a string. `filters[id] as string` yields `undefined` and the filter
  silently does nothing. This exact bug shipped in every source in this repo.
- **Never assign the network client in `onEnvironmentLoaded`.** It is not awaited before
  the first method call. Extend `BaseSource` and return the options from
  `clientOptions()`; its `http` getter builds the client lazily.

House style: no comments in source files, everything typed, no `any`. The one exception
is a comment that records a non-obvious runtime constraint someone would otherwise
"fix". Remain consistant and create helpers over duplication.

## Phase 4 — Verify

All four gates must pass before the work is done:

```bash
bun run lint && bun run format && bun run typecheck && bun run build
```

Then confirm the app will actually see the intents you intended:

```bash
node -e "const d=require('./dist/sources.json');for(const s of d.sources)console.log(s.name,s.intents.toString(2).padStart(25,'0'))"
```

Then run the contract test against the live site:

```bash
bun run verify <Name>
```

It drives the built `.mana` bundle through the methods the app calls and checks the shape
of what comes back. Fill `scripts/probes/<Name>.json` with a real `contentId` (and
`chapterId` if the first chapter is not representative) or the content half is skipped. A Cloudflare
block reports SKIP, not FAIL — that is expected for protected sites and is not a pass.

Finish with `references/release.md`: version bump, CHANGELOG entry in the exact format the
page generator parses, README row.

## Updating an existing source

Site markup changes constantly. When a source breaks, re-run Phase 1 for the specific
broken target — do not guess at a selector fix. `bun run verify <Name>` tells you which of
the five targets broke.

If a source still calls `getSearchFilters`, sets `Content.isNSFW`, or sets
`SourceConfig.disableTagNavigation`, it is written against a removed API and its filters
are dead. `references/api.md` has the migration recipe.

Two removals from `@mana-app/types@0.0.25` are worth checking by hand, because `typecheck`
catches the first and stays silent on the second:

- `SearchSortStyle` and `SearchPickerPresentation` are gone. Presentation is now chosen by
  which builder you call (`SearchMenuPicker`, `SearchPickerSheet`, …).
- `getChapters`/`getChapterData` moved off `ContentSource` onto a new `ChapterSource`. A
  source that declares `implements ContentSource` and defines them still compiles, so grep
  for it rather than trusting a green gate.
