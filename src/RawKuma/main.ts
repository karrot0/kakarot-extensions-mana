import {
  Body,
  CatalogRating,
  ContentRating,
  ContentType,
  DefinedLanguages,
  SectionStyle,
  SearchMultiPicker,
  type Chapter,
  type ChapterData,
  type ChapterPage,
  type ChapterSource,
  type Content,
  type Highlight,
  type Option,
  type PagedSearchResult,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SortOption,
  type SourceConfig,
  type SourceInfo,
  type Tag,
} from "@mana-app/types";
import { load, type CheerioAPI } from "cheerio";

import type { ClientOptions } from "../../lib/client.ts";
import {
  FilterReader,
  buildSearchForm,
  pageOf,
  resolveSortId,
  withQuery,
  type SectionSpec,
} from "../../lib/forms/index.ts";
import {
  absolute as absoluteFrom,
  chapterNumber,
  fetchHtml,
  imageSrc,
  ownText,
  parseDate,
  parseStatus,
  slug,
} from "../../lib/html.ts";
import { normalize } from "../../lib/text.ts";
import { BaseSource } from "../../lib/source.ts";
import {
  ADULT_GENRE,
  BASE_URL,
  FilterID,
  ListID,
  SORT_OPTIONS,
  SortID,
  STATUS_FIELD,
  TYPE_FIELD,
  type WpManga,
  type WpTerm,
} from "./model.ts";

const info: SourceInfo = {
  id: "rawkuma",
  name: "RawKuma",
  version: "1.0.0",
  description: "Pulls raw manga from rawkuma.net",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.JAPANESE],
  thumbnail: "RawKuma.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  owningLinks: ["rawkuma.net", "www.rawkuma.net"],
};

type SearchParams = {
  query?: string;
  page: number;
  sort: string;
  genres?: readonly string[];
  types?: readonly string[];
  statuses?: readonly string[];
};

class RawKumaSource extends BaseSource implements ChapterSource, SearchProvider {
  readonly info = info;
  readonly config = config;

  private nonce: string | undefined;

  protected clientOptions(): ClientOptions {
    return { baseUrl: BASE_URL, requests: 4, intervalMs: 1_000 };
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: ListID.Latest,
        title: "Latest Updates",
        style: SectionStyle.SimpleSingleRow,
        load: (page) => this.advancedSearch({ page, sort: SortID.Updated }),
      },
      {
        id: ListID.Popular,
        title: "Popular",
        style: SectionStyle.SimpleSingleRow,
        load: (page) => this.advancedSearch({ page, sort: SortID.Popular }),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    const genres = await this.genreOptions();
    return buildSearchForm({
      header: "Filters",
      fields: [TYPE_FIELD, STATUS_FIELD],
      tags:
        genres.length > 0
          ? SearchMultiPicker({ id: FilterID.Genre, title: "Genre", options: genres })
          : undefined,
      tagsHeader: "Genre",
    });
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS;
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;

    const filters = new FilterReader(request);
    return this.advancedSearch({
      query: request.query ?? "",
      page: pageOf(request),
      sort: resolveSortId(SORT_OPTIONS, request, SortID.Updated),
      genres: filters.options(FilterID.Genre),
      types: filters.options(FilterID.Type),
      statuses: filters.options(FilterID.Status),
    });
  }

  async getContent(contentId: string): Promise<Content> {
    return parseContent(await this.mangaBySlug(contentId));
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const manga = await this.mangaBySlug(contentId);
    const response = await this.http.get(chapterListUrl(manga.id));
    return parseChapters(load(await response.requireOk().text()), contentId);
  }

  async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
    const pages = parsePages(await fetchHtml(this.http, chapterUrl(contentId, chapterId)));
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapterId} of "${contentId}"`);
    }
    return { pages };
  }

  private async genreOptions(): Promise<Option[]> {
    try {
      const terms = await this.getJson<WpTerm[]>("/wp-json/wp/v2/genre", {
        per_page: 100,
        page: 1,
        orderby: "count",
        order: "desc",
      });
      return terms.map((term) => ({ id: term.slug, title: term.name }));
    } catch {
      return [];
    }
  }

  private async searchNonce(): Promise<string> {
    this.nonce ??= await this.fetchNonce();
    return this.nonce;
  }

  private async fetchNonce(): Promise<string> {
    const $ = await fetchHtml(this.http, `${BASE_URL}/wp-admin/admin-ajax.php`, {
      type: "search_form",
      action: "get_nonce",
    });
    const nonce = $("input[name='search_nonce']").first().attr("value") ?? "";
    if (!nonce) throw new Error("Unable to get the search nonce");
    return nonce;
  }

  private async advancedSearch({
    query = "",
    page,
    sort,
    genres = [],
    types = [],
    statuses = [],
  }: SearchParams): Promise<PagedSearchResult> {
    const response = await this.http.post(
      `${BASE_URL}/wp-admin/admin-ajax.php?action=advanced_search`,
      Body.form({
        nonce: await this.searchNonce(),
        inclusion: "OR",
        exclusion: "OR",
        page,
        genre: JSON.stringify(genres),
        genre_exclude: "[]",
        author: "[]",
        artist: "[]",
        project: "0",
        type: JSON.stringify(types),
        status: JSON.stringify(statuses),
        order: "desc",
        orderby: sort,
        query: query.trim(),
      }),
    );
    const $ = load(await response.requireOk().text());
    const slugs = slugsFrom($);
    const isLastPage = $("button:has(svg)").length === 0;
    if (slugs.length === 0) return { results: [], isLastPage: true };

    const mangas = await this.mangasBySlugs(slugs);
    return { results: mangas.map(highlightFrom), isLastPage };
  }

  private async mangasBySlugs(slugs: readonly string[]): Promise<WpManga[]> {
    const query = [
      ...slugs.map((value) => `slug[]=${encodeURIComponent(value)}`),
      `per_page=${slugs.length + 1}`,
      "_embed",
    ].join("&");
    const response = await this.http.get(`${BASE_URL}/wp-json/wp/v2/manga?${query}`);
    const mangas = await response.requireOk().json<WpManga[]>();

    return slugs.flatMap((value) => {
      const manga = mangas.find((item) => item.slug === value);
      return manga && !isNovel(manga) ? [manga] : [];
    });
  }

  private async mangaBySlug(value: string): Promise<WpManga> {
    const response = await this.http.get(
      `${BASE_URL}/wp-json/wp/v2/manga?slug[]=${encodeURIComponent(value)}&_embed`,
    );
    const [manga] = await response.requireOk().json<WpManga[]>();
    if (!manga) throw new Error(`"${value}" was not found`);
    if (isNovel(manga)) throw new Error("Novels are not supported");
    return manga;
  }
}

function contentUrl(contentId: string): string {
  return `${BASE_URL}/manga/${encodeURIComponent(contentId)}/`;
}

function chapterUrl(contentId: string, chapterId: string): string {
  return `${contentUrl(contentId)}${encodeURIComponent(chapterId)}/`;
}

function chapterListUrl(mangaId: number): string {
  return withQuery(`${BASE_URL}/wp-admin/admin-ajax.php`, {
    manga_id: mangaId,
    // Pages above 3 include the hidden chapters. The random value keeps a
    // cached response from serving a stale chapter list.
    page: 99 + Math.floor(Math.random() * 9_900),
    action: "chapter_list",
  });
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeText(raw: string): string {
  return normalize(load(raw).text());
}

function slugsFrom($: CheerioAPI): string[] {
  const slugs: string[] = [];
  for (const element of $("div > a[href*='/manga/']:has(> img)").toArray()) {
    const value = /\/manga\/([^/?#]+)/.exec($(element).attr("href") ?? "")?.[1];
    if (value) slugs.push(decode(value));
  }
  return slugs;
}

function termNames(manga: WpManga, taxonomy: string): string[] {
  const terms = manga._embedded["wp:term"]?.flat() ?? [];
  return terms.filter((term) => term.taxonomy === taxonomy).map((term) => term.name);
}

function isNovel(manga: WpManga): boolean {
  return termNames(manga, "type").includes("Novel");
}

function featuredImage(manga: WpManga): string {
  return absoluteFrom(manga._embedded["wp:featuredmedia"]?.[0]?.source_url ?? "", BASE_URL);
}

function ratingOf(manga: WpManga): ContentRating {
  return ADULT_GENRE.test(termNames(manga, "genre").join(" "))
    ? ContentRating.MATURE
    : ContentRating.SAFE;
}

function highlightFrom(manga: WpManga): Highlight {
  return {
    id: manga.slug,
    title: decodeText(manga.title.rendered),
    cover: featuredImage(manga),
    contentRating: ratingOf(manga),
    webUrl: contentUrl(manga.slug),
  };
}

function parseContent(manga: WpManga): Content {
  const title = decodeText(manga.title.rendered);
  const alternatives = (manga.meta?.meta?.alternative_title ?? "")
    .split(",")
    .map((value) => decodeText(value))
    .filter((value) => value && value.toLowerCase() !== title.toLowerCase());
  const names = [...new Set([...termNames(manga, "genre"), ...termNames(manga, "type")])];
  const tags: Tag[] = names.map((name) => ({ id: slug(name), title: name }));

  return {
    title,
    cover: featuredImage(manga),
    summary: normalize(load(manga.content.rendered).text()),
    additionalTitles: alternatives.length > 0 ? [...new Set(alternatives)] : undefined,
    tags,
    contentType: ContentType.COMIC,
    contentRating: ratingOf(manga),
    status: parseStatus(termNames(manga, "status").join(" ")),
    webUrl: contentUrl(manga.slug),
  };
}

function chapterIdFrom(href: string | undefined): string {
  return decode(/\/manga\/[^/]+\/([^/?#]+)/.exec(href ?? "")?.[1] ?? "");
}

function parseChapters($: CheerioAPI, contentId: string): Chapter[] {
  const chapters: Chapter[] = [];

  for (const element of $("div a:has(time)").toArray()) {
    const link = $(element);
    const chapterId = chapterIdFrom(link.attr("href"));
    if (!chapterId) continue;

    const title = normalize(ownText(link.find("span").first()));
    chapters.push({
      chapterId,
      number: chapterNumber(title, chapters.length + 1),
      index: chapters.length,
      date: parseDate(link.find("time").first().attr("datetime") ?? "") ?? new Date(0),
      language: DefinedLanguages.JAPANESE,
      title,
      webUrl: chapterUrl(contentId, chapterId),
    });
  }

  return chapters;
}

function parsePages($: CheerioAPI): ChapterPage[] {
  const pages: ChapterPage[] = [];
  for (const element of $("section[data-image-data] img").toArray()) {
    const url = absoluteFrom(imageSrc($(element)), BASE_URL);
    if (url) pages.push({ url });
  }
  return pages;
}

export class Target extends RawKumaSource {}
