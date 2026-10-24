import { SearchMultiPicker, SearchPicker, type Option, type SortOption } from "@mana-app/types";

export const BASE_URL = "https://rawotaku.com";

export const CDN_URL = "https://mgoimg.view47.com";

export const FilterID = {
  Type: "type",
  Status: "status",
  Language: "language",
  Genre: "genre",
} as const;

export const SortID = {
  Default: "default",
  LatestUpdated: "latest-updated",
  MostViewed: "most-viewed",
  TitleAZ: "title-az",
  TitleZA: "title-za",
} as const;

export const ListID = {
  Latest: "latest",
  Popular: "popular",
} as const;

export const TYPE_OPTIONS: Option[] = [
  { id: "all", title: "All" },
  { id: "Raw Manga", title: "Raw Manga" },
  { id: "BLコミック", title: "BL Comic" },
  { id: "TLコミック", title: "TL Comic" },
  { id: "オトナコミック", title: "Adult Comic" },
  { id: "女性マンガ", title: "Josei" },
  { id: "少女マンガ", title: "Shoujo" },
  { id: "少年マンガ", title: "Shounen" },
  { id: "青年マンガ", title: "Seinen" },
];

export const STATUS_OPTIONS: Option[] = [
  { id: "all", title: "All" },
  { id: "Publishing", title: "Publishing" },
  { id: "Finished", title: "Finished" },
];

export const LANGUAGE_OPTIONS: Option[] = [
  { id: "all", title: "All" },
  { id: "ja", title: "Japanese" },
  { id: "en", title: "English" },
];

export const GENRE_OPTIONS: Option[] = [
  { id: "55", title: "Action" },
  { id: "54", title: "Adventure" },
  { id: "91", title: "Comedy" },
  { id: "56", title: "Drama" },
  { id: "1", title: "Fantasy" },
  { id: "1416", title: "Magic" },
  { id: "20", title: "Harem" },
  { id: "15706", title: "Ecchi" },
  { id: "6820", title: "Demons" },
  { id: "1064", title: "Martial Arts" },
  { id: "9600", title: "Historical" },
  { id: "6089", title: "Police & Special Forces" },
  { id: "4329", title: "Cars & Bikes" },
  { id: "473", title: "Music" },
];

export const TYPE_FIELD = SearchPicker({
  id: FilterID.Type,
  title: "Type",
  options: TYPE_OPTIONS,
});

export const STATUS_FIELD = SearchPicker({
  id: FilterID.Status,
  title: "Status",
  options: STATUS_OPTIONS,
});

export const LANGUAGE_FIELD = SearchPicker({
  id: FilterID.Language,
  title: "Language",
  options: LANGUAGE_OPTIONS,
});

export const GENRE_FIELD = SearchMultiPicker({
  id: FilterID.Genre,
  title: "Genre",
  options: GENRE_OPTIONS,
});

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Default, title: "Default", isDefault: true, isOrderable: false },
  { id: SortID.LatestUpdated, title: "Latest Updated", isOrderable: false },
  { id: SortID.MostViewed, title: "Most Viewed", isOrderable: false },
  { id: SortID.TitleAZ, title: "Title A-Z", isOrderable: false },
  { id: SortID.TitleZA, title: "Title Z-A", isOrderable: false },
];

export const ADULT_GENRE = /エッチ|オトナコミック|BLコミック|TLコミック|Ecchi/;
