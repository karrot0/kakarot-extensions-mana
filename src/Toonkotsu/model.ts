import {
  SearchMenuPicker,
  SearchStepper,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

export const BASE_URL = "https://toonkotsu.com";

export const PAGE_SIZE = 42;
export const GENRE_LIMIT = 80;
export const READER_TIMEOUT = 180;

export const FilterID = {
  Status: "status",
  Type: "type",
  Demographic: "demographic",
  Genre: "genre",
  YearFrom: "year_from",
  YearTo: "year_to",
  MinChapters: "min_chapters",
} as const;

export const SortID = {
  Latest: "latest",
  Popular: "popular",
  Score: "score",
  New: "new",
  Title: "title",
  Year: "year",
  Chapters: "chapters",
} as const;

export const ListID = {
  MostRead: "most-read",
  Trending: "trending",
  Latest: "latest",
  Popular: "popular",
  New: "new",
} as const;

export const RankingMetric = {
  Views: "views",
  Trending: "trending",
} as const;

export const PreferenceID = {
  ShowAdult: "show-adult",
  ReaderLoader: "reader-loader",
} as const;

export const STATUS_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "Ongoing", title: "Ongoing" },
  { id: "Complete", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Canceled", title: "Cancelled" },
];

export const TYPE_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "Manga", title: "Manga" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
  { id: "OEL", title: "OEL" },
];

export const DEMOGRAPHIC_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "Shounen", title: "Shounen" },
  { id: "Shoujo", title: "Shoujo" },
  { id: "Seinen", title: "Seinen" },
  { id: "Josei", title: "Josei" },
];

export const FALLBACK_GENRES: readonly string[] = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Historical",
  "Horror",
  "Isekai",
  "Martial Arts",
  "Mystery",
  "Psychological",
  "Romance",
  "School Life",
  "Sci-fi",
  "Slice of Life",
  "Supernatural",
  "Tragedy",
];

export const SEARCH_FIELDS: SearchListField[] = [
  SearchMenuPicker({ id: FilterID.Status, title: "Status", options: STATUS_OPTIONS }),
  SearchMenuPicker({ id: FilterID.Type, title: "Type", options: TYPE_OPTIONS }),
  SearchMenuPicker({
    id: FilterID.Demographic,
    title: "Demographic",
    options: DEMOGRAPHIC_OPTIONS,
  }),
  SearchStepper({
    id: FilterID.YearFrom,
    title: "Year From",
    subtitle: "Published in or after this year",
    lowerBound: 1928,
    upperBound: 2100,
    step: 1,
  }),
  SearchStepper({
    id: FilterID.YearTo,
    title: "Year To",
    subtitle: "Published in or before this year",
    lowerBound: 1928,
    upperBound: 2100,
    step: 1,
  }),
  SearchStepper({
    id: FilterID.MinChapters,
    title: "Minimum Chapters",
    lowerBound: 0,
    upperBound: 5000,
    step: 10,
  }),
];

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Latest, title: "Latest Update", isDefault: true, isOrderable: false },
  { id: SortID.Popular, title: "Popular", isOrderable: false },
  { id: SortID.Score, title: "Score", isOrderable: false },
  { id: SortID.New, title: "Recently Added", isOrderable: false },
  { id: SortID.Title, title: "Title", isOrderable: true, defaultAscending: true },
  { id: SortID.Year, title: "Year", isOrderable: true },
  { id: SortID.Chapters, title: "Chapters", isOrderable: true },
];

export const PREFERENCE_DEFAULTS = {
  [PreferenceID.ShowAdult]: false,
  [PreferenceID.ReaderLoader]: "",
};

export type SeriesChapterRef = {
  id: number;
  label: string;
  n: number | null;
  at?: number;
};

export type SeriesSummary = {
  id: number;
  hid: string;
  slug: string;
  title: string;
  cover: string | null;
  type: string | null;
  status: string | null;
  year: number | null;
  tags?: string[];
  adult?: boolean;
  chapters?: number;
  latest?: SeriesChapterRef | null;
};

export type SeriesDetail = SeriesSummary & {
  description?: string | null;
  alt?: string[];
  authors?: string[];
  externalIds?: Record<string, string | null>;
};

export type ChapterGroup = {
  slug: string;
  name: string;
};

export type ChapterEntry = {
  id: number;
  n: number | null;
  label: string;
  vol: string | null;
  at: number;
  thumb?: string | null;
  group?: ChapterGroup | null;
};

export type ListResponse = {
  items: SeriesSummary[];
  hasNextPage?: boolean;
};

export type LatestResponse = {
  items: { chapter: SeriesChapterRef; series: SeriesSummary }[];
  hasNextPage?: boolean;
};

export type SeriesResponse = {
  series: SeriesDetail;
  chapters?: ChapterEntry[];
  recs?: SeriesSummary[];
};

export type FacetsResponse = {
  genres?: { name: string; count: number }[];
};

export type ReaderPage = {
  url?: string;
  raw?: string;
};

export type ReaderResult = {
  pages?: ReaderPage[];
  gate?: string;
  retryAfter?: number;
  error?: string;
  loader?: string;
};

export type BrowserResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type BrowserScope = {
  document: { querySelectorAll(selector: string): ArrayLike<{ href?: string }> };
  performance: { getEntriesByType(type: string): { name: string }[] };
  location: { href: string };
  fetch(url: string, init?: { credentials: string }): Promise<BrowserResponse>;
  crypto: {
    subtle: {
      importKey(
        format: string,
        key: Uint8Array,
        algorithm: { name: string },
        extractable: boolean,
        usages: string[],
      ): Promise<unknown>;
      decrypt(
        algorithm: { name: string; counter: Uint8Array; length: number },
        key: unknown,
        data: ArrayBuffer,
      ): Promise<ArrayBuffer>;
    };
  };
  atob(value: string): string;
  btoa(value: string): string;
  URL: new (url: string, base: string) => { href: string };
};

export type SitePage = { src?: string; k?: string; n?: string };
export type SiteModule = { chapter(id: number): Promise<unknown> };
export type SiteFailure = {
  status?: number;
  message?: string;
  data?: { code?: string; reason?: string; retryAfterSec?: number; error?: string };
};
