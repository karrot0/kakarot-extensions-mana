import { SearchPicker, type Option } from "@mana-app/types";

export const BASE_URL = "https://batcave.biz";

export const CDN_ORIGINS = ["https://readcomicsonline.ru"];

export const FilterID = {
  Genre: "genre",
} as const;

export const ListID = {
  Popular: "popular",
  Catalogue: "catalogue",
  New: "new",
} as const;

export const GENRE_OPTIONS: Option[] = [
  { id: "", title: "Any" },
  { id: "Action", title: "Action" },
  { id: "Adventure", title: "Adventure" },
  { id: "Anthology", title: "Anthology" },
  { id: "Anthropomorphic", title: "Anthropomorphic" },
  { id: "Biography", title: "Biography" },
  { id: "Children", title: "Children" },
  { id: "Comedy", title: "Comedy" },
  { id: "Crime", title: "Crime" },
  { id: "Drama", title: "Drama" },
  { id: "Family", title: "Family" },
  { id: "Fantasy", title: "Fantasy" },
  { id: "Fighting", title: "Fighting" },
  { id: "Graphic Novels", title: "Graphic Novels" },
  { id: "Historical", title: "Historical" },
  { id: "Horror", title: "Horror" },
  { id: "Leading Ladies", title: "Leading Ladies" },
  { id: "LGBTQ", title: "LGBTQ" },
  { id: "Literature", title: "Literature" },
  { id: "Manga", title: "Manga" },
  { id: "Martial Arts", title: "Martial Arts" },
  { id: "Mature", title: "Mature" },
  { id: "Military", title: "Military" },
  { id: "Mini-Series", title: "Mini-Series" },
  { id: "Movies & TV", title: "Movies & TV" },
  { id: "Music", title: "Music" },
  { id: "Mystery", title: "Mystery" },
  { id: "Mythology", title: "Mythology" },
  { id: "Personal", title: "Personal" },
  { id: "Political", title: "Political" },
  { id: "Post-Apocalyptic", title: "Post-Apocalyptic" },
  { id: "Psychological", title: "Psychological" },
  { id: "Pulp", title: "Pulp" },
  { id: "Religious", title: "Religious" },
  { id: "Robots", title: "Robots" },
  { id: "Romance", title: "Romance" },
  { id: "School Life", title: "School Life" },
  { id: "Sci-Fi", title: "Sci-Fi" },
  { id: "Slice of Life", title: "Slice of Life" },
  { id: "Sport", title: "Sport" },
  { id: "Spy", title: "Spy" },
  { id: "Superhero", title: "Superhero" },
  { id: "Supernatural", title: "Supernatural" },
  { id: "Suspense", title: "Suspense" },
  { id: "Thriller", title: "Thriller" },
  { id: "Vampires", title: "Vampires" },
  { id: "Video Games", title: "Video Games" },
  { id: "War", title: "War" },
  { id: "Western", title: "Western" },
  { id: "Zombies", title: "Zombies" },
];

export const GENRE_FIELD = SearchPicker({
  id: FilterID.Genre,
  title: "Genre",
  options: GENRE_OPTIONS,
});

export type RawChapter = {
  id: number;
  title?: string;
  posi: number;
  date?: string;
};

export type ChapterPayload = {
  chapters?: RawChapter[];
};

export type ChapterDataResponse = {
  success?: boolean;
  error?: string;
  data?: { images?: string[] };
};
