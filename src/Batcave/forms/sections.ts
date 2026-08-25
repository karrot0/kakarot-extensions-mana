import type { PageSection, PagedSearchResult, SearchRequest, SectionStyle } from "@mana-app/types";

export type SectionSpec = {
  id: string;
  title: string;
  subtitle?: string;
  style?: SectionStyle;
  viewMore?: boolean;
  load(page: number): Promise<PagedSearchResult>;
};

export function pageOf(request: { page?: number }): number {
  const page = request.page ?? 1;
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

export function toPageSections(specs: readonly SectionSpec[]): PageSection[] {
  return specs.map((spec) => ({
    id: spec.id,
    title: spec.title,
    ...(spec.subtitle === undefined ? {} : { subtitle: spec.subtitle }),
    ...(spec.style === undefined ? {} : { style: spec.style }),
    ...(spec.viewMore === false ? {} : { viewMoreLink: { request: { page: 1, listId: spec.id } } }),
  }));
}

export function sectionById(
  specs: readonly SectionSpec[],
  id: string | undefined,
): SectionSpec | undefined {
  if (!id) return undefined;
  return specs.find((spec) => spec.id === id);
}

export function listResults(
  specs: readonly SectionSpec[],
  request: SearchRequest,
): Promise<PagedSearchResult> | undefined {
  const spec = sectionById(specs, request.listId);
  return spec ? spec.load(pageOf(request)) : undefined;
}
