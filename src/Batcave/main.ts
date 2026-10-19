import {
  Body,
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  SectionStyle,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type CoverRequestHandler,
  type Highlight,
  type HttpClient,
  type PageLink,
  type PageRequestHandler,
  type PagedSearchResult,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SourceConfig,
  type SourceInfo,
  type Tag,
} from "@mana-app/types";
import type { CheerioAPI } from "cheerio";

import { JSON_ACCEPT, type ClientOptions } from "../../lib/client.ts";
import { FilterReader, buildSearchForm, pageOf, type SectionSpec } from "../../lib/forms/index.ts";
import {
  absolute as absoluteFrom,
  fetchHtml,
  imageSrc,
  ownText,
  parseStatus,
  slug,
  text,
} from "../../lib/html.ts";
import { BaseSource } from "../../lib/source.ts";
import {
  BASE_URL,
  CDN_ORIGINS,
  FilterID,
  GENRE_FIELD,
  ListID,
  type ChapterDataResponse,
  type ChapterPayload,
} from "./model.ts";

const info: SourceInfo = {
  id: "batcave",
  name: "Batcave",
  version: "1.8.0",
  description: "Pulls comics from batcave.biz",
  website: BASE_URL,
  rating: CatalogRating.SAFE,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "Batcave.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["batcave.biz"],
};

class BatcaveSource
  extends BaseSource
  implements ChapterSource, SearchProvider, CoverRequestHandler, PageRequestHandler
{
  readonly info = info;
  readonly config = config;

  protected clientOptions(): ClientOptions {
    return {
      baseUrl: BASE_URL,
      requests: 10,
      intervalMs: 1_000,
      originFor,
      headers: { "x-requested-with": "com.batcave.android" },
    };
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: ListID.Popular,
        title: "Popular",
        style: SectionStyle.SimpleHero,
        viewMore: false,
        load: async () => {
          const $ = await fetchHtml(this.http, BASE_URL);
          return { results: parsePopularList($), isLastPage: true };
        },
      },
      {
        id: ListID.Catalogue,
        title: "Catalogue",
        style: SectionStyle.DetailedTripleRowPaged,
        load: async (page) => {
          const $ = await fetchHtml(this.http, catalogueUrl(page));
          return {
            results: parseReadedList($, "#dle-content .readed"),
            isLastPage: !hasPaginationNextPage($),
          };
        },
      },
      {
        id: ListID.New,
        title: "New Comics",
        style: SectionStyle.DetailedVerticalListGrouped,
        load: async (page) => {
          const $ = await fetchHtml(
            this.http,
            page > 1 ? `${BASE_URL}/page/${page}/` : `${BASE_URL}/`,
          );
          return {
            results: parseLatestList($),
            isLastPage: $(".pagination__btn-loader a").length === 0,
          };
        },
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({ tags: GENRE_FIELD, tagsHeader: "Genre", includeSort: false });
  }

  async willResolveSectionsForPage(_link: PageLink): Promise<void> {
    await fetchHtml(this.http, BASE_URL);
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;

    const page = pageOf(request);
    const query = request.query?.trim() ?? "";

    if (query) {
      let $ = await fetchHtml(this.http, searchUrl(query, page));
      let results = parseReadedList($);
      if (results.length === 0) {
        const relaxed = relaxSearchTitle(query);
        if (relaxed && relaxed !== query) {
          $ = await fetchHtml(this.http, searchUrl(relaxed, page));
          results = parseReadedList($);
        }
      }
      return { results, isLastPage: !hasPaginationNextPage($) };
    }

    const genre = new FilterReader(request).text(FilterID.Genre);
    if (genre) {
      const $ = await fetchHtml(this.http, genreUrl(genre));
      return { results: parseReadedList($), isLastPage: !hasPaginationNextPage($) };
    }

    const $ = await fetchHtml(this.http, catalogueUrl(page));
    return {
      results: parseReadedList($, "#dle-content .readed"),
      isLastPage: !hasPaginationNextPage($),
    };
  }

  async getContent(contentId: string): Promise<Content> {
    const url = contentUrl(contentId);
    return parseContent(await fetchHtml(this.http, url), url);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const url = contentUrl(contentId);
    return parseChapters(await fetchHtml(this.http, url), url);
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const newsId = /^(\d+)/.exec(contentId)?.[1];
    if (!newsId) {
      throw new Error(`Could not derive a news id from contentId "${contentId}"`);
    }

    const response = await this.http.post(
      `${BASE_URL}/engine/ajax/controller.php?mod=api&action=reader/getChapterData`,
      Body.form({ news_id: newsId, chapter_id: chapterId }),
      { headers: { referer: contentUrl(contentId), accept: JSON_ACCEPT } },
    );

    response.requireOk();
    let json: ChapterDataResponse | undefined;
    try {
      json = await response.json<ChapterDataResponse>();
    } catch {
      throw new Error(`Chapter data for "${chapterId}" was not JSON (HTTP ${response.status})`);
    }
    if (json.success === false) {
      throw new Error(json.error ?? "Chapter data request was rejected");
    }

    const pages = parsePages(json.data?.images ?? []);
    if (pages.length === 0) {
      throw new Error(`No pages returned for chapter "${chapterId}".`);
    }

    return { pages };
  }

  getCoverTransport(): HttpClient {
    return this.imageHttp;
  }

  getPageTransport(): HttpClient {
    return this.imageHttp;
  }
}

function absolute(raw: string): string {
  return absoluteFrom(raw, BASE_URL);
}

function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

function originFor(url: string): string {
  return CDN_ORIGINS.find((origin) => url.includes(hostOf(origin))) ?? BASE_URL;
}

function searchUrl(title: string, page: number): string {
  const segments = ["search", encodeURIComponent(title)];
  if (page > 1) segments.push("page", String(page));
  return `${BASE_URL}/${segments.join("/")}`;
}

function catalogueUrl(page: number): string {
  return page > 1 ? `${BASE_URL}/comix/page/${page}` : `${BASE_URL}/comix/`;
}

function genreUrl(genre: string): string {
  return `${BASE_URL}/genres/${encodeURIComponent(genre)}`;
}

function contentUrl(contentId: string): string {
  return `${BASE_URL}/${contentId.split("/").map(encodeURIComponent).join("/")}.html`;
}

function contentIdFrom(href: string | undefined): string {
  return (href ?? "")
    .trim()
    .replace(/^https?:/i, "")
    .replace(/^\/\/[^/]+/, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+/, "")
    .replace(/\.html?$/i, "")
    .replace(/\/+$/, "")
    .trim();
}

/**
 * Scans from `marker` for a balanced object/array, respecting string literals.
 * A lazy `/\{[\s\S]*?\}/` truncates at the first `}` inside a nested object.
 */
function balancedJson(source: string, marker: string): string | undefined {
  const from = source.indexOf(marker);
  if (from < 0) return undefined;

  let start = -1;
  for (let i = from; i < source.length; i++) {
    const char = source[i];
    if (char === "{" || char === "[") {
      start = i;
      break;
    }
  }
  if (start < 0) return undefined;

  const closers: Record<string, string> = { "{": "}", "[": "]" };
  const stack: string[] = [closers[source[start] ?? ""] ?? ""];
  let inString = false;
  let escaped = false;

  for (let i = start + 1; i < source.length; i++) {
    const char = source[i] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{" || char === "[") {
      stack.push(closers[char] ?? "");
      continue;
    }
    if (char === "}" || char === "]") {
      if (stack[stack.length - 1] !== char) return undefined;
      stack.pop();
      if (stack.length === 0) return source.slice(start, i + 1);
    }
  }

  return undefined;
}

function scriptJson<T>($: CheerioAPI, marker: string): T | undefined {
  for (const element of $("script").toArray()) {
    const body = $(element).html() ?? "";
    if (!body.includes(marker)) continue;
    const region = balancedJson(body, marker);
    if (!region) continue;
    try {
      return JSON.parse(region) as T;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** batcave.biz publishes chapter dates as DD.MM.YYYY. */
function parsePublishDate(raw: string | undefined): Date | undefined {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((raw ?? "").trim());
  if (!match) return undefined;
  const day = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const year = Number.parseInt(match[3] ?? "", 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return new Date(Date.UTC(year, month - 1, day));
}

function parseReadedList($: CheerioAPI, selector = ".readed"): Highlight[] {
  const results: Highlight[] = [];

  for (const element of $(selector).toArray()) {
    const unit = $(element);
    const infoLink = unit.find(".readed__title a");
    const title = text(infoLink);
    const id = contentIdFrom(infoLink.attr("href"));
    if (!id || !title) continue;

    const subtitle = text(unit.find(".readed__info li:last-child"))
      .replace("Last issue:", "")
      .trim();

    results.push({
      id,
      title,
      cover: absolute(imageSrc(unit.find(".readed__img img").first())),
      subtitle: subtitle || undefined,
      contentRating: ContentRating.SAFE,
      webUrl: contentUrl(id),
    });
  }

  return results;
}

function parsePopularList($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  for (const element of $(".poster.grid-item").toArray()) {
    const unit = $(element);
    const title = text(unit.find(".poster__title"));
    const id = contentIdFrom(unit.attr("href"));
    if (!id || !title) continue;

    const rating = text(unit.find(".poster__label--rate"));

    results.push({
      id,
      title,
      cover: absolute(imageSrc(unit.find(".poster__img img").first())),
      subtitle: rating ? `Rating: ${rating}` : undefined,
      contentRating: ContentRating.SAFE,
      webUrl: contentUrl(id),
    });
  }

  return results;
}

function parseLatestList($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  for (const element of $("#content-load .latest.grid-item").toArray()) {
    const unit = $(element);
    const titleLink = unit.find(".latest__title a");
    const title = ownText(titleLink);
    const id = contentIdFrom(titleLink.attr("href"));
    if (!id || !title) continue;

    const subtitle = text(unit.find(".latest__chapter a"));

    results.push({
      id,
      title,
      cover: absolute(imageSrc(unit.find(".latest__img img").first())),
      subtitle: subtitle || undefined,
      contentRating: ContentRating.SAFE,
      webUrl: contentUrl(id),
    });
  }

  return results;
}

function hasPaginationNextPage($: CheerioAPI): boolean {
  const currentPage = Number.parseInt(text($(".pagination__pages > span").first()), 10) || 1;
  return $(".pagination__pages > a")
    .toArray()
    .some((element) => {
      const pageNum = Number.parseInt(text($(element)), 10);
      return Number.isFinite(pageNum) && pageNum > currentPage;
    });
}

function relaxSearchTitle(title: string): string {
  return title
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseContent($: CheerioAPI, webUrl: string): Content {
  const statusText = $(".page__list li")
    .toArray()
    .map((element) => text($(element)))
    .find((value) => value.includes("Release type"))
    ?.toLowerCase();

  const tags: Tag[] = [];
  for (const element of $(".page__tags a").toArray()) {
    const title = text($(element));
    if (title) tags.push({ id: slug(title), title });
  }

  return {
    title: text($("h1").first()),
    cover: absolute(imageSrc($(".page__poster img").first())),
    summary: text($(".page__text").first()),
    tags,
    contentType: ContentType.COMIC,
    contentRating: ContentRating.SAFE,
    status: parseStatus(statusText ?? ""),
    webUrl,
  };
}

function parseChapters($: CheerioAPI, webUrl: string): Chapter[] {
  const payload = scriptJson<ChapterPayload>($, "__DATA__");
  const raw = (payload?.chapters ?? [])
    .filter((entry) => typeof entry.id === "number")
    .sort((a, b) => a.posi - b.posi);

  return raw.map((entry, index) => ({
    chapterId: String(entry.id),
    number: entry.posi,
    index,
    date: parsePublishDate(entry.date) ?? new Date(0),
    language: DefinedLanguages.ENGLISH,
    title: entry.title?.trim() || `Chapter ${entry.posi}`,
    webUrl,
  }));
}

function parsePages(images: string[]): ChapterPage[] {
  const pages: ChapterPage[] = [];
  for (const src of images) {
    const url = absolute(src);
    if (url) pages.push({ url });
  }
  return pages;
}

export class Target extends BatcaveSource {}
