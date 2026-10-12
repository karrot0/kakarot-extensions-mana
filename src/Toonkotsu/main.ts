import {
  AdditionalInfoType,
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  ReadingMode,
  SearchExcludableMultiPickerSheet,
  SectionStyle,
  additionalInfo,
  type AdditionalInfoSection,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type Form,
  type Highlight,
  type ImageRequestHandler,
  type NetworkRequest,
  type Option,
  type PagedSearchResult,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SortOption,
  type SourceConfig,
  type SourceInfo,
  type SourcePreferenceProvider,
} from "@mana-app/types";

import type { ClientOptions } from "../../lib/client.ts";
import {
  FilterReader,
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  pageOf,
  resolveSortId,
  type QueryParams,
  type SectionSpec,
} from "../../lib/forms/index.ts";
import { BaseSource } from "../../lib/source.ts";
import { absolute, parseStatus } from "../../lib/text.ts";
import {
  BASE_URL,
  FALLBACK_GENRES,
  FilterID,
  GENRE_LIMIT,
  ListID,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  READER_TIMEOUT,
  RankingMetric,
  SEARCH_FIELDS,
  SORT_OPTIONS,
  SortID,
  type BrowserScope,
  type ChapterEntry,
  type FacetsResponse,
  type LatestResponse,
  type ListResponse,
  type ReaderResult,
  type SeriesResponse,
  type SeriesSummary,
  type SiteFailure,
  type SiteModule,
  type SitePage,
} from "./model.ts";
// HTTP reader (commented out for benchmarking against the WebView reader).
// import {
//   decryptPage,
//   deriveSessionKey,
//   fromBase64,
//   rewritePageKey,
//   signChapter,
//   toBase64,
//   type ChapterResponse,
//   type SessionKey,
// } from "./reader.ts";

const info: SourceInfo = {
  id: "toonkotsu",
  name: "Toonkotsu",
  version: "1.0.0",
  description: "Pulls manga, manhwa and manhua from toonkotsu.com",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "Toonkotsu.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["toonkotsu.com"],
};

class ToonkotsuSource
  extends BaseSource
  implements ChapterSource, SearchProvider, SourcePreferenceProvider, ImageRequestHandler {
  readonly info = info;
  readonly config = config;

  private series: { id: string; expires: number; response: Promise<SeriesResponse> } | undefined;
  private readonly preferences = new PreferenceStore(info.id, PREFERENCE_DEFAULTS);
  // HTTP reader.
  // private reader: NetworkClient | undefined;
  // private session: { expires: number; response: Promise<SessionKey> } | undefined;

  protected clientOptions(): ClientOptions {
    return { baseUrl: BASE_URL, requests: 5, interval: 1, json: true };
  }

  // HTTP reader.
  // private get readerHttp(): NetworkClient {
  //   this.reader ??= buildClient({ baseUrl: BASE_URL, requests: 5, interval: 1 });
  //   return this.reader;
  // }
  //
  // private loadSession(): Promise<SessionKey> {
  //   const cached = this.session;
  //   if (cached && cached.expires > Date.now()) return cached.response;
  //
  //   const response = (async (): Promise<SessionKey> => {
  //     const res = await this.readerHttp.get(`${BASE_URL}/api/manga/key`);
  //     if (res.status !== 200) {
  //       let code: string | undefined;
  //       try {
  //         code = (JSON.parse(res.data) as { code?: string }).code;
  //       } catch {
  //         code = undefined;
  //       }
  //       if (code === "manga-limit") throw new CloudflareError(`${BASE_URL}/title`);
  //       throw new Error(`Toonkotsu reader session failed (HTTP ${res.status})`);
  //     }
  //     const data = JSON.parse(res.data) as { key?: string; now?: number };
  //     if (!data.key || typeof data.now !== "number") {
  //       throw new Error("Toonkotsu did not return a reader session key.");
  //     }
  //     return deriveSessionKey(data.key, data.now);
  //   })();
  //
  //   this.session = { expires: Date.now() + 60_000, response };
  //   response.catch(() => {
  //     if (this.session?.response === response) this.session = undefined;
  //   });
  //   return response;
  // }

  private async safeOnly(): Promise<string | undefined> {
    return (await this.preferences.get(PreferenceID.ShowAdult)) ? undefined : "1";
  }

  private loadSeries(contentId: string): Promise<SeriesResponse> {
    const cached = this.series;
    if (cached && cached.id === contentId && cached.expires > Date.now()) return cached.response;

    const response = this.getJson<SeriesResponse>(
      `/cdn/v1/series/${encodeURIComponent(contentId)}`,
    );
    this.series = { id: contentId, expires: Date.now() + 30_000, response };
    response.catch(() => {
      if (this.series?.response === response) this.series = undefined;
    });
    return response;
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: ListID.MostRead,
        title: "Most Read",
        style: SectionStyle.SimpleHero,
        load: (page) => this.ranking(RankingMetric.Views, page),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        style: SectionStyle.DetailedVerticalListGrouped,
        load: (page) => this.latest(page),
      },
      {
        id: ListID.Trending,
        title: "Trending",
        subtitle: "Most followed titles with a new chapter this week",
        load: (page) => this.ranking(RankingMetric.Trending, page),
      },
      {
        id: ListID.Popular,
        title: "Popular",
        load: (page) => this.browse({ sort: SortID.Popular, order: "desc" }, page),
      },
      {
        id: ListID.New,
        title: "Recently Added",
        load: (page) => this.browse({ sort: SortID.New, order: "desc" }, page),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      fields: SEARCH_FIELDS,
      tags: SearchExcludableMultiPickerSheet({
        id: FilterID.Genre,
        title: "Genres",
        options: await this.genreOptions(),
      }),
      tagsHeader: "Genres",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, [
      {
        header: "Content",
        footer: "Applies to search results and browsing.",
        fields: [{ type: "toggle", key: PreferenceID.ShowAdult, title: "Show Adult Titles" }],
      },
    ]);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;

    const filters = new FilterReader(request);
    const query = request.query?.trim() ?? "";
    const genres = filters.excludable(FilterID.Genre);
    const sort =
      query && !request.sort?.id ? "" : resolveSortId(SORT_OPTIONS, request, SortID.Latest);
    const orderable = SORT_OPTIONS.find((option) => option.id === sort)?.isOrderable === true;

    return this.browse(
      {
        q: query,
        genres: genres.included.join(","),
        exclude: genres.excluded.join(","),
        status: filters.option(FilterID.Status),
        type: filters.option(FilterID.Type),
        demographic: filters.option(FilterID.Demographic),
        yearFrom: positive(filters.number(FilterID.YearFrom)),
        yearTo: positive(filters.number(FilterID.YearTo)),
        chaptersMin: positive(filters.number(FilterID.MinChapters)),
        sort,
        order: orderable && request.sort?.ascending ? "asc" : "desc",
      },
      pageOf(request),
    );
  }

  async getContent(contentId: string): Promise<Content> {
    const { series, recs } = await this.loadSeries(contentId);
    const webtoon = series.type === "Manhwa" || series.type === "Manhua";

    return {
      title: series.title,
      cover: coverUrl(series.cover, 720),
      summary: series.description?.trim() || undefined,
      tags: (series.tags ?? []).map((title) => ({ id: title, title })),
      contentType: contentType(series.type),
      contentRating: rating(series),
      recommendedPanelMode: webtoon ? ReadingMode.WEBTOON : ReadingMode.PAGED_MANGA,
      status: parseStatus(series.status ?? ""),
      webUrl: contentUrl(series.hid, series.slug),
      trackerInfo: trackers(series.externalIds ?? {}),
      additionalInfo: infoSections(series.authors ?? [], recs ?? []),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const { series, chapters: entries } = await this.loadSeries(contentId);
    const base = contentUrl(series.hid, series.slug);
    const chapters: Chapter[] = [];

    for (const entry of [...(entries ?? [])].reverse()) {
      if (typeof entry.id !== "number") continue;

      const volume = Number.parseFloat(entry.vol ?? "");
      const previous = chapters[chapters.length - 1]?.number ?? 0;

      chapters.push({
        chapterId: String(entry.id),
        number: chapterNumber(entry, previous),
        index: chapters.length,
        date: validDate(entry.at) ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        title: chapterTitle(entry),
        volume: Number.isFinite(volume) ? volume : undefined,
        provider: entry.group ? { id: entry.group.slug, name: entry.group.name } : undefined,
        thumbnail: entry.thumb ? absolute(entry.thumb, BASE_URL) : undefined,
        webUrl: `${base}/${entry.id}`,
      });
    }

    return chapters;
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const id = Number.parseInt(chapterId, 10);
    if (!Number.isFinite(id)) throw new Error(`"${chapterId}" is not a Toonkotsu chapter id`);

    const url = `${contentUrl(contentId)}/${id}`;
    const result = await this.readChapter(url, id);

    if (result.gate === "wait") {
      const minutes = Math.max(1, Math.ceil((result.retryAfter ?? 600) / 60));
      throw new Error(`Toonkotsu is rate limiting this device. Try again in ${minutes} min.`);
    }
    if (result.gate) throw new CloudflareError(url);
    if (result.error) throw new Error(`Toonkotsu reader failed for chapter ${id}: ${result.error}`);

    const pages: ChapterPage[] = [];
    for (const page of result.pages ?? []) {
      if (page.raw) pages.push({ raw: page.raw });
      else if (page.url) pages.push({ url: absolute(page.url, BASE_URL) });
    }

    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${id} of "${contentId}"`);
    }

    return { pages };
  }

  // HTTP reader.
  // async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
  //   const id = Number.parseInt(chapterId, 10);
  //   if (!Number.isFinite(id)) throw new Error(`"${chapterId}" is not a Toonkotsu chapter id`);
  //
  //   const session = await this.loadSession();
  //   const path = `/api/manga/chapter/${id}`;
  //   const response = await this.readerHttp.get(`${BASE_URL}${path}`, {
  //     headers: { accept: "application/json", "x-sig": signChapter(session, path) },
  //   });
  //   if (response.status !== 200) {
  //     throw new Error(`Toonkotsu reader failed for chapter ${id} (HTTP ${response.status})`);
  //   }
  //
  //   let body: ChapterResponse;
  //   try {
  //     body = JSON.parse(response.data) as ChapterResponse;
  //   } catch {
  //     throw new Error(`Toonkotsu reader returned invalid JSON for chapter ${id}.`);
  //   }
  //
  //   const sourcePages = body.chapter?.pages ?? [];
  //   if (sourcePages.length === 0) {
  //     throw new Error(`No pages found for chapter ${id} of "${contentId}"`);
  //   }
  //
  //   const pages: ChapterPage[] = [];
  //   for (const page of sourcePages) {
  //     if (!page.src) continue;
  //     const url = absolute(page.src, BASE_URL);
  //     if (!page.k || !page.n) {
  //       pages.push({ url });
  //       continue;
  //     }
  //
  //     const key = rewritePageKey(session, page.k, page.n);
  //     const image = await this.readerHttp.get(url, {
  //       responseEncoding: "base64",
  //       headers: { accept: "image/*" },
  //     });
  //     if (image.status !== 200) {
  //       throw new Error(`Toonkotsu page ${page.src} failed (HTTP ${image.status})`);
  //     }
  //     pages.push({ raw: toBase64(decryptPage(key, page.n, fromBase64(image.data))) });
  //   }
  //
  //   if (pages.length === 0) {
  //     throw new Error(`No pages found for chapter ${id} of "${contentId}"`);
  //   }
  //
  //   return { pages };
  // }

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    return { url: imageURL, method: "GET", headers: { referer: `${BASE_URL}/` } };
  }

  private async readChapter(url: string, id: number): Promise<ReaderResult> {
    if (typeof WebViewPage === "undefined") {
      throw new Error("This version of Mana cannot open Toonkotsu chapters (no WebView support).");
    }

    const page = await WebViewPage.create({ timeout: READER_TIMEOUT });
    try {
      await page.goto(url, { waitUntil: "load" });
      const hint = await this.preferences.get(PreferenceID.ReaderLoader);
      const result = await page.evaluate(readChapterInPage, id, hint);
      if (result.loader && result.loader !== hint) {
        await this.preferences.set(PreferenceID.ReaderLoader, result.loader);
      }
      return result;
    } finally {
      await page.close();
    }
  }

  private async genreOptions(): Promise<Option[]> {
    let names: readonly string[] = FALLBACK_GENRES;
    try {
      const facets = await this.getJson<FacetsResponse>("/cdn/v1/facets", {
        sfw: await this.safeOnly(),
      });
      const live = (facets.genres ?? []).slice(0, GENRE_LIMIT).map((genre) => genre.name);
      if (live.length > 0) names = live;
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
    }
    return [...names].sort((a, b) => a.localeCompare(b)).map((title) => ({ id: title, title }));
  }

  private async browse(params: QueryParams, page: number): Promise<PagedSearchResult> {
    const data = await this.getJson<ListResponse>("/cdn/v1/browse", {
      genreMode: "all",
      excludeMode: "any",
      ...params,
      page,
      limit: PAGE_SIZE,
      sfw: await this.safeOnly(),
    });
    return listPage(data);
  }

  private async ranking(metric: string, page: number): Promise<PagedSearchResult> {
    const data = await this.getJson<ListResponse>("/api/v1/rankings", {
      metric,
      page,
      limit: PAGE_SIZE,
      sfw: await this.safeOnly(),
    });
    return listPage(data);
  }

  private async latest(page: number): Promise<PagedSearchResult> {
    const data = await this.getJson<LatestResponse>("/cdn/v1/latest", {
      page,
      limit: PAGE_SIZE,
      sfw: await this.safeOnly(),
    });

    const seen = new Set<string>();
    const results: Highlight[] = [];
    for (const item of data.items ?? []) {
      const entry = highlight(item.series, item.chapter?.label);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      results.push(entry);
    }
    return { results, isLastPage: data.hasNextPage !== true };
  }
}

function coverUrl(cover: string | null | undefined, width?: number): string {
  const url = absolute(cover ?? "", BASE_URL);
  return width ? url.replace(/\/\d+\.webp$/, `/${width}.webp`) : url;
}

function contentUrl(contentId: string, slug?: string): string {
  const path = slug ? `${contentId}-${slug}` : contentId;
  return `${BASE_URL}/title/${encodeURIComponent(path)}`;
}

function positive(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function validDate(timestamp: number | undefined): Date | undefined {
  return typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp)
    : undefined;
}

function chapterNumber(entry: ChapterEntry, previous: number): number {
  if (typeof entry.n === "number" && Number.isFinite(entry.n)) return entry.n;
  const parsed = Number.parseFloat(/(\d+(?:\.\d+)?)/.exec(entry.label)?.[1] ?? "");
  return Number.isFinite(parsed) ? parsed : previous + 1;
}

function chapterTitle(entry: ChapterEntry): string | undefined {
  const label = entry.label.replace(/\s+/g, " ").trim();
  return /^chapter\s+\d+(?:\.\d+)?$/i.test(label) ? undefined : label || undefined;
}

function contentType(type: string | null): ContentType {
  if (type === "Manhwa") return ContentType.MANHWA;
  if (type === "Manhua") return ContentType.MANHUA;
  if (type === "OEL") return ContentType.COMIC;
  return ContentType.MANGA;
}

function rating(series: SeriesSummary): ContentRating {
  return series.adult ? ContentRating.EXPLICIT : ContentRating.SAFE;
}

function trackers(ids: Record<string, string | null>): Record<string, string> {
  const result: Record<string, string> = {};
  if (ids["anilist"]) result["anilist"] = ids["anilist"];
  if (ids["myanimelist"]) result["mal"] = ids["myanimelist"];
  if (ids["mangaupdates"]) result["mangaupdates"] = ids["mangaupdates"];
  return result;
}

function infoSections(authors: string[], recs: SeriesSummary[]): AdditionalInfoSection[] {
  const sections: AdditionalInfoSection[] = [];

  if (authors.length > 0) {
    sections.push(
      additionalInfo.staff.section({
        id: "staff",
        title: "Staff",
        hasMore: false,
        items: authors
          .slice(0, 10)
          .map((name) => additionalInfo.staff.item({ id: name, title: name, subtitle: "Author" })),
      }),
    );
  }

  const related = recs.flatMap((series) => highlight(series) ?? []).slice(0, 10);
  if (related.length > 0) {
    sections.push(
      additionalInfo.highlights.section({
        id: "recommendations",
        title: "Recommendations",
        hasMore: false,
        items: related.map((entry) =>
          additionalInfo.highlights.item({
            type: AdditionalInfoType.Highlights,
            id: entry.id,
            title: entry.title,
            cover: entry.cover,
            contentRating: entry.contentRating,
            webUrl: entry.webUrl,
          }),
        ),
      }),
    );
  }

  return sections;
}

function highlight(series: SeriesSummary | undefined, subtitle?: string): Highlight | undefined {
  if (!series?.hid || !series.title) return undefined;
  return {
    id: series.hid,
    title: series.title,
    cover: coverUrl(series.cover),
    subtitle: subtitle || series.latest?.label || undefined,
    contentRating: rating(series),
    webUrl: contentUrl(series.hid, series.slug),
  };
}

function listPage(data: ListResponse): PagedSearchResult {
  return {
    results: (data.items ?? []).flatMap((series) => highlight(series) ?? []),
    isLastPage: data.hasNextPage !== true,
  };
}

async function readChapterInPage(chapterId: number, hint: string): Promise<ReaderResult> {
  const scope = globalThis as unknown as BrowserScope;

  const adopt = async (url: string): Promise<SiteModule | undefined> => {
    const loaded = (await import(url)) as Record<string, unknown>;
    for (const value of Object.values(loaded)) {
      if (typeof value !== "object" || value === null) continue;
      if (typeof (value as Partial<SiteModule>).chapter === "function") return value as SiteModule;
    }
    return undefined;
  };

  let site: SiteModule | undefined;
  let loader = "";
  if (hint) {
    try {
      site = await adopt(hint);
      if (site) loader = hint;
    } catch {
      site = undefined;
    }
  }

  if (!site) {
    const candidates = new Set<string>();
    const links = scope.document.querySelectorAll('link[rel="modulepreload"]');
    for (let i = 0; i < links.length; i++) {
      const href = links[i]?.href;
      if (href) candidates.add(href);
    }
    for (const entry of scope.performance.getEntriesByType("resource")) candidates.add(entry.name);

    // Fetch the chunks in parallel on a cache miss; the scan used to wait on each in turn.
    const urls = [...candidates].filter((url) => /\/_app\/immutable\/.+\.js$/.test(url));
    const sources = await Promise.all(
      urls.map((url) =>
        scope.fetch(url).then(
          (response) => response.text(),
          () => "",
        ),
      ),
    );

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      if (!url || !sources[i]?.includes("/manga/chapter/")) continue;
      site = await adopt(url);
      if (site) {
        loader = url;
        break;
      }
    }
  }
  if (!site) return { error: "the site's chapter loader was not found" };

  let body: unknown;
  try {
    body = await site.chapter(chapterId);
  } catch (error) {
    const failure = (error ?? {}) as SiteFailure;
    if (failure.status === 429 && failure.data?.code === "manga-limit") {
      return { gate: failure.data.reason || "verify", retryAfter: failure.data.retryAfterSec };
    }
    return { error: failure.data?.error || failure.message || String(error) };
  }

  let found: SitePage[] = [];
  const pending: unknown[] = [body];
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node !== "object" || node === null) continue;
    if (Array.isArray(node)) {
      const first = node[0] as SitePage | undefined;
      if (first && typeof first === "object" && typeof first.src === "string") {
        if (node.length > found.length) found = node as SitePage[];
        continue;
      }
    }
    for (const value of Object.values(node)) pending.push(value);
  }
  if (found.length === 0) return { error: "the chapter response listed no pages" };

  const decode = (value: string): Uint8Array => {
    const text = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = scope.atob(text + "=".repeat((4 - (text.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  const encode = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return scope.btoa(binary);
  };

  const pages: { url?: string; raw?: string }[] = Array.from({ length: found.length }, () => ({}));
  let cursor = 0;
  let failure = "";

  const worker = async (): Promise<void> => {
    while (cursor < found.length && !failure) {
      const index = cursor++;
      const page = found[index];
      if (!page?.src) continue;

      const url = new scope.URL(page.src, scope.location.href).href;
      if (!page.k || !page.n) {
        pages[index] = { url };
        continue;
      }

      try {
        const response = await scope.fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const key = await scope.crypto.subtle.importKey(
          "raw",
          decode(page.k),
          { name: "AES-CTR" },
          false,
          ["decrypt"],
        );
        const counter = new Uint8Array(16);
        counter.set(decode(page.n).subarray(0, 8), 0);
        const image = await scope.crypto.subtle.decrypt(
          { name: "AES-CTR", counter, length: 64 },
          key,
          await response.arrayBuffer(),
        );
        pages[index] = { raw: encode(image) };
      } catch (error) {
        failure = `page ${index + 1}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  };

  await Promise.all([worker(), worker(), worker(), worker()]);
  if (failure) return { error: failure };
  return { pages, loader };
}

export class Target extends ToonkotsuSource { }
