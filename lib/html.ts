import type { HttpClient } from "@mana-app/types";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import { getText } from "./client.ts";
import { withQuery, type QueryParams } from "./forms/query.ts";
import { normalize } from "./text.ts";

export * from "./text.ts";

const LAZY_ATTRS = ["data-src", "data-original", "data-lazy-src", "srcset", "src"];

export async function fetchHtml(
  client: HttpClient,
  url: string,
  params?: QueryParams,
): Promise<CheerioAPI> {
  return load(await getText(client, withQuery(url, params)));
}

export function text(node: Cheerio<AnyNode>): string {
  return normalize(node.text());
}

export function ownText(node: Cheerio<AnyNode>): string {
  return normalize(
    node
      .contents()
      .filter((_, child) => child.type === "text")
      .text(),
  );
}

export function imageSrc(node: Cheerio<AnyNode>): string {
  for (const name of LAZY_ATTRS) {
    const raw = (node.attr(name) ?? "").trim();
    const first = raw.split(",")[0]?.trim().split(/\s+/)[0];
    if (first) return first;
  }
  return "";
}
