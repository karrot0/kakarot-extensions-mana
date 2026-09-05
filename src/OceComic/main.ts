import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
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
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SortOption,
  type SourceConfig,
  type SourceInfo,
  type Tag,
} from "@mana-app/types";

import { buildClient, getText } from "./client.ts";
import {
  FilterReader,
  buildSearchForm,
  listResults,
  pageOf,
  resolveSortId,
  sectionById,
  toPageSections,
  type SectionSpec,
} from "./forms/index.ts";
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
  version: "1.2.1",
  description: "Pulls comics from ocecomic.com",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  owningLinks: ["ocecomic.com", "www.ocecomic.com"],
};

class OceComicSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({ baseUrl: BASE_URL, requests: 5, interval: 1 });
    return this.client;
  }

  private async fetchHtml(url: string): Promise<CheerioAPI> {
    return load(await getText(this.http, url));
  }

  private sections(): SectionSpec[] {
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

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections());
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
    const sort = resolveSortId(SORT_OPTIONS, request, SortID.Latest);
    const query = request.query?.trim() ?? "";

    if (query) {
      const $ = await this.fetchHtml(searchUrl(query, sort, page));
      return { results: parseCards($), isLastPage: isLastPage($, page) };
    }

    const genre = new FilterReader(request).option(FilterID.Genre, "all");
    return this.listing(genre, sort, page);
  }

  async getContent(contentId: string): Promise<Content> {
    const url = contentUrl(contentId);
    const $ = await this.fetchHtml(url);

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
      webUrl: url,
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await this.fetchHtml(contentUrl(contentId));
    const chapters: Chapter[] = [];

    for (const element of $("a.issue-link").toArray()) {
      const link = $(element);
      const chapterId = parseChapterId(link.attr("href"));
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

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const $ = await this.fetchHtml(chapterUrl(contentId, chapterId));

    const pages: ChapterPage[] = [];
    for (const element of $(".pages .page.issue img").toArray()) {
      const url = absolute(imageSrc($(element)));
      if (url) pages.push({ url });
    }

    if (pages.length === 0) {
      throw new Error(`No pages found for issue "${chapterId}" of "${contentId}".`);
    }

    return { pages };
  }

  private async listing(genre: string, sort: string, page: number): Promise<PagedSearchResult> {
    const $ = await this.fetchHtml(listingUrl(genre, sort, page));
    return { results: parseCards($), isLastPage: isLastPage($, page) };
  }
}

const LAZY_ATTRS = ["data-src", "data-original", "data-lazy-src", "srcset", "src"];

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function text(node: Cheerio<AnyNode>): string {
  return normalize(node.text());
}

function beforeCorruption(value: string): string {
  const corruption = value.indexOf("�");
  return corruption >= 0 ? value.slice(0, corruption) : value;
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
  const value = raw.trim();
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

function chapterNumber(title: string, fallback: number): number {
  const match = /#\s*(\d+(?:\.\d+)?)/.exec(title) ?? /(\d+(?:\.\d+)?)\s*$/.exec(title);
  const parsed = Number.parseFloat(match?.[1] ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
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

function parseComicId(href: string | undefined): string {
  return /\/comic\/(\d+\/[^/?#]+)/.exec(href ?? "")?.[1] ?? "";
}

function parseChapterId(href: string | undefined): string {
  return /\/comic\/\d+\/([^/?#]+)/.exec(href ?? "")?.[1] ?? "";
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

function parseCards($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  for (const element of $(".items .item").toArray()) {
    const item = $(element);
    const anchor = item.find("figure a").first();
    const id = parseComicId(anchor.attr("href"));
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

export class Target extends OceComicSource {}
