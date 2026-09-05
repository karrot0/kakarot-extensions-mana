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
  type Form,
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
  type SourcePreferenceProvider,
  type Tag,
} from "@mana-app/types";

import { buildClient, getText } from "./client.ts";
import {
  FilterReader,
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  listResults,
  pageOf,
  resolveSortId,
  sectionById,
  toPageSections,
  withQuery,
  type PreferenceSection,
  type QueryParams,
  type SectionSpec,
} from "./forms/index.ts";
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
  thumbnail: "assets/icon.png",
  developers: [{ name: "Developer" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  cloudflareResolutionURL: BASE_URL,
  owningLinks: ["example.com"],
};

class TemplateSource
  implements ChapterSource, SearchProvider, PageLinkResolver, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private readonly preferences = new PreferenceStore(info.id, PREFERENCE_DEFAULTS);

  private get http(): NetworkClient {
    this.client ??= buildClient({ baseUrl: BASE_URL, requests: 5, interval: 1 });
    return this.client;
  }

  private async fetchHtml(url: string, params?: QueryParams): Promise<CheerioAPI> {
    return load(await getText(this.http, withQuery(url, params)));
  }

  private sections(): SectionSpec[] {
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

    const filters = new FilterReader(request);

    const $ = await this.fetchHtml(`${BASE_URL}/search`, {
      q: request.query?.trim() ?? "",
      page: pageOf(request),
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Latest),
      status: filters.option(FilterID.Status),
      author: filters.text(FilterID.Author),
      genre: filters.options(FilterID.Genre).join(","),
      year: filters.has(FilterID.Year) ? filters.number(FilterID.Year) : undefined,
      adult: filters.toggle(FilterID.AdultContent) ? "1" : undefined,
    });

    return { results: parseHighlights($), isLastPage: !hasNextPage($) };
  }

  async getContent(contentId: string): Promise<Content> {
    const url = contentUrl(contentId);
    const $ = await this.fetchHtml(url);

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
      webUrl: url,
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await this.fetchHtml(contentUrl(contentId));
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

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const $ = await this.fetchHtml(chapterUrl(contentId, chapterId));

    const pages: ChapterPage[] = [];
    for (const element of $(".reader img").toArray()) {
      const url = absolute(imageSrc($(element)));
      if (url) pages.push({ url });
    }

    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapterId} of "${contentId}"`);
    }

    return { pages };
  }

  private async listing(sort: string, page: number): Promise<PagedSearchResult> {
    const $ = await this.fetchHtml(`${BASE_URL}/browse`, { sort, page });
    return { results: parseHighlights($), isLastPage: !hasNextPage($) };
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
  const value = raw.replace(/\\\//g, "/").trim();
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

function parseStatus(raw: string): PublicationStatus | undefined {
  const value = raw.toLowerCase();
  if (value.includes("ongoing")) return PublicationStatus.ONGOING;
  if (value.includes("complet")) return PublicationStatus.COMPLETED;
  if (value.includes("hiatus")) return PublicationStatus.HIATUS;
  if (value.includes("cancel")) return PublicationStatus.CANCELLED;
  return undefined;
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

export class Target extends TemplateSource {}
