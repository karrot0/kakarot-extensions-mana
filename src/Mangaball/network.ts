import {
  type NetworkRequest,
  type NetworkResponse,
  NetworkClientBuilder
} from "@mana-app/types";

const BASE_URL = "https://mangaball.net";

export async function interceptRequest(request: NetworkRequest): Promise<NetworkRequest> {
  const headers: Record<string, string | number | boolean> = {
    ...request.headers,
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
  };
  return {
    ...request,
    headers,
  };
}

export async function interceptResponse(response: NetworkResponse): Promise<NetworkResponse> {
  const cfMitigated = response.headers?.["cf-mitigated"];
  if (cfMitigated === "challenge" || response.status === 403) {
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

export { BASE_URL };
