import { SearchPicker, SearchTextField, type Option, type SortOption } from "@mana-app/types";

export const DEFAULT_BASE_URL = "https://comics.karrot.dev";

export const PREFERENCE_NAMESPACE = "kakarot-comics";

export const PreferenceID = {
  BaseUrl: "base-url",
  PublisherAllowlist: "publisher-allowlist",
} as const;

export const PREFERENCE_DEFAULTS = {
  [PreferenceID.BaseUrl]: DEFAULT_BASE_URL,
  [PreferenceID.PublisherAllowlist]: [] as string[],
};

export const FilterID = {
  Publisher: "publisher",
  Character: "character",
  Type: "type",
  Year: "year",
} as const;

export const SeriesSort = {
  Title: "title",
  Popular: "popular",
  Recent: "recent",
} as const;

export const ListID = {
  PopularSeries: "series:popular",
  RecentSeries: "series:recent",
  Characters: "characters",
} as const;

export const CHARACTER_PREFIX = "character:";

export const PAGE_SIZE = 50;
export const PUBLISHER_OPTIONS_LIMIT = 100;
export const SERIES_LANGUAGE = "en";
export const CHAPTER_FETCH_LIMIT = 100;
export const MAX_CHAPTER_REQUESTS = 40;

export const SORT_OPTIONS: SortOption[] = [
  { id: SeriesSort.Title, title: "Title", isDefault: true, isOrderable: false },
  { id: SeriesSort.Popular, title: "Most Issues", isOrderable: false },
  { id: SeriesSort.Recent, title: "Newest", isOrderable: false },
];

export const SERIES_TYPE_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "ongoing", title: "Ongoing" },
  { id: "limited", title: "Limited" },
  { id: "one-shot", title: "One-Shot" },
  { id: "graphic-novel", title: "Graphic Novel" },
  { id: "event", title: "Event" },
];

export const SEARCH_FIELDS = [
  SearchPicker({ id: FilterID.Type, title: "Type", options: SERIES_TYPE_OPTIONS }),
  SearchTextField({
    id: FilterID.Publisher,
    title: "Publisher",
    subtitle: "Name or slug, e.g. dc-comics",
    placeholder: "Any publisher",
  }),
  SearchTextField({
    id: FilterID.Character,
    title: "Character",
    subtitle: "Only series this character appears in",
    placeholder: "e.g. batman",
  }),
  SearchTextField({
    id: FilterID.Year,
    title: "Running In Year",
    subtitle: "Series published during this year",
    placeholder: "e.g. 1986",
  }),
];

// ---------------------------------------------------------------------------
// comic-api response shapes — only the fields this source reads
// ---------------------------------------------------------------------------

export interface ApiPagination {
  limit: number;
  offset: number;
  count: number;
  total: number | null;
  has_more: boolean;
}

export interface ApiPage<T> {
  data: T[];
  pagination: ApiPagination;
}

export interface ApiSeries {
  id: number;
  title: string;
  slug: string;
  volume: number;
  start_year: number | null;
  end_year: number | null;
  series_type: string;
  description: string | null;
  cover_url: string | null;
  publisher: string | null;
  publisher_slug: string | null;
  issue_count?: number;
  role?: string;
}

export interface ApiSeriesDetail extends ApiSeries {
  characters?: { id: number; name: string; slug: string; role: string }[];
}

export interface ApiIssue {
  id: number;
  issue_number: string;
  title: string | null;
  release_date: string | null;
  cover_url: string | null;
  page_count?: number | null;
  writers?: string[];
  artists?: string[];
  synopsis?: string | null;
  /** e.g. "getcomics" -- the source currently confirmed to have readable pages for this issue, if any. */
  provider?: string | null;
}

export interface ApiPublisher {
  id: number;
  name: string;
  slug: string;
  country: string | null;
  series_count?: number;
}

export interface ApiCharacter {
  id: number;
  name: string;
  slug: string;
  real_name: string | null;
  description: string | null;
  image_url: string | null;
  publisher: string | null;
  appearance_count?: number | null;
  series_count?: number;
}

export interface ApiManifestPage {
  index: number;
  kind: string;
  page_number?: number;
  url?: string;
  data?: string;
  content_type?: string | null;
  byte_size?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface ApiPageManifest {
  data: {
    issue: { id: number; issue_number: string; title: string | null };
    series: { id: number; title: string; slug: string };
    source: "scan" | "live" | "cover" | "none";
    provider?: string;
    source_ref?: string;
    printed_page_count: number | null;
    pages: ApiManifestPage[];
    reason?: string;
    url_expires_in?: number;
  };
}
