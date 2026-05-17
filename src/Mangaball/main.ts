import { load } from "cheerio";
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
  type Tag,
  type PageLinkResolver,
  type PageLink,
  type PageSection,
  type ResolvedPageSection,
  SectionStyle,
} from "@mana-app/types";

import {
  FILTERS,
  FilterID,
  SORT_OPTIONS,
  type APIItem,
  type SearchAPIResponse,
  type ChapterApiResponse,
} from "./model.ts";
import { BASE_URL, buildClient, setCookie } from "./network.ts";

const CSRF_STORE_KEY = "mangaball.csrf";

const info: SourceInfo = {
  id: "mangaball",
  name: "Mangaball",
  version: "1.0.2",
  description: "Pulls content from mangaball.net",
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
  owningLinks: ["mangaball.net"],
  requiresAuthenticationToAccessContent: false,
};

class MangaballSource implements ContentSource, SearchProvider, PageLinkResolver {
  readonly info = info;
  readonly config = config;

  private client!: NetworkClient;
  private csrfToken: string = "";

  async onEnvironmentLoaded(): Promise<void> {
    this.client = buildClient();
    const cached = await ObjectStore.string(CSRF_STORE_KEY);
    if (cached) this.csrfToken = cached;
    await this.refreshCsrf();
  }

  async getSearchFilters(): Promise<SearchFilter[]> {
    return FILTERS;
  }

  async getSortOptions(): Promise<SortOption[]> {
    return SORT_OPTIONS.map((s, i) => ({
      id: s.id,
      title: s.title,
      isDefault: i === 0,
      isOrderable: false,
    }));
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    if (request.listId) {
      return this.getViewMoreItems(request);
    }

    const page = request.page > 0 ? request.page : 1;
    const filters = (request.filters ?? {}) as Record<string, unknown>;

    const tagFilter = filters[FilterID.Tags] as
      | { included?: string[]; excluded?: string[] }
      | undefined;
    const tagIncluded = tagFilter?.included ?? [];
    const tagExcluded = tagFilter?.excluded ?? [];
    const demographic = (filters[FilterID.Demographic] as string) || "any";
    const status = (filters[FilterID.Status] as string) || "any";
    const originalLanguages = (filters[FilterID.OriginalLanguage] as string[]) ?? [];
    const nsfw = (filters[FilterID.AdultContent] as boolean) ?? false;

    const sort = request.sort?.id ?? "updated_chapters_desc";
    const searchInput = request.query?.trim() ?? "";

    if (nsfw) await setCookie("show18PlusContent", "true");

    await this.refreshCsrf();

    const formFilters: Record<string, string | number> = {
      sort,
      tag_included_mode: "and",
      tag_excluded_mode: "and",
      contentRating: "any",
      demographic,
      publicationStatus: status,
      userSettingsEnabled: "false",
      page,
    };
    if (originalLanguages.length > 0) {
      formFilters.originalLanguages = originalLanguages.join(",");
    }

    const bodyParts: string[] = [`search_input=${encodeURIComponent(searchInput)}`];
    for (const [k, v] of Object.entries(formFilters)) {
      bodyParts.push(`${encodeURIComponent(`filters[${k}]`)}=${encodeURIComponent(String(v))}`);
    }
    for (const id of tagIncluded) {
      bodyParts.push(
        `${encodeURIComponent("filters[tag_included_ids][]")}=${encodeURIComponent(id)}`,
      );
    }
    for (const id of tagExcluded) {
      bodyParts.push(
        `${encodeURIComponent("filters[tag_excluded_ids][]")}=${encodeURIComponent(id)}`,
      );
    }

    const url = `${BASE_URL}/api/v1/title/search-advanced`;
    const response = await this.client.request({
      url,
      method: "POST",
      headers: this.apiHeaders(),
      body: bodyParts.join("&"),
    });

    const json = JSON.parse(response.data) as SearchAPIResponse;
    const results: Highlight[] = (json.data ?? []).map((raw) => toHighlight(raw));

    const isLastPage = json.pagination
      ? json.pagination.current_page >= json.pagination.last_page
      : results.length === 0;

    return {
      results,
      isLastPage,
      totalResultCount: json.pagination?.total,
    };
  }

  async getContent(contentId: string): Promise<Content> {
    const url = `${BASE_URL}/title-detail/${contentId}`;
    const response = await this.client.get(url);
    const $ = load(response.data);

    const title =
      $("h6").first().text().trim() || $('meta[property="og:title"]').attr("content") || "";

    const coverEl = $("img.featured-cover").first();
    const cover =
      coverEl.attr("data-src") ||
      coverEl.attr("src") ||
      $('meta[property="og:image"]').attr("content") ||
      "";

    const summary = $(".description-text").first().text().trim();

    const additionalTitles: string[] = [];
    $(".alternate-name-container span").each((_, el) => {
      const t = $(el).text().trim();
      if (t) additionalTitles.push(t);
    });

    const tags: Tag[] = [];
    $("span.badge[data-tag-id]").each((_, el) => {
      const id = $(el).attr("data-tag-id")!;
      const title = $(el).text().trim();
      if (id && title) tags.push({ id, title });
    });

    const statusText = $("span.badge[class*='bg-success'], span.badge[class*='bg-danger']")
      .first()
      .text()
      .trim();
    const status = mapStatus(statusText);

    const isNSFW = /show18PlusContent|18\+|adult/i.test(response.data);

    return {
      title,
      cover: absoluteUrl(cover),
      summary: summary.replace(/\s+/g, " ").trim(),
      additionalTitles,
      tags,
      contentType: ContentType.MANGA,
      status,
      isNSFW,
      webUrl: url,
    };
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const match = contentId.match(/([a-f0-9]{24})$/);
    const titleId = match ? match[1] : contentId;

    await this.refreshCsrf();

    const url = `${BASE_URL}/api/v1/chapter/chapter-listing-by-title-id`;
    const response = await this.client.request({
      url,
      method: "POST",
      headers: this.apiHeaders({
        referer: `${BASE_URL}/title-detail/${contentId}/`,
      }),
      body: `title_id=${encodeURIComponent(titleId)}`,
    });

    const json = JSON.parse(response.data) as ChapterApiResponse;
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const all = json.ALL_CHAPTERS ?? [];

    let index = 0;
    for (const ch of all) {
      for (const t of ch.translations ?? []) {
        const language = (t.language || t.languageName || "").trim();
        const key = `${t.id}:${language.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        chapters.push({
          chapterId: t.id,
          number: ch.number_float || Number(ch.number) || 0,
          index: index++,
          date: t.date ? new Date(t.date) : new Date(0),
          volume: t.volume,
          language: language || DefinedLanguages.UNIVERSAL,
          title: t.name || ch.title || `Chapter ${ch.number}`,
          webUrl: `${BASE_URL}/chapter-detail/${t.id}`,
        });
      }
    }

    return chapters;
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const url = `${BASE_URL}/chapter-detail/${chapterId}`;
    const response = await this.client.get(url);
    const $ = load(response.data);

    const pages: ChapterPage[] = [];
    const scriptContent = $("script")
      .toArray()
      .map((el) => $(el).html() ?? "")
      .find((s) => s.includes("chapterImages"));

    if (scriptContent) {
      const match = scriptContent.match(/const\s+chapterImages\s*=\s*JSON\.parse\(`([\s\S]+?)`\)/);
      if (match) {
        try {
          const images = JSON.parse(match[1]);
          if (Array.isArray(images)) {
            for (const src of images) {
              if (typeof src === "string" && src.length > 0) {
                pages.push({ url: absoluteUrl(src) });
              }
            }
          }
        } catch {
          throw new Error("Failed to parse chapter images");
        }
      }
    }

    return { pages };
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return [
      { id: "latest", title: "Latest Updates", style: SectionStyle.SimpleSingleRow, viewMoreLink: { request: { page: 1, listId: "latest" } } },
      { id: "popular", title: "Most Popular",  style: SectionStyle.SimpleSingleRow, viewMoreLink: { request: { page: 1, listId: "popular" } } },
      { id: "new",    title: "New Titles",     style: SectionStyle.SimpleSingleRow, viewMoreLink: { request: { page: 1, listId: "new" } } },
    ];
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const sortMap: Record<string, string> = {
      latest: "updated_chapters_desc",
      popular: "views_desc",
      new: "created_at_desc",
    };
    const sort = sortMap[sectionID] ?? "updated_chapters_desc";

    const response = await this.client.request({
      url: `${BASE_URL}/api/v1/title/search-advanced`,
      method: "POST",
      headers: this.apiHeaders(),
      body: this.buildSectionBody(sort, 1),
    });

    if (response.status !== 200) {
      throw new Error(`Failed to load section ${sectionID}`);
    }

    const json = JSON.parse(response.data) as SearchAPIResponse;
    const items: Highlight[] = (json.data ?? []).map((raw) => toHighlight(raw));

    return { items };
  }

  private async getViewMoreItems(request: SearchRequest): Promise<PagedSearchResult> {
    const sortMap: Record<string, string> = {
      latest: "updated_chapters_desc",
      popular: "views_desc",
      new: "created_at_desc",
    };
    const sort = sortMap[request.listId ?? ""] ?? "updated_chapters_desc";
    const page = request.page > 0 ? request.page : 1;

    await this.refreshCsrf();

    const response = await this.client.request({
      url: `${BASE_URL}/api/v1/title/search-advanced`,
      method: "POST",
      headers: this.apiHeaders(),
      body: this.buildSectionBody(sort, page),
    });

    const json = JSON.parse(response.data) as SearchAPIResponse;
    const results: Highlight[] = (json.data ?? []).map((raw) => toHighlight(raw));
    const isLastPage = json.pagination
      ? json.pagination.current_page >= json.pagination.last_page
      : results.length === 0;

    return { results, isLastPage, totalResultCount: json.pagination?.total };
  }

  private buildSectionBody(sort: string, page: number): string {
    return [
      `search_input=`,
      `${encodeURIComponent("filters[sort]")}=${encodeURIComponent(sort)}`,
      `${encodeURIComponent("filters[page]")}=${encodeURIComponent(String(page))}`,
      `${encodeURIComponent("filters[contentRating]")}=any`,
      `${encodeURIComponent("filters[demographic]")}=any`,
      `${encodeURIComponent("filters[publicationStatus]")}=any`,
      `${encodeURIComponent("filters[userSettingsEnabled]")}=false`,
      `${encodeURIComponent("filters[tag_included_mode]")}=and`,
      `${encodeURIComponent("filters[tag_excluded_mode]")}=and`,
    ].join("&");
  }

  private apiHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      referer: `${BASE_URL}/search-advanced/`,
    };
    if (this.csrfToken) {
      headers["x-csrf-token"] = this.csrfToken;
      headers["x-xsrf-token"] = this.csrfToken;
    }
    if (extra) Object.assign(headers, extra);
    return headers;
  }

  private async refreshCsrf(): Promise<void> {
    try {
      const response = await this.client.get(BASE_URL);
      const $ = load(response.data);

      const meta = $('meta[name="csrf-token"]').attr("content");
      if (meta) {
        this.csrfToken = meta.trim();
        await ObjectStore.set(CSRF_STORE_KEY, this.csrfToken);
        return;
      }

      const script = $("script")
        .toArray()
        .map((el) => $(el).html() ?? "")
        .find((s) => /csrfToken\s*[:=]/i.test(s));
      if (script) {
        const m = script.match(/csrfToken\s*[:=]\s*["']([^"']+)["']/i);
        if (m) {
          this.csrfToken = m[1].trim();
          await ObjectStore.set(CSRF_STORE_KEY, this.csrfToken);
          return;
        }
      }

      const xsrfToken =
        (await ObjectStore.string("mangaball.xsrf-token")) ??
        (await ObjectStore.string(CSRF_STORE_KEY));
      if (xsrfToken) {
        try {
          this.csrfToken = decodeURIComponent(xsrfToken);
        } catch {
          this.csrfToken = xsrfToken;
        }
        await ObjectStore.set(CSRF_STORE_KEY, this.csrfToken);
      }
    } catch (err) {
      console.log("[Mangaball] Failed to refresh CSRF:", err);
    }
  }
}

function toHighlight(raw: APIItem): Highlight {
  const id = deriveMangaId(raw.url);
  const title = String(raw.name ?? "").trim();
  const cover = absoluteUrl(String(raw.cover || raw.background || ""));

  const altText = load(String(raw.alternateName ?? ""))
    .text()
    .trim();

  const $tags = load(String(raw.tags ?? ""));
  const tagBadges: string[] = [];
  $tags("[data-tag-id]").each((_, el) => {
    const t = $tags(el).text().trim();
    if (t) tagBadges.push(t);
  });

  const chapterText = load(String(raw.last_chapter ?? ""))
    .text()
    .trim();
  const updated = toRelativeTime(String(raw.updated_at ?? ""));
  const subtitle = chapterText ? `${chapterText} | ${updated}` : updated || undefined;

  const info: Record<string, string> = {};
  if (altText) info.alt = altText;
  if (tagBadges.length) info.tags = tagBadges.join(", ");

  return {
    id,
    title,
    cover,
    subtitle,
    info: Object.keys(info).length ? info : undefined,
    webUrl: absoluteUrl(raw.url),
  };
}

function deriveMangaId(url: string): string {
  if (!url) return "";
  const m = url.match(/\/title-detail\/([^/?#]+)/);
  if (m) return m[1];
  const segments = url.split("/").filter(Boolean);
  return segments.pop()?.split(/[?#]/)[0] ?? url;
}

function absoluteUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return url.startsWith("/") ? `${BASE_URL}${url}` : `${BASE_URL}/${url}`;
}

function mapStatus(text: string): PublicationStatus | undefined {
  const t = text.toLowerCase();
  if (!t) return undefined;
  if (t.includes("ongoing")) return PublicationStatus.ONGOING;
  if (t.includes("complete")) return PublicationStatus.COMPLETED;
  if (t.includes("hiatus")) return PublicationStatus.HIATUS;
  if (t.includes("cancel")) return PublicationStatus.CANCELLED;
  return undefined;
}

function toRelativeTime(dateText: string): string {
  if (!dateText || !dateText.trim()) return "";
  const trimmed = dateText.trim();
  let date: Date | undefined;

  if (/^\d{10,13}$/.test(trimmed)) {
    const n = Number(trimmed);
    date = trimmed.length === 13 ? new Date(n) : new Date(n * 1000);
  } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
    if (m) {
      date = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6]),
      );
    }
  } else if (!isNaN(Date.parse(trimmed))) {
    date = new Date(trimmed);
  }

  if (!date || isNaN(date.getTime())) return trimmed;

  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) {
    const v = Math.floor(diff / 60);
    return `${v} minute${v === 1 ? "" : "s"} ago`;
  }
  if (diff < 86400) {
    const v = Math.floor(diff / 3600);
    return `${v} hour${v === 1 ? "" : "s"} ago`;
  }
  if (diff < 2592000) {
    const v = Math.floor(diff / 86400);
    return `${v} day${v === 1 ? "" : "s"} ago`;
  }
  if (diff < 31536000) {
    const v = Math.floor(diff / 2592000);
    return `${v} month${v === 1 ? "" : "s"} ago`;
  }
  const v = Math.floor(diff / 31536000);
  return `${v} year${v === 1 ? "" : "s"} ago`;
}

export class Target extends MangaballSource {}
