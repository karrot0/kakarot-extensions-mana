import { type NetworkRequest, type NetworkResponse, NetworkClientBuilder } from "@mana-app/types";

export const BASE_URL = "https://batcave.biz";

const PAGE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";
const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

const CDN_ORIGINS = ["https://readcomicsonline.ru"];

function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

export function originFor(url: string): string {
  return CDN_ORIGINS.find((origin) => url.includes(hostOf(origin))) ?? BASE_URL;
}

export function buildImageRequest(imageURL: string): NetworkRequest {
  const origin = originFor(imageURL);

  return {
    url: imageURL,
    method: "GET",
    headers: {
      origin,
      referer: `${origin}/`,
      accept: IMAGE_ACCEPT,
      "accept-language": "en-US,en;q=0.5",
    },
  };
}

function isBotCheckPage(html: string): boolean {
  return (
    /\.open\(\s*["']POST["']\s*,\s*["']\/_v["']\)/.test(html) ||
    (html.includes("pow_nonce") && html.includes("pow_hash"))
  );
}

export async function interceptRequest(request: NetworkRequest): Promise<NetworkRequest> {
  const origin = originFor(request.url);

  return {
    ...request,
    headers: {
      origin,
      referer: `${origin}/`,
      accept: PAGE_ACCEPT,
      "accept-language": "en-US,en;q=0.5",
      "x-requested-with": "com.batcave.android",
      ...request.headers,
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
    .setRateLimit(10, 1)
    .addRequestInterceptor(interceptRequest)
    .addResponseInterceptor(interceptResponse)
    .build();
}
