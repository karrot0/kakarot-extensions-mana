import { SearchPicker, type Option, type SortOption } from "@mana-app/types";

export const BASE_URL = "https://ocecomic.com";

export const FilterID = {
  Genre: "genre",
} as const;

export const SortID = {
  Latest: "latest",
  Popular: "popular",
  Newer: "newer",
  Older: "older",
} as const;

export const ListID = {
  New: "new",
  Popular: "popular",
} as const;

export const GENRE_OPTIONS: Option[] = [
  { id: "all", title: "All" },
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "anthology", title: "Anthology" },
  { id: "apocalyptic", title: "Apocalyptic" },
  { id: "children", title: "Children" },
  { id: "comedy", title: "Comedy" },
  { id: "crime", title: "Crime" },
  { id: "drama", title: "Drama" },
  { id: "dystopia", title: "Dystopia" },
  { id: "fantasy", title: "Fantasy" },
  { id: "game", title: "Game" },
  { id: "heroine", title: "Heroine" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "kingdom", title: "Kingdom" },
  { id: "literature", title: "Literature" },
  { id: "mature", title: "Mature" },
  { id: "military", title: "Military" },
  { id: "mystery", title: "Mystery" },
  { id: "mythology", title: "Mythology" },
  { id: "occult", title: "Occult" },
  { id: "political", title: "Political" },
  { id: "robot", title: "Robot" },
  { id: "romance", title: "Romance" },
  { id: "sci-fi", title: "Sci-Fi" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "spy", title: "Spy" },
  { id: "superhero", title: "Superhero" },
  { id: "supernatural", title: "Supernatural" },
  { id: "suspense", title: "Suspense" },
  { id: "thriller", title: "Thriller" },
  { id: "vampire", title: "Vampire" },
  { id: "war", title: "War" },
  { id: "western", title: "Western" },
  { id: "zombie", title: "Zombie" },
];

export const GENRE_FIELD = SearchPicker({
  id: FilterID.Genre,
  title: "Genre",
  options: GENRE_OPTIONS,
});

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Latest, title: "Latest", isDefault: true, isOrderable: false },
  { id: SortID.Popular, title: "Popular", isOrderable: false },
  { id: SortID.Newer, title: "Newest", isOrderable: false },
  { id: SortID.Older, title: "Oldest", isOrderable: false },
];

export const MATURE_GENRE = /mature/i;
