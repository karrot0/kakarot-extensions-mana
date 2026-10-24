import { SearchMultiPicker, type Option, type SortOption } from "@mana-app/types";

export const BASE_URL = "https://rawkuma.net";

export const FilterID = {
  Type: "type",
  Status: "status",
  Genre: "genre",
} as const;

export const SortID = {
  Updated: "updated",
  Popular: "popular",
  Rating: "rating",
  Bookmarked: "bookmarked",
  Title: "title",
} as const;

export const ListID = {
  Latest: "latest",
  Popular: "popular",
} as const;

export const TYPE_OPTIONS: Option[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
];

export const STATUS_OPTIONS: Option[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "cancelled", title: "Cancelled" },
  { id: "on-hiatus", title: "On Hiatus" },
  { id: "unknown", title: "Unknown" },
];

export const TYPE_FIELD = SearchMultiPicker({
  id: FilterID.Type,
  title: "Type",
  options: TYPE_OPTIONS,
});

export const STATUS_FIELD = SearchMultiPicker({
  id: FilterID.Status,
  title: "Status",
  options: STATUS_OPTIONS,
});

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Updated, title: "Updated", isDefault: true, isOrderable: false },
  { id: SortID.Popular, title: "Popular", isOrderable: false },
  { id: SortID.Rating, title: "Rating", isOrderable: false },
  { id: SortID.Bookmarked, title: "Bookmarked", isOrderable: false },
  { id: SortID.Title, title: "Title", isOrderable: false },
];

export const ADULT_GENRE = /ecchi|adult|hentai|mature/i;

export type WpRendered = { rendered: string };

export type WpTerm = { name: string; slug: string; taxonomy: string };

export type WpManga = {
  id: number;
  slug: string;
  title: WpRendered;
  content: WpRendered;
  meta?: { meta?: { alternative_title?: string } };
  _embedded: {
    "wp:featuredmedia"?: { source_url: string }[];
    "wp:term"?: WpTerm[][];
  };
};
