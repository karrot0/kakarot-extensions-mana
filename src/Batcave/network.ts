import { type NetworkRequest, type NetworkResponse, NetworkClientBuilder } from "@mana-app/types";

export const BASE_URL = "https://batcave.biz";

function isBotCheckPage(html: string): boolean {
  return (
    /\.open\(\s*["']POST["']\s*,\s*["']\/_v["']\)/.test(html) ||
    (html.includes("pow_nonce") && html.includes("pow_hash"))
  );
}

export async function interceptRequest(request: NetworkRequest): Promise<NetworkRequest> {
  const referer = request.url.includes("readcomicsonline.ru")
    ? "https://readcomicsonline.ru"
    : BASE_URL;

  return {
    ...request,
    headers: {
      ...request.headers,
      origin: referer,
      referer,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
      "x-requested-with": "com.batcave.android",
    },
  };
}

export async function interceptResponse(response: NetworkResponse): Promise<NetworkResponse> {
  if (response.status === 403 || response.status === 503 || isBotCheckPage(response.data)) {
    throw new CloudflareError(BASE_URL);
  }
  return response;
}

export function buildClient(): NetworkClient {
  return new NetworkClientBuilder()
    .setRateLimit(5, 1)
    .addRequestInterceptor(interceptRequest)
    .addResponseInterceptor(interceptResponse)
    .build();
}
