import { load } from "cheerio";
import type { CheerioAPI } from "cheerio";
import {
  type ContentSource,
  type SourceConfig,
  type Content,
  ContentType,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type SearchRequest,
  type PagedSearchResult,
  type SourceInfo,
  type SearchFilter,
  CatalogRating,
  DefinedLanguages,
  type PageLinkResolver,
  type PageLink,
  type PageSection,
  type ResolvedPageSection,
  type Highlight,
  type Tag,
  SearchProvider,
  SortOption,
  SectionStyle,
} from "@mana-app/types";

import { FILTERS, FilterID } from "./model.ts";
import { BASE_URL, buildClient } from "./network.ts";

const info: SourceInfo = {
  id: "ocecomic",
  name: "OceComic",
  version: "1.0.0",
  description: "Pulls comics from ocecomic.com",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableTagNavigation: false,
  disableUpdateChecks: false,
  allowsMultipleInstances: false,
  owningLinks: ["ocecomic.com", "www.ocecomic.com"],
  requiresAuthenticationToAccessContent: false,
};

class OceComicSource implements ContentSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client!: NetworkClient;

  async onEnvironmentLoaded(): Promise<void> {
    this.client = buildClient();
  }

  async getSearchFilters(): Promise<SearchFilter[]> {
    return FILTERS;
  }

  async getSortOptions(): Promise<SortOption[]> {
    return [
      { id: "latest", title: "Latest", isDefault: true, isOrderable: false },
      { id: "popular", title: "Popular", isOrderable: false },
      { id: "newer", title: "Newest", isOrderable: false },
      { id: "older", title: "Oldest", isOrderable: false },
    ];
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId) {
      return this.getViewMoreItems(request);
    }

    const page = request.page > 0 ? request.page : 1;
    const sort = request.sort?.id || "latest";
    const query = request.query?.trim() ?? "";

    if (query) {
      const $ = await this.fetchCheerio(searchUrl(query, sort, page));
      return { results: parseCards($), isLastPage: isLastPage($, page) };
    }

    const filters = (request.filters ?? {}) as Record<string, unknown>;
    const genre = (filters[FilterID.Genre] as string) || "all";

    const $ = await this.fetchCheerio(listingUrl(genre, sort, page));
    return { results: parseCards($), isLastPage: isLastPage($, page) };
  }

  async getContent(contentId: string): Promise<Content> {
    const $ = await this.fetchCheerio(contentUrl(contentId));

    const title = $(".detail .title h1").first().text().trim() || contentId;
    const cover = absoluteUrl($(".page.home img").first().attr("src"));
    const summary = $(".about").first().text().replace(/\s+/g, " ").trim();

    const fields: Record<string, string[]> = {};
    $(".info ul").each((_, ul) => {
      const el = $(ul);
      const label = el.find("li").first().text().trim().toLowerCase();
      const linkTitles = el
        .find("li a")
        .toArray()
        .map((a) => $(a).text().trim())
        .filter(Boolean);
      fields[label] = linkTitles;
    });

    const genreTitles = [...(fields["theme"] ?? []), ...(fields["genre"] ?? [])];
    const tags: Tag[] = genreTitles.map((genreTitle) => ({
      id: genreTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title: genreTitle,
    }));

    return {
      title,
      cover,
      summary,
      tags,
      contentType: ContentType.COMIC,
      isNSFW: genreTitles.some((genreTitle) => /mature/i.test(genreTitle)),
      webUrl: contentUrl(contentId),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await this.fetchCheerio(contentUrl(contentId));
    const chapters: Chapter[] = [];

    let index = 0;
    $("a.issue-link").each((_, element) => {
      const link = $(element);
      const chapterId = parseChapterId(link.attr("href"));
      if (!chapterId) return;

      const title = link.text().replace(/\s+/g, " ").trim();
      const numMatch = /#\s*([\d.]+)/.exec(title);
      const number = numMatch ? parseFloat(numMatch[1]) : index + 1;

      chapters.push({
        chapterId,
        number,
        index: index++,
        date: new Date(0),
        language: DefinedLanguages.ENGLISH,
        title: title || `Issue #${number}`,
        webUrl: chapterUrl(contentId, chapterId),
      });
    });

    return chapters;
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const $ = await this.fetchCheerio(chapterUrl(contentId, chapterId));

    const pages: ChapterPage[] = [];
    $(".pages .page.issue img").each((_, element) => {
      const url = ($(element).attr("src") ?? "").trim();
      if (url) pages.push({ url });
    });

    return { pages };
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return [
      {
        id: "new",
        title: "New Comics",
        style: SectionStyle.SimpleSingleRow,
        viewMoreLink: { request: { page: 1, listId: "new" } },
      },
      {
        id: "popular",
        title: "Popular Comics",
        style: SectionStyle.SimpleSingleRow,
        viewMoreLink: { request: { page: 1, listId: "popular" } },
      },
    ];
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const $ = await this.fetchCheerio(this.sectionUrl(sectionID, 1));
    return { items: parseCards($) };
  }

  private async getViewMoreItems(request: SearchRequest): Promise<PagedSearchResult> {
    const page = request.page > 0 ? request.page : 1;
    const listId = request.listId ?? "new";
    const $ = await this.fetchCheerio(this.sectionUrl(listId, page));
    return { results: parseCards($), isLastPage: isLastPage($, page) };
  }

  private sectionUrl(sectionID: string, page: number): string {
    switch (sectionID) {
      case "popular":
        return listingUrl("all", "popular", page);
      case "new":
      default:
        return listingUrl("all", "latest", page);
    }
  }

  private async fetchCheerio(url: string): Promise<CheerioAPI> {
    const response = await this.client.get(url);
    return load(response.data);
  }
}

function parseComicId(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const match = /\/comic\/(\d+\/[^/?#]+)/.exec(href);
  return match ? match[1] : undefined;
}

function parseChapterId(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const match = /\/comic\/\d+\/([^/?#]+)/.exec(href);
  return match ? match[1] : undefined;
}

function contentUrl(contentId: string): string {
  return `${BASE_URL}/comic/${contentId}`;
}

function chapterUrl(contentId: string, chapterId: string): string {
  const numericId = contentId.split("/")[0];
  return `${BASE_URL}/comic/${numericId}/${chapterId}`;
}

function absoluteUrl(raw: string | undefined): string {
  const url = (raw ?? "").trim();
  if (!url) return "";
  return url.startsWith("http") ? url : `${BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function listingUrl(genre: string, sort: string, page: number): string {
  const base = `${BASE_URL}/comic/${genre || "all"}/${sort}`;
  return page > 1 ? `${base}/page/${page}` : base;
}

function searchUrl(query: string, sort: string, page: number): string {
  const base = `${BASE_URL}/search/${encodeURIComponent(query)}/${sort}`;
  return page > 1 ? `${base}/page/${page}` : base;
}

function parseCards($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  $(".items .item").each((_, element) => {
    const item = $(element);
    const anchor = item.find("figure a").first();
    const id = parseComicId(anchor.attr("href"));
    if (!id) return;

    const img = anchor.find("img").first();
    const cover = absoluteUrl(img.attr("src"));
    const rawTitle = item.find("h2 a").first().text().trim() || img.attr("alt")?.trim() || id;
    const title = sanitizeText(rawTitle) || id;

    results.push({ id, title, cover, webUrl: contentUrl(id) });
  });

  return results;
}

function sanitizeText(raw: string): string {
  // ocecomic.com sometimes truncates listing titles mid UTF-8 character
  // (byte-unsafe server-side substring) before appending "...", leaving an
  // unencodable fragment. Cut from the corruption point rather than ship
  // an invalid string back to the app.
  let text = raw;
  const replacementIndex = text.indexOf("�");
  if (replacementIndex >= 0) {
    text = text.slice(0, replacementIndex);
  } else {
    // Guard the case where the truncated lead byte survives as a literal
    // high codepoint (a valid UTF-8 lead byte is 0xC2-0xF4) right before
    // the site's "..." suffix, instead of being replaced with U+FFFD.
    text = text.replace(/[Â-ô]\s*\.{2,}\s*$/, "");
  }
  return text.replace(/[.\s]+$/, "").trim();
}

function totalPages($: CheerioAPI): number {
  const options = $(".pagin select[name='page'] option");
  if (options.length === 0) return 1;
  const last = parseInt(options.last().attr("value") ?? "1", 10);
  return Number.isFinite(last) && last > 0 ? last : 1;
}

function isLastPage($: CheerioAPI, page: number): boolean {
  return page >= totalPages($);
}

export class Target extends OceComicSource {}
