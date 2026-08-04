import { load } from "cheerio";
import type { CheerioAPI } from "cheerio";
import {
  type ContentSource,
  type SourceConfig,
  type Content,
  ContentType,
  type Chapter,
  type ChapterData,
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
  type LinkItem,
  SearchProvider,
  SortOption,
  SectionStyle,
  links,
} from "@mana-app/types";

import { FILTERS, FilterID, NON_COMIC_CATEGORIES } from "./model.ts";
import { BASE_URL, buildClient } from "./network.ts";

const info: SourceInfo = {
  id: "getcomics",
  name: "GetComics",
  version: "1.0.0",
  description: "Pulls comics from getcomics.org",
  website: BASE_URL,
  rating: CatalogRating.SAFE,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "icon.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableTagNavigation: false,
  disableUpdateChecks: false,
  allowsMultipleInstances: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["getcomics.org"],
  requiresAuthenticationToAccessContent: false,
};

class GetComicsSource implements ContentSource, SearchProvider, PageLinkResolver {
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
    return [{ id: "default", title: "Default", isDefault: true, isOrderable: false }];
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId) {
      return this.getViewMoreItems(request);
    }

    const page = request.page > 0 ? request.page : 1;
    const filters = (request.filters ?? {}) as Record<string, unknown>;
    const category = (filters[FilterID.Category] as string) || "";
    const query = request.query?.trim() ?? "";

    if (query) {
      const $ = await this.fetchCheerio(searchUrl(query, page));
      return { results: parsePostList($), isLastPage: isLastPage($) };
    }

    if (category) {
      const $ = await this.fetchCheerio(categoryUrl(category, page));
      return { results: parsePostList($), isLastPage: isLastPage($) };
    }

    const $ = await this.fetchCheerio(homeUrl(page));
    return { results: parsePostList($), isLastPage: isLastPage($) };
  }

  async getContent(contentId: string): Promise<Content> {
    const $ = await this.fetchCheerio(contentUrl(contentId));

    const title = $(".post-title").first().text().trim();
    const cover = coverUrl($);
    const summary = parseSummary($);
    const tags = parseTags($);
    const downloadLinks = parseDownloadLinks($);

    return {
      title,
      cover,
      summary,
      tags,
      contentType: ContentType.COMIC,
      isNSFW: false,
      webUrl: contentUrl(contentId),
      additionalInfo:
        downloadLinks.length > 0
          ? [links.section({ id: "download-links", title: "Download Links", items: downloadLinks })]
          : undefined,
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await this.fetchCheerio(contentUrl(contentId));
    const date = parsePublishDate($) ?? new Date(0);

    return [
      {
        chapterId: "issue",
        number: 1,
        index: 0,
        date,
        language: DefinedLanguages.ENGLISH,
        title: "Full Release",
        webUrl: contentUrl(contentId),
      },
    ];
  }

  async getChapterData(contentId: string): Promise<ChapterData> {
    // GetComics is a download-link aggregator: releases are distributed as
    // .cbr/.cbz archives through mirrors (Mega, TeraBox, PixelDrain, etc.)
    // rather than hosted as readable pages, so there are no images to return
    // here. The mirrors are surfaced on the content page's "Download Links"
    // section instead.
    throw new Error(
      `"${contentId}" is not readable in-app. Use the Download Links on ${contentUrl(contentId)} to get this release.`,
    );
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return [
      {
        id: "new",
        title: "New Releases",
        style: SectionStyle.DetailedVerticalListGrouped,
        viewMoreLink: { request: { page: 1, listId: "new" } },
      },
      {
        id: "marvel",
        title: "Marvel",
        style: SectionStyle.DetailedTripleRowPaged,
        viewMoreLink: { request: { page: 1, listId: "marvel" } },
      },
      {
        id: "dc",
        title: "DC Comics",
        style: SectionStyle.DetailedTripleRowPaged,
        viewMoreLink: { request: { page: 1, listId: "dc" } },
      },
    ];
  }

  async willResolveSectionsForPage(_link: PageLink): Promise<void> {
    await this.fetchCheerio(BASE_URL);
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const $ = await this.fetchCheerio(this.sectionUrl(sectionID, 1));
    return { items: parsePostList($) };
  }

  private async getViewMoreItems(request: SearchRequest): Promise<PagedSearchResult> {
    const page = request.page > 0 ? request.page : 1;
    const listId = request.listId ?? "new";
    const $ = await this.fetchCheerio(this.sectionUrl(listId, page));
    return { results: parsePostList($), isLastPage: isLastPage($) };
  }

  private sectionUrl(sectionID: string, page: number): string {
    switch (sectionID) {
      case "marvel":
        return categoryUrl("marvel", page);
      case "dc":
        return categoryUrl("dc", page);
      case "new":
      default:
        return homeUrl(page);
    }
  }

  private async fetchCheerio(url: string): Promise<CheerioAPI> {
    const response = await this.client.get(url);
    return load(response.data);
  }
}

function homeUrl(page: number): string {
  return page > 1 ? `${BASE_URL}/page/${page}/` : `${BASE_URL}/`;
}

function categoryUrl(slug: string, page: number): string {
  return page > 1 ? `${BASE_URL}/cat/${slug}/page/${page}/` : `${BASE_URL}/cat/${slug}/`;
}

function searchUrl(query: string, page: number): string {
  const q = `?s=${encodeURIComponent(query)}`;
  return page > 1 ? `${BASE_URL}/page/${page}/${q}` : `${BASE_URL}/${q}`;
}

function contentUrl(contentId: string): string {
  const path = contentId
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${BASE_URL}/${path}/`;
}

function parseContentId(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const path = href
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim();
  return path.length > 0 ? path : undefined;
}

function isComicPost($: CheerioAPI, element: import("cheerio").Element): boolean {
  const classAttr = $(element).attr("class") ?? "";
  return !NON_COMIC_CATEGORIES.some((category) => classAttr.includes(category));
}

function parsePostList($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  $("article.post").each((_, element) => {
    if (!isComicPost($, element)) return;

    const unit = $(element);
    const titleLink = unit.find(".post-title a").first();
    const title = titleLink.text().trim();
    const id = parseContentId(titleLink.attr("href"));
    const cover = (unit.find(".post-header-image img").attr("src") ?? "").trim();
    const info = unit
      .find("p")
      .filter((_, el) => $(el).text().includes("Size"))
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    if (!id || !title) return;

    results.push({ id, title, cover, subtitle: info || undefined, webUrl: contentUrl(id) });
  });

  return results;
}

function isLastPage($: CheerioAPI): boolean {
  const match = /Page\s+(\d+)\s+of\s+(\d+)/i.exec($(".pagination-current-page").text());
  if (!match) return true;
  const [, current, total] = match;
  return parseInt(current, 10) >= parseInt(total, 10);
}

function coverUrl($: CheerioAPI): string {
  const og = $('meta[property="og:image"]').attr("content") ?? "";
  return og.replace(/^http:\/\//i, "https://").trim();
}

function parseSummary($: CheerioAPI): string {
  const paragraph = $(".post-contents p")
    .filter((_, el) => $(el).text().trim().length > 0)
    .first();
  return paragraph.text().replace(/\s+/g, " ").trim();
}

function parseTags($: CheerioAPI): { id: string; title: string }[] {
  const tags: { id: string; title: string }[] = [];
  const seen = new Set<string>();

  $(".post-tags a").each((_, el) => {
    const title = $(el).text().trim();
    if (!title || seen.has(title)) return;
    seen.add(title);
    tags.push({ id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title });
  });

  return tags;
}

function parseDownloadLinks($: CheerioAPI): LinkItem[] {
  const items: LinkItem[] = [];
  const seen = new Set<string>();

  $(".aio-button-center a").each((_, el) => {
    const anchor = $(el);
    const url = anchor.attr("href");
    const title = (anchor.attr("title") || anchor.text()).trim();
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    items.push(links.item({ id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title, url }));
  });

  return items;
}

function parsePublishDate($: CheerioAPI): Date | undefined {
  const datetime = $("time").first().attr("datetime");
  if (!datetime) return undefined;
  const date = new Date(datetime);
  return isNaN(date.getTime()) ? undefined : date;
}

export class Target extends GetComicsSource {}
