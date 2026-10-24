import { SearchPicker, type Option } from "@mana-app/types";

export const BASE_URL = "https://baozimh.org";

// The chapter list and chapter content APIs live on a different host than the
// pages and require a browser User-Agent to pass Cloudflare.
export const API_URL = "https://v2.apikk.top";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Chapter pages are served from one of two hosts, chosen by the "line" value the
// chapter API returns (1 -> the default host, 2 -> the alternate host).
export const IMAGE_CDN = "https://c-nd3-1.6wm.top";
export const IMAGE_CDN_ALT = "https://c-nd2-1.6wm.top";

export const FilterID = {
  Genre: "genre",
} as const;

export const ListID = {
  Latest: "latest",
  Popular: "popular",
  Newest: "newest",
} as const;

export const GENRE_OPTIONS: Option[] = [
  { id: "", title: "全部 (All)" },
  { id: "hots", title: "热门漫画 (Hot)" },
  { id: "kr", title: "韩漫 (Korean)" },
  { id: "cn", title: "国漫 (Chinese)" },
  { id: "jp", title: "日漫 (Japanese)" },
  { id: "qita", title: "其他 (Other)" },
  { id: "ou-mei", title: "欧美 (Western)" },
];

export const GENRE_FIELD = SearchPicker({
  id: FilterID.Genre,
  title: "Genre",
  options: GENRE_OPTIONS,
});

export type MangaResponse = {
  code: number;
  data?: {
    id: string;
    title: string;
    slug: string;
    cover: string;
    desc: string;
    status: string;
    content_rating: string;
    chapters?: ChapterEntry[];
  };
};

export type ChapterEntry = {
  id: string;
  attributes: {
    title: string;
    slug: string;
    order: number;
    isAd: number;
    updatedAt: string;
  };
};

export type ChapterResponse = {
  code: number;
  data?: {
    info?: {
      mid: string;
      title: string;
      slug: string;
      next: string;
      pre: string;
      images?: { images: string; line: number };
    };
  };
};

export type DecodedImage = { order: number; url: string; isLoaded?: boolean };
