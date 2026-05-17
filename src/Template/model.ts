import { type SearchFilter, FilterType } from "@mana-app/types";

export enum FilterID {
  Status = "status",
  Genre = "genre",
  AdultContent = "adult_content",
}

export const FILTERS: SearchFilter[] = [
  {
    id: FilterID.Status,
    title: "Status",
    type: FilterType.SELECT,
    options: [
      { id: "ongoing", title: "Ongoing" },
      { id: "completed", title: "Completed" },
      { id: "hiatus", title: "Hiatus" },
      { id: "cancelled", title: "Cancelled" },
    ],
  },
  {
    id: FilterID.Genre,
    title: "Genre",
    type: FilterType.EXCLUDABLE_MULTISELECT,
    options: [
      { id: "action", title: "Action" },
      { id: "adventure", title: "Adventure" },
      { id: "comedy", title: "Comedy" },
      { id: "drama", title: "Drama" },
      { id: "fantasy", title: "Fantasy" },
      { id: "horror", title: "Horror" },
      { id: "mystery", title: "Mystery" },
      { id: "romance", title: "Romance" },
      { id: "sci_fi", title: "Sci-Fi" },
      { id: "slice_of_life", title: "Slice of Life" },
    ],
  },
  {
    id: FilterID.AdultContent,
    title: "Adult Content",
    subtitle: "Show 18+ titles",
    type: FilterType.TOGGLE,
  },
];
