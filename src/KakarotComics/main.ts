import {
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  PublicationStatus,
  SectionStyle,
  additionalInfo,
  type Chapter,
  type ChapterData,
  type Content,
  type ContentSource,
  type Form,
  type Highlight,
  type Option,
  type PageLink,
  type PageLinkResolver,
  type PageSection,
  type PagedSearchResult,
  type Provider,
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

import { buildClient } from "./client.ts";
import {
  CHAPTER_FETCH_LIMIT,
  CHARACTER_PREFIX,
  DEFAULT_BASE_URL,
  FilterID,
  ListID,
  MAX_CHAPTER_REQUESTS,
  PAGE_SIZE,
  PREFERENCE_DEFAULTS,
  PREFERENCE_NAMESPACE,
  PUBLISHER_OPTIONS_LIMIT,
  PreferenceID,
  SEARCH_FIELDS,
  SERIES_LANGUAGE,
  SORT_OPTIONS,
  SeriesSort,
  type ApiCharacter,
  type ApiIssue,
  type ApiManifestPage,
  type ApiPage,
  type ApiPageManifest,
  type ApiPublisher,
  type ApiSeries,
  type ApiSeriesDetail,
} from "./model.ts";
import {
  FilterReader,
  PreferenceStore,
  buildPreferenceMenu,
  buildSearchForm,
  pageOf,
  resolveSortId,
  toPageSections,
  withQuery,
  type PreferenceSection,
  type QueryParams,
  type SectionSpec,
} from "./forms/index.ts";

const info: SourceInfo = {
  id: "kakarotcomics",
  name: "KakarotComics",
  version: "1.2.0",
  description: "Kakarot Comics",
  website: DEFAULT_BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "assets/icon.jpg",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  allowsMultipleInstances: true,
};

class KakarotComicsSource
  implements ContentSource, SearchProvider, PageLinkResolver, SourcePreferenceProvider
{
  readonly info = info;
  readonly config = config;

  private client: NetworkClient | undefined;
  private readonly preferences = new PreferenceStore(PREFERENCE_NAMESPACE, PREFERENCE_DEFAULTS);

  private get http(): NetworkClient {
    this.client ??= buildClient({
      baseUrl: DEFAULT_BASE_URL,
      requests: 20,
      interval: 1,
      json: true,
    });
    return this.client;
  }

  private async baseUrl(): Promise<string> {
    const stored = await this.preferences.get(PreferenceID.BaseUrl);
    return normalizeBaseUrl(stored) || DEFAULT_BASE_URL;
  }

  private async publisherAllowlist(): Promise<string[]> {
    return this.preferences.get(PreferenceID.PublisherAllowlist);
  }

  private async getJson<T>(path: string, params?: QueryParams): Promise<T> {
    const base = await this.baseUrl();
    const target = withQuery(`${base}${path}`, params);
    const response = await this.http.get(target);
    try {
      return JSON.parse(response.data) as T;
    } catch {
      throw new Error(`${base} did not return JSON — is it a comic-api server?`);
    }
  }

  private sections(): SectionSpec[] {
    return [
      {
        id: ListID.PopularSeries,
        title: "Longest Running",
        subtitle: "Series with the most issues on record",
        style: SectionStyle.SimpleHero,
        load: (page) => this.seriesList(SeriesSort.Popular, page),
      },
      {
        id: ListID.Characters,
        title: "Popular Characters",
        subtitle: "Tap for the series they appear in",
        style: SectionStyle.DetailedTripleRowPaged,
        load: (page) => this.characterList(page),
      },
      {
        id: ListID.RecentSeries,
        title: "Newest Series",
        style: SectionStyle.DetailedVerticalListGrouped,
        load: (page) => this.seriesList(SeriesSort.Recent, page),
      },
    ];
  }

  private preferenceSections(): PreferenceSection[] {
    return [
      {
        header: "Server",
        footer:
          `Which comic-api instance to read from. Defaults to ${DEFAULT_BASE_URL}, ` +
          `the hosted one — leave it alone unless you run your own. If you do, use a ` +
          `LAN address or hostname rather than localhost: on a phone, localhost is the phone.`,
        fields: [
          {
            type: "text",
            key: PreferenceID.BaseUrl,
            title: "API Base URL",
            placeholder: DEFAULT_BASE_URL,
            keyboard: "alphanumeric",
          },
        ],
      },
      {
        header: "Publishers",
        footer:
          `Only show series from the selected publishers, in both search and browsing. ` +
          `Leave empty to show everything. Lists the ${PUBLISHER_OPTIONS_LIMIT} publishers ` +
          `with the most series in the catalogue.`,
        fields: [
          {
            type: "multiselect",
            key: PreferenceID.PublisherAllowlist,
            title: "Publisher Allowlist",
            options: () => this.publisherOptions(),
          },
        ],
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({ fields: SEARCH_FIELDS, header: "Filters" });
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
    const { results } = await this.listResults(sectionID, 1);
    return { items: results };
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId) return this.listResults(request.listId, pageOf(request));

    const page = pageOf(request);
    const filters = new FilterReader(request);

    const params: QueryParams = {
      sort: resolveSortId(SORT_OPTIONS, request, SeriesSort.Title),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      language: SERIES_LANGUAGE,
      search: request.query?.trim() || undefined,
      type: filters.text(FilterID.Type) || undefined,
      character: filters.text(FilterID.Character) || undefined,
    };

    const year = filters.number(FilterID.Year);
    if (Number.isFinite(year)) params.year = Math.trunc(year);

    const publisher = filters.text(FilterID.Publisher);
    if (publisher) {
      params.publisher = publisher;
    } else {
      const allowlist = await this.publisherAllowlist();
      if (allowlist.length > 0) params.publisher = allowlist.join(",");
    }

    const result = await this.getJson<ApiPage<ApiSeries>>("/api/series", params);
    return toPagedResult(result, result.data.map(seriesHighlight));
  }

  async getContent(contentId: string): Promise<Content> {
    if (contentId.startsWith(CHARACTER_PREFIX)) {
      throw new Error(
        `"${contentId.slice(CHARACTER_PREFIX.length)}" is a character, not a series. ` +
          `Open it from the home page to see the series they appear in.`,
      );
    }

    const { data } = await this.getJson<{ data: ApiSeriesDetail }>(
      `/api/series/${encodeURIComponent(contentId)}`,
    );

    const tags: Tag[] = [];
    if (data.publisher) {
      tags.push({
        id: `publisher:${data.publisher_slug ?? data.publisher}`,
        title: data.publisher,
        isNonInteractive: true,
      });
    }
    if (data.series_type) {
      tags.push({
        id: `type:${data.series_type}`,
        title: data.series_type,
        isNonInteractive: true,
      });
    }

    const people = data.characters ?? [];

    return {
      title: seriesTitle(data),
      cover: data.cover_url ?? "",
      summary: buildSummary(data),
      tags,
      contentType: ContentType.COMIC,
      contentRating: ContentRating.SAFE,
      status: data.end_year === null ? PublicationStatus.ONGOING : PublicationStatus.COMPLETED,
      additionalInfo: people.length
        ? [
            additionalInfo.characters.section({
              id: "characters",
              title: "Characters",
              hasMore: false,
              items: people.slice(0, 10).map((character) =>
                additionalInfo.characters.item({
                  id: character.slug,
                  title: character.name,
                  subtitle: character.role,
                }),
              ),
            }),
          ]
        : undefined,
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const issues: ApiIssue[] = [];

    for (let request = 0; request < MAX_CHAPTER_REQUESTS; request++) {
      const result = await this.getJson<ApiPage<ApiIssue>>(
        `/api/series/${encodeURIComponent(contentId)}/issues`,
        {
          order: "asc",
          limit: CHAPTER_FETCH_LIMIT,
          offset: request * CHAPTER_FETCH_LIMIT,
        },
      );

      issues.push(...result.data);
      if (!result.pagination.has_more) break;
    }

    return issues.map((issue, index) => ({
      chapterId: String(issue.id),
      number: issueNumber(issue.issue_number, index + 1),
      index,
      date: parseReleaseDate(issue.release_date) ?? new Date(0),
      language: DefinedLanguages.ENGLISH,
      title: chapterTitle(issue),
      thumbnail: issue.cover_url ?? undefined,
      provider: chapterProvider(issue),
    }));
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const base = await this.baseUrl();
    const { data } = await this.getJson<ApiPageManifest>(
      `/api/issues/${encodeURIComponent(chapterId)}/pages`,
      { mode: "proxy" },
    );

    if (data.source === "none" || data.pages.length === 0) {
      throw new Error(
        `No pages available for ${data.series.title} #${data.issue.issue_number}` +
          (data.reason ? ` — ${data.reason}.` : "."),
      );
    }

    return { pages: data.pages.map((entry) => ({ url: pageUrl(entry, base) })) };
  }

  private async listResults(listId: string, page: number): Promise<PagedSearchResult> {
    if (listId === ListID.Characters) return this.characterList(page);
    if (listId.startsWith(CHARACTER_PREFIX)) {
      return this.characterSeries(listId.slice(CHARACTER_PREFIX.length), page);
    }
    return this.seriesList(
      listId === ListID.RecentSeries ? SeriesSort.Recent : SeriesSort.Popular,
      page,
    );
  }

  private async seriesParams(page: number): Promise<QueryParams> {
    const allowlist = await this.publisherAllowlist();
    return {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      language: SERIES_LANGUAGE,
      publisher: allowlist.length > 0 ? allowlist.join(",") : undefined,
    };
  }

  private async seriesList(sort: string, page: number): Promise<PagedSearchResult> {
    const result = await this.getJson<ApiPage<ApiSeries>>("/api/series", {
      sort,
      ...(await this.seriesParams(page)),
    });
    return toPagedResult(result, result.data.map(seriesHighlight));
  }

  private async characterSeries(slug: string, page: number): Promise<PagedSearchResult> {
    const result = await this.getJson<ApiPage<ApiSeries>>(
      `/api/characters/${encodeURIComponent(slug)}/series`,
      await this.seriesParams(page),
    );
    return toPagedResult(result, result.data.map(seriesHighlight));
  }

  private async characterList(page: number): Promise<PagedSearchResult> {
    const result = await this.getJson<ApiPage<ApiCharacter>>("/api/characters", {
      sort: "popular",
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
    return toPagedResult(result, result.data.map(characterHighlight));
  }

  private async publisherOptions(): Promise<Option[]> {
    try {
      const result = await this.getJson<ApiPage<ApiPublisher>>("/api/publishers", {
        sort: "popular",
        limit: PUBLISHER_OPTIONS_LIMIT,
      });
      return result.data.map((publisher) => ({
        id: publisher.slug,
        title: publisher.series_count
          ? `${publisher.name} (${publisher.series_count})`
          : publisher.name,
      }));
    } catch {
      return [];
    }
  }
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function issueNumber(raw: string, fallback: number): number {
  const parsed = Number.parseFloat(raw.trim());
  return /^\d+(\.\d+)?$/.test(raw.trim()) && Number.isFinite(parsed) ? parsed : fallback;
}

function parseReleaseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
}

function joinParts(values: readonly (string | null | undefined)[]): string | undefined {
  const parts = values.map((value) => (value ?? "").trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function pageUrl(entry: ApiManifestPage, base: string): string {
  if (entry.data) return entry.data;

  const url = entry.url ?? "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return `${base.replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

function toPagedResult<T>(result: ApiPage<T>, items: Highlight[]): PagedSearchResult {
  return {
    results: items,
    isLastPage: !result.pagination.has_more,
    totalResultCount: result.pagination.total ?? undefined,
  };
}

function seriesTitle(series: ApiSeries): string {
  return series.volume > 1 ? `${series.title} (Vol. ${series.volume})` : series.title;
}

function seriesHighlight(series: ApiSeries): Highlight {
  return {
    id: series.slug,
    title: seriesTitle(series),
    cover: series.cover_url ?? "",
    subtitle: joinParts([
      series.publisher,
      formatYears(series),
      series.issue_count ? `${series.issue_count} issues` : "",
    ]),
    contentRating: ContentRating.SAFE,
  };
}

function characterHighlight(character: ApiCharacter): Highlight {
  return {
    id: `${CHARACTER_PREFIX}${character.slug}`,
    title: character.name,
    cover: character.image_url ?? "",
    subtitle: joinParts([
      character.real_name,
      character.publisher,
      character.appearance_count ? `${character.appearance_count} appearances` : "",
    ]),
    contentRating: ContentRating.SAFE,
    link: { request: { page: 1, listId: `${CHARACTER_PREFIX}${character.slug}` } },
  };
}

function formatYears(series: ApiSeries): string {
  if (!series.start_year) return "";
  if (series.end_year === null) return `${series.start_year}–`;
  if (series.end_year === series.start_year) return String(series.start_year);
  return `${series.start_year}–${series.end_year}`;
}

function buildSummary(series: ApiSeriesDetail): string {
  const facts = [
    series.publisher ? `Publisher: ${series.publisher}` : "",
    formatYears(series) ? `Published: ${formatYears(series)}` : "",
    series.issue_count ? `Issues: ${series.issue_count}` : "",
  ].filter(Boolean);

  const description = (series.description ?? "").replace(/\s+/g, " ").trim();
  return [description, facts.join("\n")].filter(Boolean).join("\n\n");
}

function chapterTitle(issue: ApiIssue): string {
  const label = `#${issue.issue_number}`;
  return issue.title ? `${label} — ${issue.title}` : label;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  getcomics: "GetComics",
};

function chapterProvider(issue: ApiIssue): Provider | undefined {
  if (!issue.provider) return undefined;
  const name =
    PROVIDER_DISPLAY_NAMES[issue.provider] ??
    issue.provider.charAt(0).toUpperCase() + issue.provider.slice(1);
  return { id: issue.provider, name };
}

export class Target extends KakarotComicsSource {}
