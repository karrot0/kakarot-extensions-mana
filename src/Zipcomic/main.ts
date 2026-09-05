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
  type ChapterSource,
  type Content,
  type Highlight,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type ResolvedPageSection,
  type SearchProvider,
  type SearchRequest,
  type SourceConfig,
  type SourceInfo,
  type Tag,
} from "@mana-app/types";

import { buildClient, getText } from "./client.ts";
import {
  listResults,
  pageOf,
  sectionById,
  toPageSections,
  withQuery,
  type QueryParams,
  type SectionSpec,
} from "./forms/index.ts";
import { BASE_URL, ListID, MATURE_GENRE } from "./model.ts";

const info: SourceInfo = {
  id: "zipcomic",
  name: "ZipComic",
  version: "1.1.1",
  description: "Pulls comics from zipcomic.com",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["www.zipcomic.com", "zipcomic.com"],
};

class ZipComicSource implements ChapterSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;

  private get http(): NetworkClient {
    this.client ??= buildClient({ baseUrl: BASE_URL, requests: 4, interval: 1 });
    return this.client;
  }

  private async fetchHtml(url: string, params?: QueryParams): Promise<CheerioAPI> {
    return load(await getText(this.http, withQuery(url, params)));
  }

  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.Latest,
        title: "Latest Updates",
        style: SectionStyle.SimpleSingleRow,
        load: (page) => this.searchPage("", page),
      },
    ];
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
    return this.searchPage(request.query?.trim() ?? "", pageOf(request));
  }

  async getContent(contentId: string): Promise<Content> {
    const url = contentUrl(contentId);
    const $ = await this.fetchHtml(url);

    const fields = parseFields($);
    const genres = fields["genre"]?.links ?? [];
    const tags: Tag[] = genres.map((title) => ({ id: slug(title), title }));
    const mature = genres.some((genre) => MATURE_GENRE.test(genre));

    return {
      title: text($("h1").first()) || contentId,
      cover: absolute(imageSrc($("img[src*='cover']").first())),
      summary: fields["summary"]?.text ?? "",
      tags,
      contentType: ContentType.COMIC,
      contentRating: mature ? ContentRating.MATURE : ContentRating.SAFE,
      status: parseStatus(fields["status"]?.text ?? ""),
      webUrl: url,
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await this.fetchHtml(contentUrl(contentId));
    const chapters: Chapter[] = [];

    for (const element of $("table tr").toArray()) {
      const row = $(element);
      const link = row.find("a[href*='-issue-']").first();
      const chapterId = toId(link.attr("href") ?? "");
      if (!chapterId) continue;

      const title = text(link);
      const cells = row.find("td").toArray();
      const order = Number.parseInt(text($(cells[0])), 10) || chapters.length + 1;
      const date = cells.map((cell) => parseDate(text($(cell)))).find(Boolean);

      chapters.push({
        chapterId,
        number: chapterNumber(title, order),
        index: chapters.length,
        date: date ?? new Date(0),
        language: DefinedLanguages.ENGLISH,
        title,
        webUrl: `${BASE_URL}/${chapterId}`,
      });
    }

    return chapters;
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const $ = await this.fetchHtml(`${BASE_URL}/${chapterId}`);

    const pages: ChapterPage[] = [];
    for (const element of $("#images img").toArray()) {
      const url = absolute(imageSrc($(element)));
      if (url) pages.push({ url });
    }

    if (pages.length === 0) {
      throw new Error(`No pages found for "${chapterId}" — the #images markup may have changed.`);
    }

    return { pages };
  }

  private async searchPage(query: string, page: number): Promise<PagedSearchResult> {
    const $ = await this.fetchHtml(`${BASE_URL}/search`, { kwd: query, p: page });
    return { results: parseCards($), isLastPage: !hasNextPage($, page) };
  }
}

const LAZY_ATTRS = ["data-src", "data-original", "data-lazy-src", "srcset", "src"];

function text(node: Cheerio<AnyNode>): string {
  return node.text().replace(/\s+/g, " ").trim();
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

function parseDate(raw: string): Date | undefined {
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
}

function contentUrl(contentId: string): string {
  return `${BASE_URL}/${contentId}`;
}

function toId(href: string): string {
  return href.replace(/^\//, "").replace(/\/$/, "").trim();
}

function parseStatus(raw: string): PublicationStatus | undefined {
  const value = raw.toLowerCase();
  if (value.includes("ongoing")) return PublicationStatus.ONGOING;
  if (value.includes("complete")) return PublicationStatus.COMPLETED;
  return undefined;
}

function parseFields($: CheerioAPI): Record<string, { text: string; links: string[] }> {
  const fields: Record<string, { text: string; links: string[] }> = {};

  for (const element of $("strong.text-success").toArray()) {
    const label = $(element).text().replace(":", "").trim().toLowerCase();
    const container = $(element).parent();
    const value = container.text().replace($(element).text(), "").replace(/\s+/g, " ").trim();
    const links = container
      .find("a")
      .toArray()
      .map((anchor) => text($(anchor)))
      .filter(Boolean);
    fields[label] = { text: value, links };
  }

  return fields;
}

function parseCards($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];
  const seen = new Set<string>();

  for (const element of $("img.img-responsive").toArray()) {
    const img = $(element);
    const src = imageSrc(img);
    if (!src.includes("/img/")) continue;

    const id = toId(img.closest("a").attr("href") ?? "");
    if (!id || id.includes("/") || id.startsWith("genre") || id.includes("-issue-")) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    results.push({
      id,
      title: (img.attr("alt") ?? "").replace(/\s+/g, " ").trim() || id,
      cover: absolute(src),
      contentRating: ContentRating.SAFE,
      webUrl: contentUrl(id),
    });
  }

  return results;
}

function hasNextPage($: CheerioAPI, page: number): boolean {
  const nextPattern = new RegExp(`[?&]p=${page + 1}(?:&|$)`);
  return $(".pagination a")
    .toArray()
    .some((anchor) => nextPattern.test($(anchor).attr("href") ?? ""));
}

export class Target extends ZipComicSource {}
