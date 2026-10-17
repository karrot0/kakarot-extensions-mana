import {
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
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import type { ClientOptions } from "../../lib/client.ts";
import {
  FilterReader,
  buildSearchForm,
  pageOf,
  resolveSortId,
  type SectionSpec,
} from "../../lib/forms/index.ts";
import {
  absolute as absoluteFrom,
  chapterNumber,
  fetchHtml,
  imageSrc,
  normalize,
  slug,
  text,
} from "../../lib/html.ts";
import { BaseSource } from "../../lib/source.ts";
import {
  BASE_URL,
  FilterID,
  GENRE_FIELD,
  ListID,
  MATURE_GENRE,
  SORT_OPTIONS,
  SortID,
} from "./model.ts";

const info: SourceInfo = {
  id: "ocecomic",
  name: "OceComic",
  version: "1.3.0",
  description: "Pulls comics from ocecomic.com",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "OceComic.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  owningLinks: ["ocecomic.com", "www.ocecomic.com"],
};

class OceComicSource extends BaseSource implements ChapterSource, SearchProvider {
  readonly info = info;
  readonly config = config;

  protected clientOptions(): ClientOptions {
    return { baseUrl: BASE_URL, requests: 5, intervalMs: 1_000 };
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: ListID.New,
        title: "New Comics",
        style: SectionStyle.SimpleSingleRow,
        load: (page) => this.listing("all", SortID.Latest, page),
      },
      {
        id: ListID.Popular,
        title: "Popular Comics",
        style: SectionStyle.SimpleSingleRow,
        load: (page) => this.listing("all", SortID.Popular, page),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({ tags: GENRE_FIELD, tagsHeader: "Genre" });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;

    const page = pageOf(request);
    const sort = resolveSortId(SORT_OPTIONS, request, SortID.Latest);
    const query = request.query?.trim() ?? "";

    if (query) {
      const $ = await fetchHtml(this.http, searchUrl(query, sort, page));
      return { results: parseCards($), isLastPage: isLastPage($, page) };
    }

    const genre = new FilterReader(request).option(FilterID.Genre, "all");
    return this.listing(genre, sort, page);
  }

  async getContent(contentId: string): Promise<Content> {
    return parseContent(await fetchHtml(this.http, contentUrl(contentId)), contentId);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    return parseChapters(await fetchHtml(this.http, contentUrl(contentId)), contentId);
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const pages = parsePages(await fetchHtml(this.http, chapterUrl(contentId, chapterId)));
    if (pages.length === 0) {
      throw new Error(`No pages found for issue "${chapterId}" of "${contentId}".`);
    }
    return { pages };
  }

  private async listing(genre: string, sort: string, page: number): Promise<PagedSearchResult> {
    const $ = await fetchHtml(this.http, listingUrl(genre, sort, page));
    return { results: parseCards($), isLastPage: isLastPage($, page) };
  }
}

function absolute(raw: string): string {
  return absoluteFrom(raw, BASE_URL);
}

function contentUrl(contentId: string): string {
  return `${BASE_URL}/comic/${contentId}`;
}

function chapterUrl(contentId: string, chapterId: string): string {
  return `${BASE_URL}/comic/${contentId.split("/")[0] ?? ""}/${chapterId}`;
}

function listingUrl(genre: string, sort: string, page: number): string {
  const base = `${BASE_URL}/comic/${genre || "all"}/${sort}`;
  return page > 1 ? `${base}/page/${page}` : base;
}

function searchUrl(query: string, sort: string, page: number): string {
  const base = `${BASE_URL}/search/${encodeURIComponent(query)}/${sort}`;
  return page > 1 ? `${base}/page/${page}` : base;
}

function contentIdFrom(href: string | undefined): string {
  return /\/comic\/(\d+\/[^/?#]+)/.exec(href ?? "")?.[1] ?? "";
}

function chapterIdFrom(href: string | undefined): string {
  return /\/comic\/\d+\/([^/?#]+)/.exec(href ?? "")?.[1] ?? "";
}

/**
 * ocecomic.com truncates the visible card title mid UTF-8 character, so prefer
 * the untruncated `title` attribute. Either value can carry U+FFFD, because the
 * WebView fallback substitutes it for the bytes the truncation corrupted, so
 * both are cut at it. Only the visible text also sheds a trailing ellipsis.
 */
function cardTitle(item: Cheerio<AnyNode>, img: Cheerio<AnyNode>): string {
  const link = item.find("h2 a").first();
  const attribute = normalize(link.attr("title") ?? img.attr("alt") ?? "");
  if (attribute) return normalize(beforeCorruption(attribute));

  return normalize(beforeCorruption(text(link))).replace(/[.\s]+$/, "");
}

function beforeCorruption(value: string): string {
  const corruption = value.indexOf("�");
  return corruption >= 0 ? value.slice(0, corruption) : value;
}

function parseFields($: CheerioAPI): Record<string, string[]> {
  const fields: Record<string, string[]> = {};

  for (const element of $(".info ul").toArray()) {
    const list = $(element);
    const label = text(list.find("li").first()).toLowerCase();
    fields[label] = list
      .find("li a")
      .toArray()
      .map((anchor) => text($(anchor)))
      .filter(Boolean);
  }

  return fields;
}

function parseCards($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  for (const element of $(".items .item").toArray()) {
    const item = $(element);
    const anchor = item.find("figure a").first();
    const id = contentIdFrom(anchor.attr("href"));
    if (!id) continue;

    const img = anchor.find("img").first();

    results.push({
      id,
      title: cardTitle(item, img) || id,
      cover: absolute(imageSrc(img)),
      contentRating: ContentRating.SAFE,
      webUrl: contentUrl(id),
    });
  }

  return results;
}

function totalPages($: CheerioAPI): number {
  const options = $(".pagin select[name='page'] option");
  if (options.length === 0) return 1;
  const last = Number.parseInt(options.last().attr("value") ?? "1", 10);
  return Number.isFinite(last) && last > 0 ? last : 1;
}

function isLastPage($: CheerioAPI, page: number): boolean {
  return page >= totalPages($);
}

function parseContent($: CheerioAPI, contentId: string): Content {
  const fields = parseFields($);
  const genreTitles = [...(fields["theme"] ?? []), ...(fields["genre"] ?? [])];
  const tags: Tag[] = genreTitles.map((title) => ({ id: slug(title), title }));

  return {
    title: text($(".detail .title h1").first()) || contentId,
    cover: absolute(imageSrc($(".page.home img").first())),
    summary: text($(".about").first()),
    tags,
    contentType: ContentType.COMIC,
    contentRating: genreTitles.some((genre) => MATURE_GENRE.test(genre))
      ? ContentRating.MATURE
      : ContentRating.SAFE,
    webUrl: contentUrl(contentId),
  };
}

function parseChapters($: CheerioAPI, contentId: string): Chapter[] {
  const chapters: Chapter[] = [];

  for (const element of $("a.issue-link").toArray()) {
    const link = $(element);
    const chapterId = chapterIdFrom(link.attr("href"));
    if (!chapterId) continue;

    const title = text(link);
    const number = chapterNumber(title, chapters.length + 1);

    chapters.push({
      chapterId,
      number,
      index: chapters.length,
      date: new Date(0),
      language: DefinedLanguages.ENGLISH,
      title: title || `Issue #${number}`,
      webUrl: chapterUrl(contentId, chapterId),
    });
  }

  return chapters;
}

function parsePages($: CheerioAPI): ChapterPage[] {
  const pages: ChapterPage[] = [];
  for (const element of $(".pages .page.issue img").toArray()) {
    const url = absolute(imageSrc($(element)));
    if (url) pages.push({ url });
  }
  return pages;
}

export class Target extends OceComicSource {}
