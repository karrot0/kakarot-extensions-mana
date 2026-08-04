import { type SearchFilter, FilterType } from "@mana-app/types";

export enum FilterID {
  Category = "category",
}

export const CATEGORY_OPTIONS = [
  { id: "", title: "Any" },
  { id: "dc", title: "DC Comics" },
  { id: "marvel", title: "Marvel" },
  { id: "other-comics", title: "Other Comics" },
];

export const FILTERS: SearchFilter[] = [
  {
    id: FilterID.Category,
    title: "Category",
    type: FilterType.SELECT,
    options: CATEGORY_OPTIONS,
  },
];

/**
 * Categories that are site housekeeping (update notes, sponsored posts, etc.)
 * rather than actual comic releases, filtered out of listing pages.
 */
export const NON_COMIC_CATEGORIES = ["category-news", "category-blog", "category-sponsored"];
