# What each source directory contains

```
src/<Name>/
  model.ts      site constants, filter/sort definitions, API response types
  main.ts       info, config, the source class, then its URL builders and parsers
```

Everything else is shared and lives once in `lib/`: `source.ts`, `client.ts`, `html.ts`
and `forms/`. The bundler inlines it, so each `.mana` bundle is still self-contained.
Import it as `"../../lib/<file>.ts"`; never copy it into a source.

Traversal is cheerio (`load`, `$(...)`, `.find()`, `.attr()`, `.toArray()`) and belongs in
parser functions below the class in `main.ts`. The helpers around it come from
`lib/html.ts`. Copy the shape from `templates/source/`.

## `lib/source.ts` — `BaseSource`

Every source class extends it and supplies two methods:

```ts
protected clientOptions(): ClientOptions   // what buildClient receives
protected sections(): SectionSpec[]        // the home page
```

In return it provides the lazy `this.http` client, `this.imageHttp` (the same options
without a rate limit, to return from `getCoverTransport`/`getPageTransport`),
`this.getJson<T>(path, params)` for
JSON APIs (override `apiBase()` when the server URL is configurable), `getSectionsForPage`,
`resolvePageSection`, and `this.listResults(request)` for the "view more" short-circuit at
the top of `search`. Override `resolvePageSection` only when a source has list ids that
are not home sections (see `src/KakarotComics/main.ts`).

## `lib/forms/` — the app-facing machinery

### `lib/forms/filters.ts` — `FilterReader`

**Always read search filters through this.** The runtime hands back a different JavaScript
type per field type, and `filters[id] as string` silently yields `undefined` for a
`SELECT` — that exact bug shipped in every source in this repo.

```ts
const filters = new FilterReader(request);
filters.has(id); // present and non-empty
filters.text(id); // string | Option -> its id
filters.option(id, "all"); // text() with a fallback
filters.options(id); // Option[] -> ids
filters.excludable(id); // { included, excluded }
filters.toggle(id);
filters.number(id); // NaN when absent — guard with Number.isFinite
```

### `lib/forms/search.ts` — the search form

`buildSearchForm({ fields?, header?, footer?, tags?, tagsHeader?, sortHeader?, includeSort? })`
assembles a `SearchForm` from the field builders exported by `@mana-app/types`
(`SearchPicker`, `SearchMenuPicker`, `SearchPickerSheet`, `SearchMultiPicker`,
`SearchMultiPickerSheet`, `SearchExcludableMultiPicker`, `SearchExcludableMultiPickerSheet`,
`SearchToggle`, `SearchTextField`, `SearchStepper`, `SearchDatePicker`). Declare the fields
in `model.ts`. The builder you pick is what sets the field's presentation.

Pass `includeSort: false` when the source has no meaningful sort, so the app does not show
an empty sort control.

`resolveSortId(SORT_OPTIONS, request, fallback)` validates `request.sort.id` against your
declared options and falls back to the one marked `isDefault`.

### `lib/forms/sections.ts` — home sections

```ts
private sections(): SectionSpec[] {
  return [{ id, title, subtitle?, style?, viewMore?, load: (page) => this.listing(page) }];
}

async getSectionsForPage(_link) { return toPageSections(this.sections()); }

async resolvePageSection(_link, id) {
  const spec = sectionById(this.sections(), id);
  if (!spec) return { items: [] };
  return { items: (await spec.load(1)).results };
}

async search(request) {
  const list = listResults(this.sections(), request);
  if (list) return list;
  // ...real search
}
```

`toPageSections` wires each section's `viewMoreLink` to `{ request: { page: 1, listId: id } }`
and `listResults` routes that `listId` back to the same `load`, so a section and its full
listing cannot disagree. `viewMore: false` for a carousel with no paginated equivalent.

`pageOf(request)` clamps `SearchRequest.page` to at least 1.

### `lib/forms/preferences.ts` — the preference menu

```ts
private readonly preferences = new PreferenceStore(NAMESPACE, DEFAULTS);

async getPreferenceMenu(): Promise<Form> {
  return buildPreferenceMenu(this.preferences, this.preferenceSections());
}
```

Fields are `text`, `toggle`, `select`, `multiselect`, `stepper`; `select` and `multiselect`
accept either an `Option[]` or an async function, so options can be fetched live.
`buildPreferenceMenu` reads current values and wires `didChange` to the store for you.

Values are stored **natively** through `ObjectStore.set(key, value)` and read back with the
accessor matching the declared default — `string()`, `boolean()`, `number()`, or
`stringArray()`. Those accessors **throw when the stored value is not of the requested
type**, and an uncaught throw takes down the entire settings screen, so every read is
wrapped: a mismatched, corrupt, or legacy JSON-encoded value falls back to the default
instead of failing the form.

Two further rules the store follows, both of which protect user data:

- The element `id` is the full store key (`<namespace>.<key>`), matching the convention the
  hand-written sources used.
- A `select`/`multiselect` selection is only reconciled against its option list when that
  list is non-empty. Options are often fetched live, and a failed fetch must not blank a
  saved choice — otherwise the next edit writes the blank back.

**Keep the namespace stable** — changing it orphans every existing user setting.

### `lib/forms/query.ts` — query strings

`withQuery(url, params)` drops `undefined`/`null`/empty values and encodes the rest.
`encodeForm(body)` does the same for `application/x-www-form-urlencoded` POST bodies but
keeps empty values. There is no `URLSearchParams` in the runtime, so build query strings
through these.

## `lib/client.ts` — the network client

```ts
buildClient({
  baseUrl,
  requests, // per intervalMs; 0 disables the limiter
  intervalMs,
  accept,
  headers,
  imageHeaders,
  resolutionUrl,
  originFor,
  json,
  retry,
  timeoutMs,
});
```

Returns an `HttpClient`. Applies rate limiting, sets `origin`/`referer`/`accept-language`
on every request, `accept` plus `headers` on `RequestOrigin.General` requests and
`imageHeaders` (an image `accept` by default) on cover/page requests, and installs a
response interceptor (General requests only, so image bodies stay native) that throws `CloudflareError(resolutionUrl)` on 403/503 or a challenge
fingerprint (`challenges.cloudflare.com`, `cf-browser-verification`, `__cf_chl_`,
`<title>Just a moment`, a proof-of-work marker).

- `originFor: (url) => string` — per-request origin, for sites whose images or API live on
  a different host than their pages.
- `json: true` — sets a JSON `accept` and turns a `>= 400` response into an `Error`
  carrying the server's own `error.message` when it sends one.

Headers are only filled in when missing, so per-request `headers` win over these defaults.
Error statuses no longer reject on their own: `getText` calls `requireOk()`, and `getJson`
relies on `json: true` to turn `>= 400` into an `Error`.

## `lib/html.ts` — parsing helpers

Import what the source uses:

| Helper                            | Why it is not just cheerio                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchHtml(client, url, params?)` | GET, query string and `load` in one call, with the non-UTF-8 WebView fallback from `getText`                                          |
| `text(node)`                      | `.text()` plus whitespace collapsing                                                                                                  |
| `ownText(node)`                   | `.contents().filter(text nodes)` — text excluding child elements                                                                      |
| `imageSrc(node)`                  | comic sites lazy-load: tries `data-src`, `data-original`, `data-lazy-src`, `srcset`, `src`, and takes the first URL out of a `srcset` |
| `absolute(raw, baseUrl)`          | the runtime has no `URL` global; handles `//host`, `/path`, relative, and `\/`-escaped URLs from inline JSON                          |
| `slug(value)`                     | tag ids                                                                                                                               |
| `chapterNumber(title, fallback)`  | `#12.5`, trailing numbers                                                                                                             |
| `parseDate(raw)`                  | `Date.parse` that returns `undefined` instead of an invalid `Date`                                                                    |
| `parseStatus(raw)`                | ongoing / completed / hiatus / cancelled, case-insensitive                                                                            |

Each HTML source wraps `absolute` once with its own `BASE_URL`, so call sites stay
`absolute(raw)`.

Two more that only some sources need, both in `src/Batcave/main.ts`:

- `balancedJson(source, marker)` + `scriptJson($, marker)` — pulls a **balanced** JSON
  region out of an inline `<script>`. A lazy `/\{[\s\S]*?\}/` truncates at the first `}`
  inside a nested object, which is how the chapter list broke before.
- `parsePublishDate(raw)` — a site-specific date format, pinned to `Date.UTC` so the
  parsed day does not shift with the device timezone.

Always return `undefined` from a date helper on failure and `?? new Date(0)` at the call
site. An invalid `Date` fails the contract test and renders as a broken date in the app.
