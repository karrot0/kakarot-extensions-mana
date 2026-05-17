import { type NetworkRequest, type NetworkResponse, NetworkClientBuilder } from "@mana-app/types";

export async function interceptRequest(request: NetworkRequest): Promise<NetworkRequest> {
  return {
    ...request,
    headers: {
      ...request.headers,
    },
  };
}

export async function interceptResponse(response: NetworkResponse): Promise<NetworkResponse> {
  if (response.status === 403) {
    throw new CloudflareError();
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
