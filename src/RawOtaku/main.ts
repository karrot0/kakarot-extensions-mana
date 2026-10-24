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
  type ChapterSource,
  type Content,
  type Highlight,
  type PagedSearchResult,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SortOption,
  type SourceConfig,
  type SourceInfo,
  type Tag,
} from "@mana-app/types";
import { load, type CheerioAPI } from "cheerio";

import type { ClientOptions } from "../../lib/client.ts";
import {
  FilterReader,
  buildSearchForm,
  pageOf,
  resolveSortId,
  withQuery,
  type QueryParams,
  type SectionSpec,
} from "../../lib/forms/index.ts";
import {
  absolute as absoluteFrom,
  chapterNumber,
  fetchHtml,
  imageSrc,
  normalize,
  parseStatus,
  text,
} from "../../lib/html.ts";
import { BaseSource } from "../../lib/source.ts";
import {
  ADULT_GENRE,
  BASE_URL,
  CDN_URL,
  FilterID,
  GENRE_FIELD,
  LANGUAGE_FIELD,
  ListID,
  SORT_OPTIONS,
  SortID,
  STATUS_FIELD,
  TYPE_FIELD,
} from "./model.ts";

const info: SourceInfo = {
  id: "rawotaku",
  name: "RawOtaku",
  version: "1.1.0",
  description: "Pulls raw manga from rawotaku.com",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.JAPANESE],
  thumbnail: "RawOtaku.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  owningLinks: ["rawotaku.com", "www.rawotaku.com"],
};

const CHAPTER_LIST = "#ja-chaps > li.chapter-item";
const DETAIL = "#ani_detail";
const PROXY_URL = "https://wsrv.nl/?url=";

class RawOtakuSource extends BaseSource implements ChapterSource, SearchProvider {
  readonly info = info;
  readonly config = config;

  protected clientOptions(): ClientOptions {
    return { baseUrl: BASE_URL, requests: 2, intervalMs: 1_000 };
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: ListID.Latest,
        title: "Latest Updates",
        style: SectionStyle.SimpleSingleRow,
        load: (page) =>
          this.results(`${BASE_URL}/filter/`, { sort: SortID.LatestUpdated, p: page }),
      },
      {
        id: ListID.Popular,
        title: "Most Viewed",
        style: SectionStyle.SimpleSingleRow,
        load: (page) => this.results(`${BASE_URL}/filter/`, { sort: SortID.MostViewed, p: page }),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      fields: [TYPE_FIELD, STATUS_FIELD, LANGUAGE_FIELD],
      tags: GENRE_FIELD,
      tagsHeader: "Genre",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;

    const page = pageOf(request);
    const query = request.query?.trim() ?? "";
    if (query) return this.results(`${BASE_URL}/`, { q: query, p: page });

    const filters = new FilterReader(request);
    return this.results(
      `${BASE_URL}/filter/`,
      {
        type: anyOf(filters.option(FilterID.Type, "all")),
        status: anyOf(filters.option(FilterID.Status, "all")),
        language: anyOf(filters.option(FilterID.Language, "all")),
        sort: resolveSortId(SORT_OPTIONS, request, SortID.Default),
        p: page,
      },
      filters.options(FilterID.Genre),
    );
  }

  async getContent(contentId: string): Promise<Content> {
    return parseContent(await fetchHtml(this.http, contentUrl(contentId)), contentId);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    return parseChapters(await fetchHtml(this.http, contentUrl(contentId)));
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const response = await this.http.get(
      withQuery(`${BASE_URL}/json/chapter`, { mode: "vertical", id: chapterId }),
      {
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );
    const { html } = await response.requireOk().json<{ html: string }>();

    const pages = parsePages(load(html));
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapterId}`);
    }
    return { pages };
  }

  private async results(
    url: string,
    params: QueryParams,
    genres: readonly string[] = [],
  ): Promise<PagedSearchResult> {
    const $ = await fetchHtml(this.http, withGenres(withQuery(url, params), genres));
    return { results: parseCards($), isLastPage: isLastPage($) };
  }
}

function absolute(raw: string): string {
  return absoluteFrom(raw, BASE_URL);
}

// mgoimg.view47.com serves covers behind a Cloudflare managed challenge that a
// native image request cannot pass. wsrv.nl fetches the image server-side, so
// covers are rewrapped through it and load without a challenge.
function coverUrl(raw: string): string {
  const url = absolute(raw);
  return url.startsWith(CDN_URL) ? `${PROXY_URL}${encodeURIComponent(url)}` : url;
}

function anyOf(value: string): string | undefined {
  return value === "all" ? undefined : value;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function withGenres(url: string, genres: readonly string[]): string {
  if (genres.length === 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  const query = genres.map((genre) => `genre[]=${encodeURIComponent(genre)}`).join("&");
  return `${url}${separator}${query}`;
}

function contentUrl(contentId: string): string {
  return `${BASE_URL}/read/${encodeURIComponent(contentId)}/`;
}

function contentIdFrom(href: string | undefined): string {
  return decode(/\/read\/([^/?#]+)/.exec(href ?? "")?.[1] ?? "");
}

function genreIdFrom(href: string | undefined): string {
  return decode(/\/genres\/([^/?#]+)/.exec(href ?? "")?.[1] ?? "");
}

function statusFrom(raw: string): PublicationStatus | undefined {
  return parseStatus(raw.replace(/publishing/i, "ongoing").replace(/finished/i, "completed"));
}

function parseCards($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  for (const element of $(".manga_list-sbs .manga-poster").toArray()) {
    const poster = $(element);
    const id = contentIdFrom(poster.attr("href"));
    const img = poster.find("img").first();
    const title = normalize(img.attr("alt") ?? "");
    if (!id || !title) continue;

    results.push({
      id,
      title,
      cover: coverUrl(imageSrc(img)),
      contentRating: ContentRating.SAFE,
      webUrl: contentUrl(id),
    });
  }

  return results;
}

function isLastPage($: CheerioAPI): boolean {
  return $("ul.pagination > li.active + li").length === 0;
}

function parseContent($: CheerioAPI, contentId: string): Content {
  const detail = $(DETAIL);
  const tags: Tag[] = detail
    .find(".genres > a")
    .toArray()
    .map((element) => {
      const link = $(element);
      const title = text(link);
      return { id: genreIdFrom(link.attr("href")) || title, title };
    })
    .filter((tag) => tag.title);
  const genres = tags.map((tag) => tag.title);
  const type = detail
    .find(".anisc-info > .item")
    .toArray()
    .map((element) => text($(element)))
    .find((line) => line.startsWith("タイプ"));
  const alternative = text(detail.find(".manga-name-or").first());
  const title = text(detail.find(".manga-name").first()) || contentId;
  const status = detail
    .find(".anisc-info > .item")
    .toArray()
    .map((element) => $(element))
    .find((item) => /^(地位|Status)/.test(text(item)));

  return {
    title,
    cover: coverUrl(imageSrc(detail.find("img").first())),
    summary: text(detail.find(".description").first()),
    additionalTitles: alternative && alternative !== title ? [alternative] : undefined,
    tags,
    contentType: ContentType.COMIC,
    contentRating: ADULT_GENRE.test(`${genres.join(" ")} ${type ?? ""}`)
      ? ContentRating.MATURE
      : ContentRating.SAFE,
    status: status ? statusFrom(text(status.find(".name").first())) : undefined,
    webUrl: contentUrl(contentId),
  };
}

function parseChapters($: CheerioAPI): Chapter[] {
  const chapters: Chapter[] = [];

  for (const element of $(CHAPTER_LIST).toArray()) {
    const item = $(element);
    const chapterId = item.attr("data-id") ?? "";
    if (!chapterId) continue;

    const title = text(item.find(".name").first());
    chapters.push({
      chapterId,
      number:
        Number.parseFloat(item.attr("data-number") ?? "") ||
        chapterNumber(title, chapters.length + 1),
      index: chapters.length,
      date: new Date(0),
      language: DefinedLanguages.JAPANESE,
      title,
      webUrl: absolute(item.find("a").first().attr("href") ?? ""),
    });
  }

  return chapters;
}

function parsePages($: CheerioAPI): ChapterPage[] {
  const pages: ChapterPage[] = [];
  for (const element of $(".container-reader-chapter > div > img").toArray()) {
    const url = absolute(imageSrc($(element)));
    if (url && !url.startsWith("data:")) pages.push({ url });
  }
  return pages;
}

export class Target extends RawOtakuSource {}
