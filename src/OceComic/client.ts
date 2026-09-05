import { NetworkClientBuilder, type NetworkRequest, type NetworkResponse } from "@mana-app/types";

export const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
export const JSON_ACCEPT = "application/json, text/javascript, */*; q=0.01";
export const ACCEPT_LANGUAGE = "en-US,en;q=0.9";

const CHALLENGE_PATTERNS: readonly RegExp[] = [
  /challenges\.cloudflare\.com/i,
  /cf-browser-verification/i,
  /__cf_chl_/i,
  /<title>\s*Just a moment/i,
  /\.open\(\s*["']POST["']\s*,\s*["']\/_v["']\)/,
];

export function isChallengePage(html: string): boolean {
  if (!html) return false;
  const head = html.slice(0, 4096);
  if (CHALLENGE_PATTERNS.some((pattern) => pattern.test(head))) return true;
  return head.includes("pow_nonce") && head.includes("pow_hash");
}

export type ClientOptions = {
  baseUrl: string;
  requests?: number;
  interval?: number;
  accept?: string;
  headers?: Record<string, string>;
  resolutionUrl?: string;
  originFor?: (url: string) => string;
  json?: boolean;
  maxRetries?: number;
  timeout?: number;
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

export function buildClient(options: ClientOptions): NetworkClient {
  const {
    baseUrl,
    requests = 5,
    interval = 1,
    accept = options.json ? JSON_ACCEPT : HTML_ACCEPT,
    headers = {},
    resolutionUrl = baseUrl,
    originFor,
    json = false,
    maxRetries,
    timeout,
  } = options;

  const interceptRequest = async (request: NetworkRequest): Promise<NetworkRequest> => {
    const origin = originFor?.(request.url) ?? baseUrl;
    return {
      ...request,
      headers: {
        origin,
        referer: `${origin}/`,
        accept,
        "accept-language": ACCEPT_LANGUAGE,
        ...headers,
        ...request.headers,
      },
    };
  };

  const interceptResponse = async (response: NetworkResponse): Promise<NetworkResponse> => {
    if (response.status === 403 || response.status === 503 || isChallengePage(response.data)) {
      throw new CloudflareError(resolutionUrl);
    }
    if (json && response.status >= 400) {
      throw new Error(
        `${errorMessage(response.data, "The server rejected the request")} (HTTP ${response.status})`,
      );
    }
    return response;
  };

  const builder = new NetworkClientBuilder()
    .setRateLimit(requests, interval)
    .addRequestInterceptor(interceptRequest)
    .addResponseInterceptor(interceptResponse);

  if (maxRetries !== undefined) builder.setMaxRetries(maxRetries);
  if (timeout !== undefined) builder.setTimeout(timeout);

  return builder.build();
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

export async function getText(client: NetworkClient, url: string): Promise<string> {
  try {
    return (await client.get(url)).data;
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
