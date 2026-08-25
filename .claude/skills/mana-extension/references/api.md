# The `@mana-app/types` surface and the runtime that consumes it

Verified against `@mana-app/types@0.0.24` and `@mana-app/dev@0.1.13` by reading the
type declarations and the runtime embedded in `mana-dev`.

## How the app decides what your source can do

`mana-dev` instantiates your `Target` and reads properties off the instance to compute an
**intent bitmask**, stored in `dist/sources.json`. The app then only offers features whose
bit is set. Methods inherited from a base class or defined on a prototype are detected
normally; a method that does not exist is a feature that does not exist.

| Bit | Intent | Set when the instance has |
| --- | --- | --- |
| 0 | `preferenceMenuBuilder` | `getPreferenceMenu` |
| 1 | `requiresSetup` | `getSetupMenu` **and** `validateSetupForm` **and** `isRunnerSetup` |
| 2 | `imageRequestHandler` | `willRequestImage` |
| 3 | `pageLinkResolver` | `getSectionsForPage` **and** `resolvePageSection` |
| 4 | `libraryPageLinkProvider` | `getLibraryPageLinks` |
| 5 | `authenticatable` | `getAuthenticatedUser` + `handleUserSignOut` **and** one flavour below |
| 6 | `basicAuth` | `handleBasicAuth` |
| 7 | `basicAuthUsesEmail` | `BasicAuthenticationUIIdentifier === EMAIL` |
| 8 | `webviewAuth` | `getWebAuthRequestURL` + `didReceiveSessionCookieFromWebAuthResponse` |
| 9 | `oauthAuth` | `getOAuthRequestURL` + `handleOAuthCallback` |
| 10 | `providesSearch` | `search` |
| 11 | `providesSearchForm` | `getSearchForm` |
| 12 | `providesSearchSortOptions` | `getSortOptions` |
| 13 | `chapterEventHandler` | `getContent` + `onChaptersMarked` + `onChapterRead` |
| 14 | `contentEventHandler` | `getContent` + `onContentsAddedToLibrary` + `onContentsRemovedFromLibrary` |
| 15 | `librarySyncHandler` | `getContent` + `syncUserLibrary` |
| 16 | `pageReadHandler` | `getContent` + `onPageRead` |
| 17 | `progressSyncHandler` | `getContent` + `getProgressState` |
| 18 | `groupedUpdateFetcher` | `getContent` + `getGroupedUpdates` |
| 19 | `redrawingHandler` | `getContent` + `shouldRedrawImage` + `redrawImageWithSize` |
| 20 | `chaptersInContent` | `getChapterData` present **and `getChapters` absent** |
| 21 | `providesChapters` | `getContent` + `getChapterData` |
| 22 | `canHandleURL` | `handleURL` |
| 23 | `allowsMultipleInstances` | `config.allowsMultipleInstances` |
| 24 | `requiresAuthenticationToAccessContent` | `config.requiresAuthenticationToAccessContent` |

Check your own build with:

```bash
node -e "const d=require('./dist/sources.json');for(const s of d.sources)console.log(s.name, s.intents)"
```

Two traps worth calling out:

- **Bit 20.** Omitting `getChapters` does not mean "no chapters" — it means "chapters
  arrive inside `Content.chapters`". Either implement `getChapters`, or return chapters
  from `getContent`. Doing neither leaves the app expecting inline chapters it never gets.
- **Bit 1.** The runtime checks `target.isRunnerSetup`, but `SourceSetupProvider` in the
  `.d.ts` declares `isSourceSetup`. Implementing only the typed name produces a source that
  never reports as requiring setup. Define both if you need setup.

## Runtime constraints

The source runs in a bare V8 / JavaScriptCore context, not Node and not a browser.

- **No `fetch`, `URL`, `URLSearchParams`, `TextEncoder`/`TextDecoder`, `DOMParser`.** Build
  query strings yourself — `withQuery` in `forms/query.ts` does it. `Buffer` exists only as a
  bundler-injected shim.
- **`console` may not exist.** Do not rely on logging. A thrown `Error` message is the only
  diagnostic channel guaranteed to reach the user, so put real detail in it.
- **`NetworkResponse.data` is always a `string`.** There is no binary response mode; a
  non-UTF-8 body may not survive the bridge at all.
- **`onEnvironmentLoaded` is not awaited.** The runtime calls
  `target.onEnvironmentLoaded?.().catch(...)` and moves on, so anything it assigns can still
  be undefined when the first real method runs. Build the client lazily instead.
- **`Target` must be an exported class.** The bundle ends in
  `globalThis.Target = __exports__.Target`; a source directory without one fails the build
  with `No Target class found in self-contained bundle`.

Host globals available: `NetworkClient`, `NetworkClientBuilder` (imported from the types
package), `CloudflareError`, `NetworkError`, `ObjectStore`, `SecureStore`, `WebViewPage`.

**`ObjectStore`/`SecureStore` typed accessors throw on a type mismatch.** `set(k, v)` takes
any value and stores it natively; `string()`, `boolean()`, `number()` and `stringArray()`
each throw if the stored value is not that type. Reading a preference without catching that
throw fails the whole `getPreferenceMenu` call, and the app surfaces it as a load failure
rather than a per-field problem. Store native values, read with the matching accessor, and
wrap every read.

## Search: the current API

`SearchProvider` is:

```ts
search(request: SearchRequest): Promise<PagedSearchResult>;
getSearchForm?(): Promise<SearchForm>;
getSortOptions?(): Promise<SortOption[]>;
validateSearchForm?(form: SearchFormSubmission): Promise<SearchFormValidationResult>;
```

A `SearchForm` is `{ sections: SearchSection[] }`, built from three section builders —
`SearchListSection`, `SearchTagsSection`, `SearchSortSection` — holding fields built from
`SearchPicker`, `SearchMultiPicker`, `SearchExcludableMultiPicker`, `SearchToggle`,
`SearchTextField`, `SearchStepper`, `SearchDatePicker`. All are exported from
`@mana-app/types`. `buildSearchForm` in `forms/search.ts` assembles them.

`SearchRequest.filters` values are `FilterPrimitives`:
`string | boolean | number | Option | Option[] | ExcludableMultiSelectProp`. **The shape
depends on the field type**, which is why `FilterReader` exists.

### Migrating a pre-0.0.24 source

| Remove | Replace with |
| --- | --- |
| `getSearchFilters(): Promise<SearchFilter[]>` | `getSearchForm(): Promise<SearchForm>` via `buildSearchForm` |
| `FILTERS: SearchFilter[]` in `model.ts` | `SearchListField[]` from the builders, plus an optional tags field |
| `filters[FilterID.X] as string` | `new FilterReader(request).option(FilterID.X)` |
| `Content.isNSFW: boolean` | `contentRating: ContentRating` (`SAFE`/`SUGGESTIVE`/`MATURE`/`EXPLICIT`) |
| `SourceConfig.disableTagNavigation` | nothing — the key was removed |
| `SourceInfo.rating` as NSFW enum | `CatalogRating` (`SAFE`/`MIXED`/`EXPLICIT`) |

Nothing warns you about any of these: `mana-dev` bundles with esbuild, which strips types
without checking them. `bun run typecheck` is the gate that catches it.

## Content shapes

`Content` extends `BaseItem` (`title`, `cover`, `contentRating?`, `webUrl?`) with
`status`, `summary`, `tags`, `contentType`, `recommendedPanelMode`, `additionalInfo`,
`trackerInfo`, and optionally `chapters`.

`Chapter` requires `chapterId`, `number`, `index`, `date`, `language`. **`index` must start
at 0 and be contiguous** — the first available chapter is index 0. `date` must be a valid
`Date`; use `new Date(0)` when the site publishes none rather than an invalid date.

`ChapterData` is `{ pages?: ChapterPage[] }` where each page has `url` or a base64 `raw`.

`Highlight` needs `id`, `title`, `cover`, and optionally `subtitle`, `badge`, `link`. A
`link` carrying a `SearchRequest` makes the tile open a filtered list instead of a title —
that is how KakarotComics makes a character tile show the character's series.

`additionalInfo` sections are built with the `additionalInfo.{staff,characters,links,tags,highlights}`
helpers exported from the types package; do not hand-write the `type` discriminants.
