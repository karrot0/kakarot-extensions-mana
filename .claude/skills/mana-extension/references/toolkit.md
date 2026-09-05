# What each source directory contains

```
src/<Name>/
  client.ts     network client + Cloudflare detection
  model.ts      site constants, filter/sort definitions, API response types
  main.ts       the source class, plus its own parsing helpers at the bottom
  forms/        the app-facing machinery, copied per source
  assets/       icon.png
```

`client.ts` and `forms/*` are identical copies across sources so each `.mana` bundle is
self-contained. Fix them in `src/Template/` and copy outward.

Parsing is **not** in a shared module. Traversal is cheerio (`load`, `$(...)`, `.find()`,
`.attr()`, `.toArray()`), and the few helpers around it live at the bottom of each
`main.ts` because they are site-specific. Copy their shape from `src/Template/main.ts`.

## `forms/` — the app-facing machinery

### `forms/filters.ts` — `FilterReader`

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

### `forms/search.ts` — the search form

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

### `forms/sections.ts` — home sections

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

### `forms/preferences.ts` — the preference menu

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

### `forms/query.ts` — query strings

`withQuery(url, params)` drops `undefined`/`null`/empty values and encodes the rest.
`encodeForm(body)` does the same for `application/x-www-form-urlencoded` POST bodies but
keeps empty values. There is no `URLSearchParams` in the runtime, so build query strings
through these.

## `client.ts` — the network client

```ts
buildClient({
  baseUrl,
  requests,
  interval,
  accept,
  headers,
  resolutionUrl,
  originFor,
  json,
  maxRetries,
  timeout,
});
```

Applies rate limiting, sets `origin`/`referer`/`accept`/`accept-language`, and installs a
response interceptor that throws `CloudflareError(resolutionUrl)` on 403/503 or a challenge
fingerprint (`challenges.cloudflare.com`, `cf-browser-verification`, `__cf_chl_`,
`<title>Just a moment`, a proof-of-work marker).

- `originFor: (url) => string` — per-request origin, for sites whose images or API live on
  a different host than their pages.
- `json: true` — sets a JSON `accept` and turns a `>= 400` response into an `Error`
  carrying the server's own `error.message` when it sends one.

Per-request `headers` passed to `http.request` win over the client defaults.

## Parsing helpers in `main.ts`

Each source keeps only what it uses. The recurring shapes, from `src/Template/main.ts`:

| Helper                           | Why it is not just cheerio                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `text(node)`                     | `.text()` plus whitespace collapsing                                                                                                  |
| `imageSrc(node)`                 | comic sites lazy-load: tries `data-src`, `data-original`, `data-lazy-src`, `srcset`, `src`, and takes the first URL out of a `srcset` |
| `absolute(raw)`                  | the runtime has no `URL` global; handles `//host`, `/path`, relative, and `\/`-escaped URLs from inline JSON                          |
| `slug(value)`                    | tag ids                                                                                                                               |
| `chapterNumber(title, fallback)` | `#12.5`, trailing numbers                                                                                                             |
| `ownText(node)`                  | `.contents().filter(text nodes)` — text excluding child elements                                                                      |

Two more that only some sources need, both in `src/Batcave/main.ts`:

- `balancedJson(source, marker)` + `scriptJson($, marker)` — pulls a **balanced** JSON
  region out of an inline `<script>`. A lazy `/\{[\s\S]*?\}/` truncates at the first `}`
  inside a nested object, which is how the chapter list broke before.
- `parsePublishDate(raw)` — a site-specific date format, pinned to `Date.UTC` so the
  parsed day does not shift with the device timezone.

Always return `undefined` from a date helper on failure and `?? new Date(0)` at the call
site. An invalid `Date` fails the contract test and renders as a broken date in the app.
