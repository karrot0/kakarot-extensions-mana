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
  type Form,
  type Highlight,
  type PagedSearchResult,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SortOption,
  type SourceConfig,
  type SourceInfo,
  type SourcePreferenceProvider,
  type Tag,
} from "@mana-app/types";
import type { CheerioAPI } from "cheerio";

import type { ClientOptions } from "../../lib/client.ts";
import {
  FilterReader,
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  pageOf,
  resolveSortId,
  type PreferenceSection,
  type QueryParams,
  type SectionSpec,
} from "../../lib/forms/index.ts";
import {
  absolute as absoluteFrom,
  chapterNumber,
  fetchHtml,
  imageSrc,
  parseDate,
  parseStatus,
  slug,
  text,
} from "../../lib/html.ts";
import { BaseSource } from "../../lib/source.ts";
import {
  BASE_URL,
  FilterID,
  LANGUAGE_OPTIONS,
  ListID,
  PREFERENCE_DEFAULTS,
  PreferenceID,
  SEARCH_FIELDS,
  SORT_OPTIONS,
  SortID,
  TAG_FIELD,
} from "./model.ts";

const info: SourceInfo = {
  id: "template",
  name: "Template",
  version: "2.0.1",
  description: "Starting point for a Mana content source",
  website: BASE_URL,
  rating: CatalogRating.SAFE,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "Template.png",
  developers: [{ name: "Developer" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["example.com"],
};

class TemplateSource
  extends BaseSource
  implements ChapterSource, SearchProvider, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private readonly preferences = new PreferenceStore(info.id, PREFERENCE_DEFAULTS);

  protected clientOptions(): ClientOptions {
    return { baseUrl: BASE_URL, requests: 5, intervalMs: 1_000 };
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: ListID.Popular,
        title: "Popular",
        style: SectionStyle.SimpleHero,
        load: (page) => this.listing(SortID.Popular, page),
      },
      {
        id: ListID.Latest,
        title: "Latest Updates",
        style: SectionStyle.DetailedVerticalListGrouped,
        load: (page) => this.listing(SortID.Latest, page),
      },
    ];
  }

  private preferenceSections(): PreferenceSection[] {
    return [
      {
        header: "Content",
        footer: "Applies to search results and browsing.",
        fields: [
          {
            type: "select",
            key: PreferenceID.PreferredLanguage,
            title: "Preferred Language",
            options: LANGUAGE_OPTIONS,
          },
          { type: "toggle", key: PreferenceID.ShowAdult, title: "Show Adult Titles" },
        ],
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      fields: SEARCH_FIELDS,
      tags: TAG_FIELD,
      tagsHeader: "Genre",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async getPreferenceMenu(): Promise<Form> {
    return buildPreferenceMenu(this.preferences, this.preferenceSections());
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;

    const filters = new FilterReader(request);

    return this.results(`${BASE_URL}/search`, {
      q: request.query?.trim() ?? "",
      page: pageOf(request),
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Latest),
      status: filters.option(FilterID.Status),
      author: filters.text(FilterID.Author),
      genre: filters.options(FilterID.Genre).join(","),
      year: filters.has(FilterID.Year) ? filters.number(FilterID.Year) : undefined,
      adult: filters.toggle(FilterID.AdultContent) ? "1" : undefined,
    });
  }

  async getContent(contentId: string): Promise<Content> {
    const url = contentUrl(contentId);
    return parseContent(await fetchHtml(this.http, url), url);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    return parseChapters(await fetchHtml(this.http, contentUrl(contentId)));
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const pages = parsePages(await fetchHtml(this.http, chapterUrl(contentId, chapterId)));
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapterId} of "${contentId}"`);
    }
    return { pages };
  }

  private listing(sort: string, page: number): Promise<PagedSearchResult> {
    return this.results(`${BASE_URL}/browse`, { sort, page });
  }

  private async results(url: string, params: QueryParams): Promise<PagedSearchResult> {
    const $ = await fetchHtml(this.http, url, params);
    return { results: parseHighlights($), isLastPage: !hasNextPage($) };
  }
}

function absolute(raw: string): string {
  return absoluteFrom(raw, BASE_URL);
}

function contentUrl(contentId: string): string {
  return `${BASE_URL}/title/${encodeURIComponent(contentId)}`;
}

function chapterUrl(contentId: string, chapterId: string): string {
  return `${contentUrl(contentId)}/${encodeURIComponent(chapterId)}`;
}

function contentIdFrom(href: string): string {
  return /\/title\/([^/?#]+)/.exec(href)?.[1] ?? "";
}

function chapterIdFrom(href: string): string {
  return /\/title\/[^/?#]+\/([^/?#]+)/.exec(href)?.[1] ?? "";
}

function parseHighlights($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];

  for (const element of $(".card").toArray()) {
    const card = $(element);
    const link = card.find("a").first();
    const id = contentIdFrom(link.attr("href") ?? "");
    const title = text(card.find(".title").first()) || text(link);
    if (!id || !title) continue;

    const chapter = text(card.find(".chapter").first());

    results.push({
      id,
      title,
      cover: absolute(imageSrc(card.find("img").first())),
      subtitle: chapter || undefined,
      contentRating: ContentRating.SAFE,
      webUrl: contentUrl(id),
    });
  }

  return results;
}

function hasNextPage($: CheerioAPI): boolean {
  return $(".pagination a[rel='next'], .pagination .next").length > 0;
}

function parseContent($: CheerioAPI, webUrl: string): Content {
  const tags: Tag[] = $(".genres a")
    .toArray()
    .map((element) => text($(element)))
    .filter(Boolean)
    .map((title) => ({ id: slug(title), title }));

  return {
    title: text($("h1").first()),
    cover: absolute(imageSrc($(".cover img").first())),
    summary: text($(".summary").first()),
    tags,
    contentType: ContentType.COMIC,
    contentRating: ContentRating.SAFE,
    status: parseStatus(text($(".status").first())),
    webUrl,
  };
}

function parseChapters($: CheerioAPI): Chapter[] {
  const chapters: Chapter[] = [];

  for (const element of $(".chapter-list a").toArray()) {
    const link = $(element);
    const href = link.attr("href") ?? "";
    const chapterId = chapterIdFrom(href);
    if (!chapterId) continue;

    const title = text(link);
    chapters.push({
      chapterId,
      number: chapterNumber(title, chapters.length + 1),
      index: chapters.length,
      date: parseDate(text(link.find(".date"))) ?? new Date(0),
      language: DefinedLanguages.ENGLISH,
      title,
      webUrl: absolute(href),
    });
  }

  return chapters;
}

function parsePages($: CheerioAPI): ChapterPage[] {
  const pages: ChapterPage[] = [];
  for (const element of $(".reader img").toArray()) {
    const url = absolute(imageSrc($(element)));
    if (url) pages.push({ url });
  }
  return pages;
}

export class Target extends TemplateSource {}
