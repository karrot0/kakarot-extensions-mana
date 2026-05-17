import { type SearchFilter, FilterType } from "@mana-app/types";

export enum FilterID {
  Status = "status",
  Demographic = "demographic",
  OriginalLanguage = "original_language",
  Tags = "tags",
  AdultContent = "adult_content",
}

export interface APIItem {
  _id: string;
  name: string;
  alternateName: string;
  cover: string;
  background: string;
  tags: string;
  authors: string;
  status: string;
  last_chapter?: string;
  url: string;
  description: string;
  updated_at: string;
  languageFlag: string;
}

export interface SearchAPIPagination {
  total: number;
  limit: number;
  start: number;
  current_page: number;
  last_page: number;
  from: number;
  to: number;
}

export interface SearchAPIResponse {
  code: number;
  data: APIItem[];
  message: string;
  pagination?: SearchAPIPagination;
}

export interface ChapterTranslation {
  id: string;
  name: string;
  language: string;
  languageName: string;
  group?: { _id?: string; name?: string };
  date?: string;
  volume?: number;
}

export interface ChapterApiChapter {
  number: string;
  number_float: number;
  title: string;
  translations: ChapterTranslation[];
}

export interface ChapterApiResponse {
  code: number;
  TOTAL_CHAPTERS: number;
  ALL_CHAPTERS: ChapterApiChapter[];
}

export const SORT_OPTIONS = [
  { id: "updated_chapters_desc", label: "Latest Updated Chapters" },
  { id: "created_at_desc", label: "Latest Created" },
  { id: "name_asc", label: "Title A-Z" },
  { id: "name_desc", label: "Title Z-A" },
  { id: "views_desc", label: "Views High to Low" },
];

export const STATUS_OPTIONS = [
  { id: "any", title: "Any" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const DEMOGRAPHIC_OPTIONS = [
  { id: "any", title: "Any" },
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
  { id: "yuri", title: "Yuri" },
  { id: "yaoi", title: "Yaoi" },
];

export const ORIGINAL_LANGUAGE_OPTIONS = [
  { id: "en", title: "Comics" },
  { id: "jp", title: "Manga" },
  { id: "kr", title: "Manhwa" },
  { id: "zh", title: "Manhua" },
];

export const TAG_OPTIONS = [
  { id: "685146c5f3ed681c80f257e3", title: "Action" },
  { id: "685146c5f3ed681c80f257e6", title: "Adventure" },
  { id: "685148ef15e8b86aae68e573", title: "Boys' Love" },
  { id: "685146c5f3ed681c80f257e5", title: "Comedy" },
  { id: "685148da15e8b86aae68e51f", title: "Crime" },
  { id: "685148cf15e8b86aae68e4dd", title: "Drama" },
  { id: "6892a73ba943baf927094e37", title: "Ecchi" },
  { id: "685146c5f3ed681c80f257ea", title: "Fantasy" },
  { id: "685148da15e8b86aae68e524", title: "Girls' Love" },
  { id: "685148db15e8b86aae68e527", title: "Historical" },
  { id: "685148da15e8b86aae68e520", title: "Horror" },
  { id: "685146c5f3ed681c80f257e9", title: "Isekai" },
  { id: "6851490d15e8b86aae68e5d4", title: "Magical Girls" },
  { id: "68932d11a943baf927094e7b", title: "Mature" },
  { id: "6851490c15e8b86aae68e5d2", title: "Mecha" },
  { id: "685148d215e8b86aae68e4f4", title: "Mystery" },
  { id: "685148d715e8b86aae68e507", title: "Psychological" },
  { id: "685148cf15e8b86aae68e4db", title: "Romance" },
  { id: "685148cf15e8b86aae68e4da", title: "Sci-Fi" },
  { id: "685148d015e8b86aae68e4e3", title: "Slice of Life" },
  { id: "689371f2a943baf927094f04", title: "Smut" },
  { id: "685148f515e8b86aae68e588", title: "Sports" },
  { id: "6851492915e8b86aae68e61c", title: "Superhero" },
  { id: "685148d915e8b86aae68e51e", title: "Thriller" },
  { id: "685148db15e8b86aae68e529", title: "Tragedy" },
  { id: "68932f68a943baf927094eaa", title: "Yaoi" },
  { id: "6896a885a943baf927094f66", title: "Yuri" },
];

export const FILTERS: SearchFilter[] = [
  {
    id: FilterID.Status,
    title: "Status",
    type: FilterType.SELECT,
    options: STATUS_OPTIONS,
  },
  {
    id: FilterID.Demographic,
    title: "Demographic",
    type: FilterType.SELECT,
    options: DEMOGRAPHIC_OPTIONS,
  },
  {
    id: FilterID.OriginalLanguage,
    title: "Original Language",
    type: FilterType.MULTISELECT,
    options: ORIGINAL_LANGUAGE_OPTIONS,
  },
  {
    id: FilterID.Tags,
    title: "Tags",
    type: FilterType.EXCLUDABLE_MULTISELECT,
    options: TAG_OPTIONS,
  },
  {
    id: FilterID.AdultContent,
    title: "Adult Content",
    subtitle: "Show 18+ titles",
    type: FilterType.TOGGLE,
  },
];
