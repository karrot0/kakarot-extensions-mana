export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

function encodePairs(params: Record<string, QueryValue>, keepEmpty: boolean): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && (keepEmpty || value !== ""))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export function withQuery(url: string, params?: QueryParams): string {
  const query = encodePairs(params ?? {}, false);
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

export function encodeForm(body: Record<string, QueryValue>): string {
  return encodePairs(body, true);
}
