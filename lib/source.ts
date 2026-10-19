import type {
  HttpClient,
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

export abstract class BaseSource implements PageLinkResolver {
  private client: HttpClient | undefined;
  private imageClient: HttpClient | undefined;

  protected abstract clientOptions(): ClientOptions;
  protected abstract sections(): SectionSpec[];

  protected get http(): HttpClient {
    this.client ??= buildClient(this.clientOptions());
    return this.client;
  }

  protected get imageHttp(): HttpClient {
    this.imageClient ??= buildClient({ ...this.clientOptions(), requests: 0 });
    return this.imageClient;
  }

  protected async apiBase(): Promise<string> {
    return this.clientOptions().baseUrl;
  }

  protected async getJson<T>(path: string, params?: QueryParams): Promise<T> {
    const base = await this.apiBase();
    const response = await this.http.get(withQuery(`${base}${path}`, params));
    try {
      response.requireOk();
      return await response.json<T>();
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

  protected listResults(request: SearchRequest): Promise<PagedSearchResult> | undefined {
    return listResults(this.sections(), request);
  }
}
