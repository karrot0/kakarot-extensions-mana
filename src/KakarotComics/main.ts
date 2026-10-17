import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  SectionStyle,
  type Chapter,
  type ChapterData,
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

import type { ClientOptions } from "../../lib/client.ts";
import {
  FilterReader,
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  pageOf,
  resolveSortId,
  type PreferenceSection,
  type SectionSpec,
} from "../../lib/forms/index.ts";
import { BaseSource } from "../../lib/source.ts";
import {
  DEFAULT_BASE_URL,
  FilterID,
  GENRE_FIELD,
  ListID,
  PREFERENCE_DEFAULTS,
  PREFERENCE_NAMESPACE,
  PreferenceID,
  SORT_OPTIONS,
  SOURCE_FIELD,
  SOURCE_OPTIONS,
  SortID,
  type ApiIssue,
  type ApiPage,
  type ApiPages,
  type ApiSeries,
  type ApiSeriesDetail,
} from "./model.ts";

const info: SourceInfo = {
  id: "kakarotcomics",
  name: "KakarotComics",
  version: "2.0.2",
  description: "Batcave and OceComic through one lightweight proxy",
  website: DEFAULT_BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "KakarotComics.jpg",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  allowsMultipleInstances: true,
};

class KakarotComicsSource
  extends BaseSource
  implements ChapterSource, SearchProvider, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private readonly preferences = new PreferenceStore(PREFERENCE_NAMESPACE, PREFERENCE_DEFAULTS);

  protected clientOptions(): ClientOptions {
    return { baseUrl: DEFAULT_BASE_URL, requests: 20, interval: 1, json: true };
  }

  // The settings screen doesn't apply in the app, so the proxy address is
  // fixed to the hosted instance rather than a preference.
  protected override async apiBase(): Promise<string> {
    return DEFAULT_BASE_URL;
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: ListID.BatcavePopular,
        title: "Popular on Batcave",
        style: SectionStyle.SimpleHero,
        viewMore: false,
        load: (page) => this.list(ListID.BatcavePopular, page),
      },
      {
        id: ListID.BatcaveNew,
        title: "New on Batcave",
        style: SectionStyle.DetailedVerticalListGrouped,
        load: (page) => this.list(ListID.BatcaveNew, page),
      },
      {
        id: ListID.OceComicNew,
        title: "New on OceComic",
        style: SectionStyle.SimpleSingleRow,
        load: (page) => this.list(ListID.OceComicNew, page),
      },
      {
        id: ListID.OceComicPopular,
        title: "Popular on OceComic",
        style: SectionStyle.SimpleSingleRow,
        load: (page) => this.list(ListID.OceComicPopular, page),
      },
      {
        id: ListID.BatcaveCatalogue,
        title: "Batcave Catalogue",
        style: SectionStyle.DetailedTripleRowPaged,
        load: (page) => this.list(ListID.BatcaveCatalogue, page),
      },
    ];
  }

  private preferenceSections(): PreferenceSection[] {
    return [
      {
        header: "Sources",
        footer: "Which sources search covers. Leave empty to search both.",
        fields: [
          {
            type: "multiselect",
            key: PreferenceID.Sources,
            title: "Search Sources",
            options: SOURCE_OPTIONS,
          },
        ],
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      fields: [SOURCE_FIELD],
      header: "Filters",
      tags: GENRE_FIELD,
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
    const base = await this.apiBase();
    const result = await this.getJson<ApiPage<ApiSeries>>("/api/search", {
      q: request.query?.trim() || undefined,
      source: filters.text(FilterID.Source) || (await this.defaultSource()),
      genre: filters.text(FilterID.Genre) || undefined,
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Latest),
      page: pageOf(request),
    });
    return toPagedResult(result, base);
  }

  async getContent(contentId: string): Promise<Content> {
    const base = await this.apiBase();
    const { data } = await this.getJson<{ data: ApiSeriesDetail }>(
      `/api/series/${encodeURIComponent(contentId)}`,
    );
    return parseContent(data, base);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const { data } = await this.getJson<{ data: ApiIssue[] }>(
      `/api/series/${encodeURIComponent(contentId)}/issues`,
    );
    return data.map((issue, index) => ({
      chapterId: issue.id,
      number: issue.number,
      index,
      date: issue.date ? new Date(`${issue.date}T00:00:00Z`) : new Date(0),
      language: DefinedLanguages.ENGLISH,
      title: issue.title,
      webUrl: issue.web_url,
    }));
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const base = await this.apiBase();
    const { data } = await this.getJson<ApiPages>(
      `/api/issues/${encodeURIComponent(chapterId)}/pages`,
    );
    if (data.pages.length === 0) throw new Error("No pages available for this issue.");
    return { pages: data.pages.map((page) => ({ url: resolveUrl(page.url, base) })) };
  }

  private async list(listId: string, page: number): Promise<PagedSearchResult> {
    const [source, name] = listId.split(":");
    const base = await this.apiBase();
    const result = await this.getJson<ApiPage<ApiSeries>>(`/api/list/${source}/${name}`, { page });
    return toPagedResult(result, base);
  }

  /** `all`, or the one source the preference narrows search to. */
  private async defaultSource(): Promise<string> {
    const chosen = await this.preferences.get(PreferenceID.Sources);
    return chosen.length === 1 ? (chosen[0] ?? "all") : "all";
  }
}


/** Proxied images come back server-relative; anything absolute is used as is. */
function resolveUrl(url: string | undefined, base: string): string {
  const value = url ?? "";
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `${base}${value.startsWith("/") ? "" : "/"}${value}`;
}

function toPagedResult(result: ApiPage<ApiSeries>, base: string): PagedSearchResult {
  return {
    results: result.data.map((series) => seriesHighlight(series, base)),
    isLastPage: !result.has_more,
  };
}

function seriesHighlight(series: ApiSeries, base: string): Highlight {
  return {
    id: series.slug,
    title: series.title,
    cover: resolveUrl(series.cover_url, base),
    subtitle: series.subtitle,
    contentRating: ContentRating.SAFE,
  };
}

const STATUS: Record<string, PublicationStatus> = {
  ongoing: PublicationStatus.ONGOING,
  completed: PublicationStatus.COMPLETED,
  hiatus: PublicationStatus.HIATUS,
  cancelled: PublicationStatus.CANCELLED,
};

function parseContent(data: ApiSeriesDetail, base: string): Content {
  const tags: Tag[] = data.tags.map((tag) => ({ id: tag.id, title: tag.title }));
  const facts = [
    data.writer ? `Writer: ${data.writer}` : "",
    data.publisher ? `Publisher: ${data.publisher}` : "",
    `Source: ${data.source}`,
  ].filter(Boolean);

  return {
    title: data.title,
    cover: resolveUrl(data.cover_url, base),
    summary: [data.description.trim(), facts.join("\n")].filter(Boolean).join("\n\n"),
    tags,
    contentType: ContentType.COMIC,
    contentRating: data.mature ? ContentRating.MATURE : ContentRating.SAFE,
    status: data.status ? STATUS[data.status] : undefined,
    webUrl: data.web_url,
  };
}

export class Target extends KakarotComicsSource {}
