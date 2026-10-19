import {
  CloudflareError,
  HttpClient,
  RequestOrigin,
  type HttpRequest,
  type HttpResponse,
  type RequestContext,
} from "@mana-app/types";

export const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
export const JSON_ACCEPT = "application/json, text/javascript, */*; q=0.01";
export const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
export const ACCEPT_LANGUAGE = "en-US,en;q=0.9";

const CHALLENGE_PATTERNS: readonly RegExp[] = [
  /challenges\.cloudflare\.com/i,
  /cf-browser-verification/i,
  /__cf_chl_/i,
  /<title>\s*Just a moment/i,
  /\.open\(\s*["']POST["']\s*,\s*["']\/_v["']\)/,
];

const CHALLENGE_SCAN_CHARS = 16_384;

export function isChallengeUrl(url: string): boolean {
  return /^https?:\/\/[^/?#]+\/_c(?:[?#]|$)/i.test(url);
}

export function isChallengePage(html: string): boolean {
  if (!html) return false;
  const head = html.slice(0, CHALLENGE_SCAN_CHARS);
  if (CHALLENGE_PATTERNS.some((pattern) => pattern.test(head))) return true;
  return head.includes("pow_nonce") && head.includes("pow_hash");
}

export type ClientOptions = {
  baseUrl: string;
  requests?: number;
  intervalMs?: number;
  accept?: string;
  headers?: Record<string, string>;
  imageHeaders?: Record<string, string>;
  resolutionUrl?: string;
  originFor?: (url: string) => string;
  json?: boolean;
  retry?: number;
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(body: string, fallback: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fallback;
  }

  if (isRecord(parsed)) {
    const error = parsed["error"];
    if (isRecord(error) && typeof error["message"] === "string") return error["message"];
    if (typeof parsed["message"] === "string") return parsed["message"];
  }
  return fallback;
}

function setMissing(request: HttpRequest, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (!request.headers.has(name)) request.headers.set(name, value);
  }
}

export function buildClient(options: ClientOptions): HttpClient {
  const {
    baseUrl,
    requests = 5,
    intervalMs = 1_000,
    accept = options.json ? JSON_ACCEPT : HTML_ACCEPT,
    headers = {},
    imageHeaders = { accept: IMAGE_ACCEPT },
    resolutionUrl = baseUrl,
    originFor,
    json = false,
    retry,
    timeoutMs,
  } = options;

  const interceptRequest = (request: HttpRequest, context: RequestContext): HttpRequest => {
    const origin = originFor?.(request.url) ?? baseUrl;
    setMissing(request, { origin, referer: `${origin}/`, "accept-language": ACCEPT_LANGUAGE });
    if (context.origin === RequestOrigin.General) setMissing(request, { accept, ...headers });
    else setMissing(request, imageHeaders);
    return request;
  };

  const interceptResponse = async (
    response: HttpResponse,
    context: RequestContext,
  ): Promise<HttpResponse> => {
    if (context.origin !== RequestOrigin.General) return response;
    if (response.status === 403 || response.status === 503) {
      throw new CloudflareError(resolutionUrl);
    }
    if (isChallengeUrl(response.url)) throw new CloudflareError(resolutionUrl);
    const body = await response.text();
    if (isChallengePage(body)) throw new CloudflareError(resolutionUrl);
    if (json && response.status >= 400) {
      throw new Error(
        `${errorMessage(body, "The server rejected the request")} (HTTP ${response.status})`,
      );
    }
    return response;
  };

  const client = new HttpClient()
    .addRequestInterceptor(interceptRequest)
    .addResponseInterceptor(interceptResponse);

  if (requests > 0) client.setRateLimit(requests, intervalMs);
  if (retry !== undefined) client.setRetry(retry);
  if (timeoutMs !== undefined) client.setTimeoutMs(timeoutMs);

  return client;
}

const ENCODING_FAILURE = /could not be serialized|unicode \(utf-8\)|invalid.{0,20}utf-?8/i;

let webViewTurn: Promise<unknown> = Promise.resolve();

function isEncodingFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return ENCODING_FAILURE.test(message);
}

async function readThroughWebView(url: string): Promise<string> {
  if (typeof WebViewPage === "undefined") {
    throw new Error(
      `${url} returned bytes that are not valid UTF-8, and this version of Mana cannot recover them.`,
    );
  }

  const page = await WebViewPage.create();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return await page.evaluateScript<string>("document.documentElement.outerHTML");
  } finally {
    await page.close();
  }
}

export async function getText(client: HttpClient, url: string): Promise<string> {
  try {
    const response = await client.get(url);
    return await response.requireOk().text();
  } catch (error) {
    if (!isEncodingFailure(error)) throw error;

    const turn = webViewTurn.then(() => readThroughWebView(url));
    webViewTurn = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }
}
