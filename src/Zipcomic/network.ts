import { type NetworkRequest, type NetworkResponse, NetworkClientBuilder } from "@mana-app/types";

export const BASE_URL = "https://www.zipcomic.com";

function isChallengePage(html: string): boolean {
  return (
    html.includes("Just a moment") ||
    html.includes("challenges.cloudflare.com") ||
    (html.includes("window.performance") && html.includes("crypto.subtle"))
  );
}

export async function interceptRequest(request: NetworkRequest): Promise<NetworkRequest> {
  return {
    ...request,
    headers: {
      ...request.headers,
      referer: `${BASE_URL}/`,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
    },
  };
}

export async function interceptResponse(response: NetworkResponse): Promise<NetworkResponse> {
  if (response.status === 403 || response.status === 503 || isChallengePage(response.data)) {
    throw new CloudflareError(BASE_URL);
  }
  return response;
}

export function buildClient(): NetworkClient {
  return new NetworkClientBuilder()
    .setRateLimit(4, 1)
    .addRequestInterceptor(interceptRequest)
    .addResponseInterceptor(interceptResponse)
    .build();
}
