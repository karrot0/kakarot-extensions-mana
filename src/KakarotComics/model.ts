import {
  SearchPicker,
  type Option,
  type SearchOptionField,
  type SortOption,
} from "@mana-app/types";

export const DEFAULT_BASE_URL = "https://comics.karrot.dev";

export const PREFERENCE_NAMESPACE = "kakarot-comics";

export const PreferenceID = {
  Sources: "sources",
} as const;

export const PREFERENCE_DEFAULTS = {
  [PreferenceID.Sources]: [] as string[],
};

/** Source keys as the proxy names them in slugs and `?source=`. */
export const SourceKey = {
  Batcave: "bc",
  OceComic: "oc",
} as const;

export const SOURCE_OPTIONS: Option[] = [
  { id: SourceKey.Batcave, title: "Batcave" },
  { id: SourceKey.OceComic, title: "OceComic" },
];

export const FilterID = {
  Source: "source",
  Genre: "genre",
} as const;

export const ListID = {
  BatcavePopular: "bc:popular",
  BatcaveNew: "bc:latest",
  BatcaveCatalogue: "bc:catalogue",
  OceComicNew: "oc:latest",
  OceComicPopular: "oc:popular",
} as const;

export const SortID = {
  Latest: "latest",
  Popular: "popular",
  Newer: "newer",
  Older: "older",
} as const;

export const SORT_OPTIONS: SortOption[] = [
  { id: SortID.Latest, title: "Latest", isDefault: true, isOrderable: false },
  { id: SortID.Popular, title: "Popular", isOrderable: false },
  { id: SortID.Newer, title: "Newest", isOrderable: false },
  { id: SortID.Older, title: "Oldest", isOrderable: false },
];

/** The proxy's unified genre list (`/api/sources`), keyed by slug across both sources. */
export const GENRE_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  ...[
    "Action",
    "Adventure",
    "Anthology",
    "Anthropomorphic",
    "Apocalyptic",
    "Biography",
    "Children",
    "Comedy",
    "Crime",
    "Drama",
    "Dystopia",
    "Family",
    "Fantasy",
    "Fighting",
    "Game",
    "Graphic Novels",
    "Heroine",
    "Historical",
    "Horror",
    "Kingdom",
    "Leading Ladies",
    "LGBTQ",
    "Literature",
    "Manga",
    "Martial Arts",
    "Mature",
    "Military",
    "Mini-Series",
    "Movies & TV",
    "Music",
    "Mystery",
    "Mythology",
    "Occult",
    "Personal",
    "Political",
    "Post-Apocalyptic",
    "Psychological",
    "Pulp",
    "Religious",
    "Robot",
    "Romance",
    "School Life",
    "Sci-Fi",
    "Slice of Life",
    "Sport",
    "Spy",
    "Superhero",
    "Supernatural",
    "Suspense",
    "Thriller",
    "Vampire",
    "Video Games",
    "War",
    "Western",
    "Zombie",
  ].map((title) => ({ id: genreSlug(title), title })),
];

export function genreSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const GENRE_FIELD: SearchOptionField = SearchPicker({
  id: FilterID.Genre,
  title: "Genre",
  options: GENRE_OPTIONS,
});

export const SOURCE_FIELD = SearchPicker({
  id: FilterID.Source,
  title: "Source",
  options: [{ id: "", title: "All sources" }, ...SOURCE_OPTIONS],
});

// ---------------------------------------------------------------------------
// kakarot_comics proxy response shapes
// ---------------------------------------------------------------------------

export interface ApiPage<T> {
  data: T[];
  has_more: boolean;
}

export interface ApiSeries {
  slug: string;
  title: string;
  source: string;
  cover_url?: string;
  subtitle?: string;
}

export interface ApiTag {
  id: string;
  title: string;
}

export interface ApiSeriesDetail {
  slug: string;
  title: string;
  source: string;
  cover_url?: string;
  description: string;
  tags: ApiTag[];
  status?: "ongoing" | "completed" | "hiatus" | "cancelled";
  publisher?: string;
  writer?: string;
  mature: boolean;
  web_url: string;
}

export interface ApiIssue {
  id: string;
  number: number;
  title: string;
  date?: string;
  web_url: string;
}

export interface ApiPages {
  data: { pages: { url: string }[] };
}
