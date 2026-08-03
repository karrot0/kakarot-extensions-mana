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
  PublicationStatus,
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

import { FILTERS, FilterID, GENRE_OPTIONS } from "./model.ts";
import { BASE_URL, buildClient } from "./network.ts";

const info: SourceInfo = {
  id: "batcave",
  name: "Batcave",
  version: "1.0.0",
  description: "Pulls comics from batcave.biz",
  website: BASE_URL,
  rating: CatalogRating.SAFE,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableTagNavigation: false,
  disableUpdateChecks: false,
  allowsMultipleInstances: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["batcave.biz"],
  requiresAuthenticationToAccessContent: false,
};

class BatcaveSource implements ContentSource, SearchProvider, PageLinkResolver {
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
    const genre = (filters[FilterID.Genre] as string) || "";
    const query = request.query?.trim() ?? "";

    if (query) {
      let $ = await this.fetchCheerio(searchUrl(query, page));
      let results = parseReadedList($);
      if (results.length === 0) {
        const relaxed = relaxSearchTitle(query);
        if (relaxed && relaxed !== query) {
          $ = await this.fetchCheerio(searchUrl(relaxed, page));
          results = parseReadedList($);
        }
      }
      return { results, isLastPage: !hasPaginationNextPage($) };
    }

    if (genre) {
      const $ = await this.fetchCheerio(genreUrl(genre));
      return { results: parseReadedList($), isLastPage: !hasPaginationNextPage($) };
    }

    // batcave.biz doesn't support an empty search query, fall back to the catalogue
    const $ = await this.fetchCheerio(catalogueUrl(page));
    return {
      results: parseReadedList($, "#dle-content .readed"),
      isLastPage: !hasPaginationNextPage($),
    };
  }

  async getContent(contentId: string): Promise<Content> {
    const $ = await this.fetchCheerio(contentUrl(contentId));

    const title = $("h1").first().text().trim();
    const cover = absoluteUrl($(".page__poster img").attr("src"));
    const summary = $(".page__text").text().replace(/\s+/g, " ").trim();

    const statusText = $(".page__list li")
      .filter((_, el) => $(el).text().includes("Release type"))
      .first()
      .text()
      .toLowerCase();
    const status = statusText.includes("completed")
      ? PublicationStatus.COMPLETED
      : statusText.includes("ongoing")
        ? PublicationStatus.ONGOING
        : undefined;

    const tags: Tag[] = [];
    $(".page__tags a").each((_, el) => {
      const tagTitle = $(el).text().trim();
      if (tagTitle)
        tags.push({ id: tagTitle.toLowerCase().replace(/[^a-z0-9]/g, ""), title: tagTitle });
    });

    return {
      title,
      cover,
      summary,
      tags,
      contentType: ContentType.COMIC,
      status,
      webUrl: contentUrl(contentId),
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await this.fetchCheerio(contentUrl(contentId));
    const chapters: Chapter[] = [];

    const chapterScript =
      $(".page__chapters-list script")
        .filter((_, el) => ($(el).html() ?? "").includes("__DATA__"))
        .first()
        .html() ?? "";

    const match = /window\.__DATA__\s*=\s*({[\s\S]*?});/.exec(chapterScript);
    if (!match) return chapters;

    interface RawChapter {
      id: number;
      title?: string;
      posi: number;
      date?: string;
    }

    let parsed: { chapters?: RawChapter[] };
    try {
      parsed = JSON.parse(match[1]) as { chapters?: RawChapter[] };
    } catch {
      return chapters;
    }

    let index = 0;
    for (const raw of parsed.chapters ?? []) {
      if (typeof raw.id !== "number") continue;
      chapters.push({
        chapterId: raw.id.toString(),
        number: raw.posi,
        index: index++,
        date: parsePublishDate(raw.date) ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        title: raw.title?.trim() || `Chapter ${raw.posi}`,
        webUrl: contentUrl(contentId),
      });
    }

    return chapters;
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const newsId = /^(\d+)/.exec(contentId)?.[1];
    if (!newsId) {
      throw new Error(`Could not derive a news id from contentId "${contentId}"`);
    }

    const response = await this.client.request({
      url: `${BASE_URL}/engine/ajax/controller.php?mod=api&action=reader/getChapterData`,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `news_id=${newsId}&chapter_id=${chapterId}`,
    });

    if (response.status === 403 || response.status === 503) {
      throw new CloudflareError(BASE_URL);
    }

    const json = JSON.parse(response.data) as {
      success?: boolean;
      error?: string;
      data?: { images?: string[] };
    };
    if (json.success === false) {
      throw new Error(json.error ?? "Chapter data request was rejected");
    }

    const pages: ChapterPage[] = (json.data?.images ?? []).map((src) => ({
      url: absoluteUrl(src),
    }));
    return { pages };
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return [
      {
        id: "popular",
        title: "Popular",
        style: SectionStyle.SimpleSingleRow,
      },
      {
        id: "catalogue",
        title: "Catalogue",
        style: SectionStyle.SimpleSingleRow,
        viewMoreLink: { request: { page: 1, listId: "catalogue" } },
      },
      {
        id: "new",
        title: "New Comics",
        style: SectionStyle.SimpleSingleRow,
        viewMoreLink: { request: { page: 1, listId: "new" } },
      },
      {
        id: "genres",
        title: "Genres",
        style: SectionStyle.Grid,
      },
    ];
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    if (sectionID === "genres") {
      return { items: genreHighlights() };
    }

    const $ = await this.fetchCheerio(this.sectionUrl(sectionID, 1));
    return { items: this.parseSectionItems(sectionID, $) };
  }

  private async getViewMoreItems(request: SearchRequest): Promise<PagedSearchResult> {
    const page = request.page > 0 ? request.page : 1;
    const listId = request.listId ?? "catalogue";
    const $ = await this.fetchCheerio(this.sectionUrl(listId, page));
    const results = this.parseSectionItems(listId, $);
    return { results, isLastPage: !this.sectionHasNextPage(listId, $) };
  }

  private sectionUrl(sectionID: string, page: number): string {
    switch (sectionID) {
      case "catalogue":
        return catalogueUrl(page);
      case "new":
        return page > 1 ? `${BASE_URL}/page/${page}/` : `${BASE_URL}/`;
      case "popular":
      default:
        return BASE_URL;
    }
  }

  private sectionHasNextPage(sectionID: string, $: CheerioAPI): boolean {
    switch (sectionID) {
      case "catalogue":
        return hasPaginationNextPage($);
      case "new":
        return $(".pagination__btn-loader a").length > 0;
      case "popular":
      default:
        // The homepage's featured carousel does not paginate.
        return false;
    }
  }

  private parseSectionItems(sectionID: string, $: CheerioAPI): Highlight[] {
    switch (sectionID) {
      case "catalogue":
        return parseReadedList($, "#dle-content .readed");
      case "new":
        return parseLatestList($);
      case "popular":
      default:
        return parsePopularList($);
    }
  }

  private async fetchCheerio(url: string): Promise<CheerioAPI> {
    const response = await this.client.get(url);
    return load(response.data);
  }
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
  const path = contentId.split("/").map(encodeURIComponent).join("/");
  return `${BASE_URL}/${path}.html`;
}

function parseContentId(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const slug = href
    .trim()
    .replace(/^https?:/i, "")
    .replace(/^\/\/[^/]+/, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+/, "")
    .replace(/\.html?$/i, "")
    .replace(/\/+$/, "")
    .trim();
  return slug.length > 0 ? slug : undefined;
}

function parseReadedList($: CheerioAPI, selector = ".readed"): Highlight[] {
  const results: Highlight[] = [];

  $(selector).each((_, element) => {
    const unit = $(element);
    const infoLink = unit.find(".readed__title a");
    const title = infoLink.text().trim();
    const imgEl = unit.find(".readed__img img");
    const cover = absoluteUrl(imgEl.attr("data-src") || imgEl.attr("src"));
    const id = parseContentId(infoLink.attr("href"));
    const subtitle = unit
      .find(".readed__info li:last-child")
      .text()
      .trim()
      .replace("Last issue:", "")
      .trim();

    if (!id || !title) return;

    results.push({ id, title, cover, subtitle: subtitle || undefined, webUrl: contentUrl(id) });
  });

  return results;
}

function parsePopularList($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  $(".poster.grid-item").each((_, element) => {
    const unit = $(element);
    const title = unit.find(".poster__title").text().trim();
    const imgEl = unit.find(".poster__img img");
    const cover = absoluteUrl(imgEl.attr("data-src") || imgEl.attr("src"));
    const id = parseContentId(unit.attr("href"));
    const rating = unit.find(".poster__label--rate").text().trim();

    if (!id || !title) return;

    results.push({
      id,
      title,
      cover,
      subtitle: rating ? `Rating: ${rating}` : undefined,
      webUrl: contentUrl(id),
    });
  });

  return results;
}

function parseLatestList($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  $("#content-load .latest.grid-item").each((_, element) => {
    const unit = $(element);
    const titleLink = unit.find(".latest__title a");
    const title = titleLink.clone().children().remove().end().text().trim();
    const imgEl = unit.find(".latest__img img");
    const cover = absoluteUrl(imgEl.attr("data-src") || imgEl.attr("src"));
    const id = parseContentId(titleLink.attr("href"));
    const subtitle = unit.find(".latest__chapter a").text().trim();

    if (!id || !title) return;

    results.push({ id, title, cover, subtitle: subtitle || undefined, webUrl: contentUrl(id) });
  });

  return results;
}

function genreHighlights(): Highlight[] {
  return GENRE_OPTIONS.filter((g) => g.id).map((genre) => ({
    id: `genre:${genre.id}`,
    title: genre.title,
    cover: "",
    link: { request: { page: 1, filters: { [FilterID.Genre]: genre.id } } },
  }));
}

function absoluteUrl(raw: string | undefined): string {
  const url = (raw ?? "").replace(/\\\//g, "/").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${BASE_URL}/${url.replace(/^\/+/, "")}`;
}

function hasPaginationNextPage($: CheerioAPI): boolean {
  const currentPage = parseInt($(".pagination__pages > span").first().text()) || 1;
  return (
    $(".pagination__pages > a").filter((_, el) => {
      const pageNum = parseInt($(el).text());
      return !isNaN(pageNum) && pageNum > currentPage;
    }).length > 0
  );
}

function relaxSearchTitle(title: string): string {
  return title
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePublishDate(date: string | undefined): Date | undefined {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((date ?? "").trim());
  if (!match) return undefined;
  const [, day, month, year] = match;
  return new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
}

export class Target extends BatcaveSource {}
