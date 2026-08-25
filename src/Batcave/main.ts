import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  SectionStyle,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type Content,
  type ContentSource,
  type Highlight,
  type ImageRequestHandler,
  type NetworkRequest,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SourceConfig,
  type SourceInfo,
  type Tag,
} from "@mana-app/types";

import { buildClient } from "./client.ts";
import {
  FilterReader,
  buildSearchForm,
  encodeForm,
  listResults,
  pageOf,
  sectionById,
  toPageSections,
  type SectionSpec,
} from "./forms/index.ts";
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
  version: "1.7.0",
  description: "Pulls comics from batcave.biz",
  website: BASE_URL,
  rating: CatalogRating.SAFE,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["batcave.biz"],
};

const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

function originFor(url: string): string {
  return CDN_ORIGINS.find((origin) => url.includes(hostOf(origin))) ?? BASE_URL;
}

class BatcaveSource
  implements ContentSource, SearchProvider, PageLinkResolver, ImageRequestHandler
{
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: BASE_URL,
      requests: 10,
      interval: 1,
      originFor,
      headers: { "x-requested-with": "com.batcave.android" },
    });
    return this.client;
  }

  private async fetchHtml(url: string): Promise<CheerioAPI> {
    const response = await this.http.get(url);
    return load(response.data);
  }

  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.Popular,
        title: "Popular",
        style: SectionStyle.SimpleHero,
        viewMore: false,
        load: async () => {
          const $ = await this.fetchHtml(BASE_URL);
          return { results: parsePopularList($), isLastPage: true };
        },
      },
      {
        id: ListID.Catalogue,
        title: "Catalogue",
        style: SectionStyle.DetailedTripleRowPaged,
        load: async (page) => {
          const $ = await this.fetchHtml(catalogueUrl(page));
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
          const $ = await this.fetchHtml(page > 1 ? `${BASE_URL}/page/${page}/` : `${BASE_URL}/`);
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

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections());
  }

  async willResolveSectionsForPage(_link: PageLink): Promise<void> {
    await this.fetchHtml(BASE_URL);
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const spec = sectionById(this.sections(), sectionID);
    if (!spec) return { items: [] };
    const { results } = await spec.load(1);
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = listResults(this.sections(), request);
    if (list) return list;

    const page = pageOf(request);
    const query = request.query?.trim() ?? "";

    if (query) {
      let $ = await this.fetchHtml(searchUrl(query, page));
      let results = parseReadedList($);
      if (results.length === 0) {
        const relaxed = relaxSearchTitle(query);
        if (relaxed && relaxed !== query) {
          $ = await this.fetchHtml(searchUrl(relaxed, page));
          results = parseReadedList($);
        }
      }
      return { results, isLastPage: !hasPaginationNextPage($) };
    }

    const genre = new FilterReader(request).text(FilterID.Genre);
    if (genre) {
      const $ = await this.fetchHtml(genreUrl(genre));
      return { results: parseReadedList($), isLastPage: !hasPaginationNextPage($) };
    }

    const $ = await this.fetchHtml(catalogueUrl(page));
    return {
      results: parseReadedList($, "#dle-content .readed"),
      isLastPage: !hasPaginationNextPage($),
    };
  }

  async getContent(contentId: string): Promise<Content> {
    const url = contentUrl(contentId);
    const $ = await this.fetchHtml(url);

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
      webUrl: url,
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await this.fetchHtml(contentUrl(contentId));

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
      webUrl: contentUrl(contentId),
    }));
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const newsId = /^(\d+)/.exec(contentId)?.[1];
    if (!newsId) {
      throw new Error(`Could not derive a news id from contentId "${contentId}"`);
    }

    const response = await this.http.request({
      url: `${BASE_URL}/engine/ajax/controller.php?mod=api&action=reader/getChapterData`,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: contentUrl(contentId),
        accept: "application/json, text/javascript, */*; q=0.01",
      },
      body: encodeForm({ news_id: newsId, chapter_id: chapterId }),
    });

    let json: ChapterDataResponse | undefined;
    try {
      json = JSON.parse(response.data) as ChapterDataResponse;
    } catch {
      throw new Error(`Chapter data for "${chapterId}" was not JSON (HTTP ${response.status})`);
    }
    if (json.success === false) {
      throw new Error(json.error ?? "Chapter data request was rejected");
    }

    const pages: ChapterPage[] = [];
    for (const src of json.data?.images ?? []) {
      const url = absolute(src);
      if (url) pages.push({ url });
    }

    if (pages.length === 0) {
      throw new Error(`No pages returned for chapter "${chapterId}".`);
    }

    return { pages };
  }

  async willRequestImage(imageURL: string): Promise<NetworkRequest> {
    const origin = originFor(imageURL);
    return {
      url: imageURL,
      method: "GET",
      headers: {
        origin,
        referer: `${origin}/`,
        accept: IMAGE_ACCEPT,
        "accept-language": "en-US,en;q=0.5",
      },
    };
  }
}

const LAZY_ATTRS = ["data-src", "data-original", "data-lazy-src", "srcset", "src"];

function text(node: Cheerio<AnyNode>): string {
  return node.text().replace(/\s+/g, " ").trim();
}

/** Text of the node itself, excluding any child elements. */
function ownText(node: Cheerio<AnyNode>): string {
  return node
    .contents()
    .filter((_, child) => child.type === "text")
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

function imageSrc(node: Cheerio<AnyNode>): string {
  for (const name of LAZY_ATTRS) {
    const raw = (node.attr(name) ?? "").trim();
    const first = raw.split(",")[0]?.trim().split(/\s+/)[0];
    if (first) return first;
  }
  return "";
}

function absolute(raw: string): string {
  const value = raw.replace(/\\\//g, "/").trim();
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `${BASE_URL}/${value.replace(/^\/+/, "")}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function parseContentId(href: string | undefined): string {
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

function parseStatus(raw: string): PublicationStatus | undefined {
  if (raw.includes("completed")) return PublicationStatus.COMPLETED;
  if (raw.includes("ongoing")) return PublicationStatus.ONGOING;
  return undefined;
}

function parseReadedList($: CheerioAPI, selector = ".readed"): Highlight[] {
  const results: Highlight[] = [];

  for (const element of $(selector).toArray()) {
    const unit = $(element);
    const infoLink = unit.find(".readed__title a");
    const title = text(infoLink);
    const id = parseContentId(infoLink.attr("href"));
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
    const id = parseContentId(unit.attr("href"));
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
    const id = parseContentId(titleLink.attr("href"));
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

export class Target extends BatcaveSource {}
