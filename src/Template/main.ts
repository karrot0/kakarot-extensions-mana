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
  type Highlight,
  SearchProvider,
  SortOption,
} from "@mana-app/types";

import { FILTERS } from "./model.ts";
import { buildClient } from "./network.ts";

const info: SourceInfo = {
  id: "template",
  name: "Template",
  version: "1.0.0",
  description: "template source for mana",
  website: "",
  rating: CatalogRating.SAFE,
  supportedLanguages: [DefinedLanguages.ENGLISH],
  thumbnail: "icon.png",
};

const config: SourceConfig = {
  disableTagNavigation: false,
  disableUpdateChecks: false,
  allowsMultipleInstances: false,
  requiresAuthenticationToAccessContent: false,
};

class TemplateSource implements ContentSource, SearchProvider {
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
      {
        isDefault: true,
        isOrderable: true,
        id: "Title",
        title: "title",
      },
    ];
  }

  async search(_request: SearchRequest): Promise<PagedSearchResult> {
    // Search Implementation
    const results: Highlight[] = [];

    return {
      results: results,
      isLastPage: true,
      totalResultCount: 0,
    };
  }

  async getContent(_contentId: string): Promise<Content> {
    return {
      title: "", // required
      cover: "", // required
      summary: "",
      contentType: ContentType.MANGA,
      status: PublicationStatus.ONGOING,
      isNSFW: false,
      webUrl: "",
    };
  }

  async getChapters(_contentId: string): Promise<Chapter[]> {
    // Function to get chapters

    const chapters: Chapter[] = [];

    return chapters;
  }

  async getChapterData(
    _contentId: string,
    _chapterId: string,
    _chapter?: Chapter,
  ): Promise<ChapterData> {
    // Function to get chapter pages

    const pages: ChapterPage[] = [];
    return { pages };
  }
}

export class Target extends TemplateSource {}
