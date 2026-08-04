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

import { FILTERS } from "./model.ts";
import { BASE_URL, buildClient } from "./network.ts";

const info: SourceInfo = {
  id: "zipcomic",
  name: "ZipComic",
  version: "1.0.0",
  description: "Pulls comics from zipcomic.com",
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
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["www.zipcomic.com", "zipcomic.com"],
  requiresAuthenticationToAccessContent: false,
};

class ZipComicSource implements ContentSource, SearchProvider, PageLinkResolver {
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
    const page = request.page > 0 ? request.page : 1;
    const query = request.listId ? "" : (request.query?.trim() ?? "");

    const $ = await this.fetchCheerio(searchUrl(query, page));
    const results = parseCards($);
    return { results, isLastPage: !hasNextPage($, page) };
  }

  async getContent(contentId: string): Promise<Content> {
    const $ = await this.fetchCheerio(`${BASE_URL}/${contentId}`);

    const title = $("h1").first().text().trim() || contentId;
    const cover = absoluteUrl($("img[src*='cover']").first().attr("src"));

    const fields: Record<string, { text: string; links: string[] }> = {};
    $("strong.text-success").each((_, el) => {
      const label = $(el).text().replace(":", "").trim().toLowerCase();
      const container = $(el).parent();
      const text = container.text().replace($(el).text(), "").replace(/\s+/g, " ").trim();
      const links = container
        .find("a")
        .toArray()
        .map((a) => $(a).text().trim())
        .filter(Boolean);
      fields[label] = { text, links };
    });

    const statusText = (fields["status"]?.text ?? "").toLowerCase();
    const status = statusText.includes("ongoing")
      ? PublicationStatus.ONGOING
      : statusText.includes("complete")
        ? PublicationStatus.COMPLETED
        : undefined;

    const genres = fields["genre"]?.links ?? [];
    const tags: Tag[] = genres.map((g) => ({
      id: g.toLowerCase().replace(/[^a-z0-9]/g, "-"),
      title: g,
    }));

    return {
      title,
      cover,
      summary: "",
      tags,
      contentType: ContentType.COMIC,
      status,
      isNSFW: genres.some((g) => /mature/i.test(g)),
      webUrl: `${BASE_URL}/${contentId}`,
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await this.fetchCheerio(`${BASE_URL}/${contentId}`);
    const chapters: Chapter[] = [];

    let index = 0;
    $("table tr").each((_, element) => {
      const row = $(element);
      const link = row.find("a[href*='-issue-']").first();
      const href = link.attr("href") ?? "";
      if (!href) return;

      const chapterId = toId(href);
      const title = link.text().replace(/\s+/g, " ").trim();

      const order = parseInt(row.find("td").first().text().trim(), 10) || 0;
      const numMatch = /#\s*([\d.]+)/.exec(title) ?? /([\d.]+)\s*$/.exec(title);
      const number = numMatch ? parseFloat(numMatch[1]) : order;

      chapters.push({
        chapterId,
        number,
        index: index++,
        date: new Date(0),
        language: DefinedLanguages.ENGLISH,
        title,
        webUrl: `${BASE_URL}/${chapterId}`,
      });
    });

    return chapters;
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const $ = await this.fetchCheerio(`${BASE_URL}/${chapterId}`);

    const pages: ChapterPage[] = [];
    $("#images img").each((_, element) => {
      const url = ($(element).attr("src") ?? "").trim();
      if (url) pages.push({ url });
    });

    return { pages };
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return [
      {
        id: "latest",
        title: "Latest Updates",
        style: SectionStyle.SimpleSingleRow,
        viewMoreLink: { request: { page: 1, listId: "latest" } },
      },
    ];
  }

  async resolvePageSection(_link: PageLink, _sectionID: string): Promise<ResolvedPageSection> {
    const $ = await this.fetchCheerio(BASE_URL);
    return { items: parseCards($) };
  }

  private async fetchCheerio(url: string): Promise<CheerioAPI> {
    const response = await this.client.get(url);
    return load(response.data);
  }
}

function toId(href: string): string {
  return href.replace(/^\//, "").replace(/\/$/, "").trim();
}

function absoluteUrl(raw: string | undefined): string {
  const url = (raw ?? "").trim();
  if (!url) return "";
  return url.startsWith("http") ? url : `${BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function searchUrl(title: string, page: number): string {
  return `${BASE_URL}/search?kwd=${encodeURIComponent(title)}&p=${page}`;
}

function parseCards($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];
  const seen = new Set<string>();

  $("img.img-responsive").each((_, element) => {
    const img = $(element);
    const src = img.attr("src") ?? "";
    if (!src.includes("/img/")) return;

    const href = img.closest("a").attr("href") ?? "";
    const id = toId(href);
    if (
      !id ||
      id.includes("/") ||
      id.startsWith("genre") ||
      id.includes("-issue-") ||
      seen.has(id)
    ) {
      return;
    }
    seen.add(id);

    results.push({
      id,
      title: img.attr("alt")?.trim() || id,
      cover: absoluteUrl(src),
      webUrl: `${BASE_URL}/${id}`,
    });
  });

  return results;
}

function hasNextPage($: CheerioAPI, page: number): boolean {
  const nextPattern = new RegExp(`[?&]p=${page + 1}(?:&|$)`);
  return $(".pagination a")
    .toArray()
    .some((a) => nextPattern.test($(a).attr("href") ?? ""));
}

export class Target extends ZipComicSource {}
