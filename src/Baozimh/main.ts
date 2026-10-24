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
  type CoverRequestHandler,
  type Highlight,
  type HttpClient,
  type PageRequestHandler,
  type PagedSearchResult,
  type SearchForm,
  type SearchProvider,
  type SearchRequest,
  type SourceConfig,
  type SourceInfo,
  type Tag,
} from "@mana-app/types";
import { type CheerioAPI } from "cheerio";

import { IMAGE_ACCEPT, type ClientOptions } from "../../lib/client.ts";
import {
  FilterReader,
  buildSearchForm,
  pageOf,
  withQuery,
  type QueryParams,
  type SectionSpec,
} from "../../lib/forms/index.ts";
import {
  absolute as absoluteFrom,
  fetchHtml,
  imageSrc,
  ownText,
  parseDate,
  text,
} from "../../lib/html.ts";
import { BaseSource } from "../../lib/source.ts";
import {
  API_URL,
  BASE_URL,
  FilterID,
  GENRE_FIELD,
  IMAGE_CDN,
  IMAGE_CDN_ALT,
  ListID,
  USER_AGENT,
  type ChapterResponse,
  type DecodedImage,
  type MangaResponse,
} from "./model.ts";

const info: SourceInfo = {
  id: "baozimh",
  name: "Baozimh",
  version: "1.0.0",
  description: "Pulls manhua from baozimh.org (包子漫画)",
  website: BASE_URL,
  rating: CatalogRating.MIXED,
  supportedLanguages: [DefinedLanguages.CHINESE],
  thumbnail: "Baozimh.png",
  developers: [{ name: "Karrot" }],
};

const config: SourceConfig = {
  disableUpdateChecks: false,
  owningLinks: ["baozimh.org", "www.baozimh.org"],
};

class BaozimhSource
  extends BaseSource
  implements ChapterSource, SearchProvider, CoverRequestHandler, PageRequestHandler
{
  readonly info = info;
  readonly config = config;

  protected clientOptions(): ClientOptions {
    return {
      baseUrl: BASE_URL,
      requests: 4,
      intervalMs: 1_000,
      headers: { "user-agent": USER_AGENT },
      imageHeaders: { accept: IMAGE_ACCEPT, "user-agent": USER_AGENT },
    };
  }

  protected sections(): SectionSpec[] {
    return [
      {
        id: ListID.Latest,
        title: "热门更新",
        style: SectionStyle.SimpleSingleRow,
        viewMore: false,
        load: () => this.listing(`${BASE_URL}/dayup`),
      },
      {
        id: ListID.Popular,
        title: "人气推荐",
        style: SectionStyle.SimpleSingleRow,
        viewMore: false,
        load: () => this.listing(`${BASE_URL}/hots`),
      },
      {
        id: ListID.Newest,
        title: "最新上架",
        style: SectionStyle.SimpleSingleRow,
        viewMore: false,
        load: () => this.listing(`${BASE_URL}/newss`),
      },
    ];
  }

  async getSearchForm(): Promise<SearchForm> {
    return buildSearchForm({
      header: "Filters",
      fields: [GENRE_FIELD],
      includeSort: false,
    });
  }

  async search(request: SearchRequest): Promise<PagedSearchResult> {
    const list = this.listResults(request);
    if (list) return list;

    const query = request.query?.trim() ?? "";
    const genre = new FilterReader(request).option(FilterID.Genre, "");

    if (query) return this.searchPage(query, pageOf(request));
    if (genre) return this.listing(`${BASE_URL}/manga-genre/${genre}`);
    return this.listing(`${BASE_URL}/manga`);
  }

  async getContent(contentId: string): Promise<Content> {
    return parseContent(await fetchHtml(this.http, contentUrl(contentId)), contentId);
  }

  async getChapters(contentId: string): Promise<Chapter[]> {
    const $ = await fetchHtml(this.http, contentUrl(contentId));
    const mid = $("#mangachapters").attr("data-mid") ?? $("#allchapters").attr("data-mid");
    if (!mid) throw new Error(`No manga id found for "${contentId}"`);

    const json = await this.apiGet<MangaResponse>("/api/manga/get", { mid, mode: "all" });
    return parseChapters(json, contentId, mid);
  }

  async getChapterData(_contentId: string, chapterId: string): Promise<ChapterData> {
    const [mid, cid] = chapterId.split(":");
    if (!mid || !cid) throw new Error(`Malformed chapter id "${chapterId}"`);

    const json = await this.apiGet<ChapterResponse>("/api/v2/chapter/getinfo", {
      m: mid,
      c: cid,
    });
    const pages = parsePages(json);
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${cid}`);
    }
    return { pages };
  }

  getCoverTransport(): HttpClient {
    return this.imageHttp;
  }

  getPageTransport(): HttpClient {
    return this.imageHttp;
  }

  private async apiGet<T>(path: string, params: QueryParams): Promise<T> {
    const response = await this.http.get(withQuery(`${API_URL}${path}`, params));
    response.requireOk();
    try {
      return await response.json<T>();
    } catch {
      throw new Error(`${API_URL} did not return JSON for ${path}`);
    }
  }

  private async listing(url: string): Promise<PagedSearchResult> {
    const $ = await fetchHtml(this.http, url);
    return { results: parseCards($), isLastPage: true };
  }

  private async searchPage(query: string, page: number): Promise<PagedSearchResult> {
    const $ = await fetchHtml(this.http, `${BASE_URL}/s`, { q: query, page });
    return { results: parseCards($), isLastPage: isLastPage($) };
  }
}

function absolute(raw: string): string {
  return absoluteFrom(raw, BASE_URL);
}

function contentUrl(contentId: string): string {
  return `${BASE_URL}/manga/${encodeURIComponent(contentId)}`;
}

function slugFrom(href: string | undefined): string {
  return decode(/\/manga\/([^/?#]+)/.exec(href ?? "")?.[1] ?? "");
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isLastPage($: CheerioAPI): boolean {
  return $("a[aria-label='下一頁']").length === 0;
}

function statusFrom(raw: string): PublicationStatus | undefined {
  if (raw.includes("連載") || raw.includes("连载")) return PublicationStatus.ONGOING;
  if (raw.includes("完結") || raw.includes("完结")) return PublicationStatus.COMPLETED;
  return undefined;
}

function parseCards($: CheerioAPI): Highlight[] {
  const results: Highlight[] = [];
  for (const element of $(".cardlist a[href*='/manga/']").toArray()) {
    const link = $(element);
    const id = slugFrom(link.attr("href"));
    const title = text(link.find(".cardtitle").first());
    if (!id || !title) continue;

    results.push({
      id,
      title,
      cover: absolute(imageSrc(link.find("img.card").first())),
      contentRating: ContentRating.SAFE,
      webUrl: contentUrl(id),
    });
  }
  return results;
}

function parseContent($: CheerioAPI, contentId: string): Content {
  const detail = $("#info");
  const title = ownText(detail.find("h1").first()) || contentId;
  const status = statusFrom(text(detail.find("h1 span").first()));

  const tags: Tag[] = detail
    .find("a[href*='/manga-tag/']")
    .toArray()
    .map((element) => {
      const value = text($(element));
      return { id: value, title: value };
    })
    .filter((tag) => tag.title);

  return {
    title,
    cover: absolute(imageSrc($("#MangaCard img").first())),
    summary: text(detail.find("p").first()),
    tags,
    contentType: ContentType.COMIC,
    contentRating: ContentRating.SAFE,
    status,
    webUrl: contentUrl(contentId),
  };
}

function parseChapters(json: MangaResponse, contentId: string, mid: string): Chapter[] {
  const raw = json.data?.chapters ?? [];
  return raw.map((chapter, index) => ({
    chapterId: `${mid}:${chapter.id}`,
    number: chapter.attributes.order,
    index,
    date: parseDate(chapter.attributes.updatedAt) ?? new Date(0),
    language: DefinedLanguages.CHINESE,
    title: chapter.attributes.title,
    webUrl: `${contentUrl(contentId)}/${chapter.attributes.slug}`,
  }));
}

function parsePages(json: ChapterResponse): ChapterPage[] {
  const images = json.data?.info?.images;
  if (!images) return [];
  const line = images.line === 2 ? IMAGE_CDN_ALT : IMAGE_CDN;
  return decodeImages(images.images).map((image) => ({ url: `${line}${image.url}` }));
}

// The chapter API returns the page list as an obfuscated string. It decodes in
// three steps: split and reorder around two markers, reverse every other
// 7-character chunk, and translate a shuffled alphabet back to base64url.
const IMG_PREFIX = "J7r";
const IMG_SUFFIX = "nQ";
const IMG_MARKER = "kD";
const IMG_MARKER2 = "W4s";
const IMG_CHUNK = 7;
const IMG_ALPHABET_A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const IMG_ALPHABET_B = "_-9876543210abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function decodeImages(encoded: string): DecodedImage[] {
  if (!encoded.startsWith(IMG_PREFIX) || !encoded.endsWith(IMG_SUFFIX)) return [];

  const body = encoded.slice(IMG_PREFIX.length, -IMG_SUFFIX.length);
  const total = body.length - IMG_MARKER.length - IMG_MARKER2.length;
  if (total < 0) return [];

  const a = Math.floor(total / 3);
  const b = Math.floor((total - a) / 2);
  const c = total - a - b;

  const first = body.slice(0, b);
  const marker = body.slice(b, b + IMG_MARKER.length);
  const middle = body.slice(b + IMG_MARKER.length, b + IMG_MARKER.length + c);
  const marker2 = body.slice(
    b + IMG_MARKER.length + c,
    b + IMG_MARKER.length + c + IMG_MARKER2.length,
  );
  const rest = body.slice(b + IMG_MARKER.length + c + IMG_MARKER2.length);
  if (marker !== IMG_MARKER || marker2 !== IMG_MARKER2 || rest.length !== a) return [];

  const decoded = utf8(base64Decode(mapAlphabet(reverseChunks(rest + first + middle))));
  try {
    return JSON.parse(decoded) as DecodedImage[];
  } catch {
    return [];
  }
}

function reverseChunks(value: string): string {
  let out = "";
  for (let i = 0, j = 0; i < value.length; i += IMG_CHUNK, j++) {
    const chunk = value.slice(i, i + IMG_CHUNK);
    out += j % 2 ? chunk.split("").reverse().join("") : chunk;
  }
  return out;
}

function mapAlphabet(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const index = IMG_ALPHABET_B.indexOf(value.charAt(i));
    if (index < 0) return "";
    out += IMG_ALPHABET_A.charAt(index);
  }
  return out;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Decode(value: string): Uint8Array {
  const clean = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const index = BASE64_ALPHABET.indexOf(clean.charAt(i));
    if (index < 0) continue;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function utf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i++] ?? 0;
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
    } else if (byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f));
    } else if (byte < 0xf0) {
      out += String.fromCharCode(
        ((byte & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f),
      );
    } else {
      const codePoint =
        ((byte & 0x07) << 18) |
        (((bytes[i++] ?? 0) & 0x3f) << 12) |
        (((bytes[i++] ?? 0) & 0x3f) << 6) |
        ((bytes[i++] ?? 0) & 0x3f);
      out += String.fromCodePoint(codePoint);
    }
  }
  return out;
}

export class Target extends BaozimhSource {}
