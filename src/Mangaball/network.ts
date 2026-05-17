import { type NetworkRequest, type NetworkResponse, NetworkClientBuilder } from "@mana-app/types";

const BASE_URL = "https://mangaball.net";
const COOKIE_STORE_KEY = "mangaball.cookies";

async function getCookieJar(): Promise<Record<string, string>> {
  try {
    const raw = (await ObjectStore.get(COOKIE_STORE_KEY)) as Record<string, string> | null;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export async function setCookie(name: string, value: string): Promise<void> {
  const jar = await getCookieJar();
  jar[name] = value;
  await ObjectStore.set(COOKIE_STORE_KEY, jar);
}

export async function getCookie(name: string): Promise<string | undefined> {
  const jar = await getCookieJar();
  return jar[name];
}

async function getCookieHeader(): Promise<string> {
  const jar = await getCookieJar();
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function parseSetCookie(header: string): Promise<void> {
  const jar = await getCookieJar();
  let changed = false;
  for (const raw of header.split(/,(?=[^ ;]+=)/)) {
    const first = raw.split(";")[0].trim();
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name) {
      jar[name] = value;
      changed = true;
    }
  }
  if (changed) {
    await ObjectStore.set(COOKIE_STORE_KEY, jar);
  }
}

export async function interceptRequest(request: NetworkRequest): Promise<NetworkRequest> {
  const cookieHeader = await getCookieHeader();
  const headers: Record<string, string | number | boolean> = {
    ...request.headers,
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
  };
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  return {
    ...request,
    headers,
  };
}

export async function interceptResponse(response: NetworkResponse): Promise<NetworkResponse> {
  const cfMitigated = response.headers?.["cf-mitigated"];
  if (cfMitigated === "challenge" || response.status === 403) {
    throw new CloudflareError(BASE_URL);
  }

  const setCookieHeader = response.headers?.["set-cookie"] ?? response.headers?.["Set-Cookie"];
  if (setCookieHeader) {
    const raw = Array.isArray(setCookieHeader)
      ? setCookieHeader.join(",")
      : String(setCookieHeader);
    await parseSetCookie(raw);
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
