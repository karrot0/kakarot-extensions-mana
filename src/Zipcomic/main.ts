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
  type SearchProvider,
  type SearchRequest,
  type SourceConfig,
  type SourceInfo,
  type Tag,
} from "@mana-app/types";
import type { CheerioAPI } from "cheerio";

import type { ClientOptions } from "../../lib/client.ts";
import { pageOf, type SectionSpec } from "../../lib/forms/index.ts";
import {
  absolute as absoluteFrom,
  chapterNumber,
  fetchHtml,
  imageSrc,
  normalize,
  parseDate,
  parseStatus,
  slug,
  text,
} from "../../lib/html.ts";
import { BaseSource } from "../../lib/source.ts";
import { BASE_URL, ListID, MATURE_GENRE } from "./model.ts";

const info: SourceInfo = {
  id: "zipcomic",
  name: "ZipComic",
  version: "1.1.1",
  description: "Pulls comics from zipcomic.com",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "ZipComic.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["www.zipcomic.com", "zipcomic.com"],
};

class ZipComicSource extends BaseSource implements ChapterSource, SearchProvider {
  readonly info = info;
  readonly config = config;

  protected clientOptions(): ClientOptions {
    return { baseUrl: BASE_URL, requests: 4, interval: 1 };
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: ListID.Latest,
        title: "Latest Updates",
        style: SectionStyle.SimpleSingleRow,
        load: (page) => this.searchPage("", page),
      },
    ];
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;
    return this.searchPage(request.query?.trim() ?? "", pageOf(request));
  }

  async getContent(contentId: string): Promise<Content> {
    return parseContent(await fetchHtml(this.http, contentUrl(contentId)), contentId);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    return parseChapters(await fetchHtml(this.http, contentUrl(contentId)));
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const pages = parsePages(await fetchHtml(this.http, chapterUrl(chapterId)));

    if (pages.length === 0) {
      throw new Error(`No pages found for "${chapterId}" — the #images markup may have changed.`);
    }

    return { pages };
  }

  private async searchPage(query: string, page: number): Promise<PagedSearchResult> {
    const $ = await fetchHtml(this.http, searchUrl(), { kwd: query, p: page });
    return { results: parseHighlights($), isLastPage: !hasNextPage($, page) };
  }
}

function absolute(raw: string): string {
  return absoluteFrom(raw, BASE_URL);
}

function contentUrl(contentId: string): string {
  return `${BASE_URL}/${contentId}`;
}

function chapterUrl(chapterId: string): string {
  return `${BASE_URL}/${chapterId}`;
}

function searchUrl(): string {
  return `${BASE_URL}/search`;
}

function idFrom(href: string): string {
  return href.replace(/^\//, "").replace(/\/$/, "").trim();
}

function parseHighlights($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];
  const seen = new Set<string>();

  for (const element of $("img.img-responsive").toArray()) {
    const img = $(element);
    const src = imageSrc(img);
    if (!src.includes("/img/")) continue;

    const id = idFrom(img.closest("a").attr("href") ?? "");
    if (!id || id.includes("/") || id.startsWith("genre") || id.includes("-issue-")) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    results.push({
      id,
      title: normalize(img.attr("alt") ?? "") || id,
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

function parseFields($: CheerioAPI): Record<string, { text: string; links: string[] }> {
  const fields: Record<string, { text: string; links: string[] }> = {};

  for (const element of $("strong.text-success").toArray()) {
    const label = $(element).text().replace(":", "").trim().toLowerCase();
    const container = $(element).parent();
    const value = normalize(container.text().replace($(element).text(), ""));
    const links = container
      .find("a")
      .toArray()
      .map((anchor) => text($(anchor)))
      .filter(Boolean);
    fields[label] = { text: value, links };
  }

  return fields;
}

function parseContent($: CheerioAPI, contentId: string): Content {
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
    webUrl: contentUrl(contentId),
  };
}

function parseChapters($: CheerioAPI): Chapter[] {
  const chapters: Chapter[] = [];

  for (const element of $("table tr").toArray()) {
    const row = $(element);
    const link = row.find("a[href*='-issue-']").first();
    const chapterId = idFrom(link.attr("href") ?? "");
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
      webUrl: chapterUrl(chapterId),
    });
  }

  return chapters;
}

function parsePages($: CheerioAPI): ChapterPage[] {
  const pages: ChapterPage[] = [];
  for (const element of $("#images img").toArray()) {
    const url = absolute(imageSrc($(element)));
    if (url) pages.push({ url });
  }
  return pages;
}

export class Target extends ZipComicSource {}
