import {
  SearchPicker,
  SearchStepper,
  SearchTextField,
  SearchToggle,
  type Option,
  type SearchListField,
  type SortOption,
} from "@mana-app/types";

export const BASE_URL = "https://example.com";

export const FilterID = {
  Status: "status",
  Genre: "genre",
  Author: "author",
  Year: "year",
  AdultContent: "adult_content",
} as const;

export const SortID = {
  Latest: "latest",
  Popular: "popular",
  Title: "title",
} as const;

export const ListID = {
  Latest: "latest",
  Popular: "popular",
} as const;

export const PreferenceID = {
  PreferredLanguage: "preferred-language",
  ShowAdult: "show-adult",
} as const;

export const STATUS_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const GENRE_OPTIONS: Option[] = [
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "drama", title: "Drama" },
  { id: "fantasy", title: "Fantasy" },
  { id: "horror", title: "Horror" },
  { id: "mystery", title: "Mystery" },
  { id: "romance", title: "Romance" },
  { id: "sci-fi", title: "Sci-Fi" },
  { id: "slice-of-life", title: "Slice of Life" },
];

export const SEARCH_FIELDS: SearchListField[] = [
  SearchPicker({ id: FilterID.Status, title: "Status", options: STATUS_OPTIONS }),
  SearchTextField({
    id: FilterID.Author,
    title: "Author",
    placeholder: "Any author",
  }),
  SearchStepper({
    id: FilterID.Year,
    title: "Year",
    subtitle: "Titles published in this year",
    lowerBound: 1900,
    upperBound: 2100,
    step: 1,
  }),
  SearchToggle({
    id: FilterID.AdultContent,
    title: "Adult Content",
    subtitle: "Include 18+ titles",
  }),
];

export const TAG_FIELD = SearchPicker({
  id: FilterID.Genre,
  title: "Genre",
  options: GENRE_OPTIONS,
});

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Latest, title: "Latest", isDefault: true, isOrderable: false },
  { id: SortID.Popular, title: "Popular", isOrderable: false },
  { id: SortID.Title, title: "Title", isOrderable: true },
];

export const PREFERENCE_DEFAULTS = {
  [PreferenceID.PreferredLanguage]: "en",
  [PreferenceID.ShowAdult]: false,
};

export const LANGUAGE_OPTIONS: Option[] = [
  { id: "en", title: "English" },
  { id: "es", title: "Spanish" },
  { id: "fr", title: "French" },
];
