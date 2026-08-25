import {
  SearchListSection,
  SearchSortSection,
  SearchTagsSection,
  type SearchForm,
  type SearchListField,
  type SearchOptionField,
  type SearchRequest,
  type SearchSection,
  type SearchSortStyle,
} from "@mana-app/types";

export type SearchFormSpec = {
  fields?: readonly SearchListField[];
  header?: string;
  footer?: string;
  tags?: SearchOptionField;
  tagsHeader?: string;
  sortHeader?: string;
  sortStyle?: SearchSortStyle;
  includeSort?: boolean;
};

export function buildSearchForm(spec: SearchFormSpec): SearchForm {
  const sections: SearchSection[] = [];
  const fields = spec.fields ?? [];

  if (fields.length > 0) {
    sections.push(
      SearchListSection({
        ...(spec.header === undefined ? {} : { header: spec.header }),
        ...(spec.footer === undefined ? {} : { footer: spec.footer }),
        children: [...fields],
      }),
    );
  }

  if (spec.tags) {
    sections.push(
      SearchTagsSection({
        ...(spec.tagsHeader === undefined ? {} : { header: spec.tagsHeader }),
        field: spec.tags,
      }),
    );
  }

  if (spec.includeSort !== false) {
    sections.push(
      SearchSortSection({
        ...(spec.sortHeader === undefined ? {} : { header: spec.sortHeader }),
        ...(spec.sortStyle === undefined ? {} : { style: spec.sortStyle }),
      }),
    );
  }

  return { sections };
}

export function resolveSortId(
  options: readonly { id: string; isDefault?: boolean }[],
  request: SearchRequest,
  fallback = "",
): string {
  const requested = request.sort?.id ?? "";
  if (options.some((option) => option.id === requested)) return requested;
  return options.find((option) => option.isDefault)?.id ?? fallback;
}
