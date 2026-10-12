import type {
  PageLink,
  PageLinkResolver,
  PageSection,
  PagedSearchResult,
  ResolvedPageSection,
  SearchRequest,
} from "@mana-app/types";

import { buildClient, type ClientOptions } from "./client.ts";
import { withQuery, type QueryParams } from "./forms/query.ts";
import { listResults, sectionById, toPageSections, type SectionSpec } from "./forms/sections.ts";

/**
 * The plumbing every source shares: a lazily built network client, JSON
 * requests, and the home-page sections, which also back "view more" listings.
 */
export abstract class BaseSource implements PageLinkResolver {
  private client: NetworkClient | undefined;

  protected abstract clientOptions(): ClientOptions;
  protected abstract sections(): SectionSpec[];

  protected get http(): NetworkClient {
    this.client ??= buildClient(this.clientOptions());
    return this.client;
  }

  /** The origin `getJson` paths are resolved against. Override when it is configurable. */
  protected async apiBase(): Promise<string> {
    return this.clientOptions().baseUrl;
  }

  protected async getJson<T>(path: string, params?: QueryParams): Promise<T> {
    const base = await this.apiBase();
    const response = await this.http.get(withQuery(`${base}${path}`, params));
    try {
      return JSON.parse(response.data) as T;
    } catch {
      throw new Error(`${base} did not return JSON for ${path} (HTTP ${response.status})`);
    }
  }

  async getSectionsForPage(_link: PageLink): Promise<PageSection[]> {
    return toPageSections(this.sections());
  }

  async resolvePageSection(_link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
    const spec = sectionById(this.sections(), sectionID);
    if (!spec) return { items: [] };
    const { results } = await spec.load(1);
    return { items: results };
  }

  /** Results for a "view more" request, or undefined when it is a regular search. */
  protected listResults(request: SearchRequest): Promise<PagedSearchResult> | undefined {
    return listResults(this.sections(), request);
  }
}
