// @ts-check
"use strict";

/**
 * Host shims for running a built `.mana` bundle outside the Mana app.
 *
 * The bundle is self-contained JavaScript that ends in
 * `globalThis.Target = __exports__.Target` and expects the host to provide
 * `NetworkClient`, `CloudflareError`, `NetworkError`, `ObjectStore` and
 * `SecureStore` as globals. These implementations mirror the contract the
 * in-app runtime provides, backed by Node's `fetch`.
 */

const STATUS_MESSAGES = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found.",
  405: "Method Not Allowed",
  410: "Gone.",
  429: "Too Many Requests.",
  500: "Internal Server Error.",
  502: "Bad Gateway",
  503: "Service Unavailable.",
  504: "Gateway Timeout",
};

export class NetworkError extends Error {
  constructor(name, message, req, res) {
    super(message);
    this.name = name;
    this.req = req;
    this.res = res;
  }
}

export class CloudflareError extends Error {
  constructor(resolutionURL) {
    super(`Cloudflare challenge encountered${resolutionURL ? ` (${resolutionURL})` : ""}`);
    this.name = "CloudflareError";
    this.resolutionURL = resolutionURL;
  }
}

function buildUrl(url, params) {
  if (!params) return url;
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  if (entries.length === 0) return url;
  const query = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

async function applyAll(value, transformers) {
  let current = value;
  for (const transform of transformers) current = await transform(current);
  return current;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Reads the private fields `NetworkClientBuilder` sets. The builder ships in
 * `@mana-app/types` and calls `new NetworkClient(this)`, so the field names
 * here are the actual contract, not a guess.
 */
export class NetworkClient {
  constructor(builder) {
    this.requestTransformers = builder?.requestTransformers ?? [];
    this.responseTransformers = builder?.responseTransformers ?? [];
    this.baseHeaders = builder?.headers ?? {};
    this.cookies = builder?.cookies ?? [];
    this.timeout = builder?.timeout ?? 30_000;
    this.requestsPerSecond = builder?.requestsPerSecond ?? 0;
    this.statusValidator = builder?.statusValidator;
    this.maxRetries = builder?.maxRetries ?? 0;
    this.lastRequestAt = 0;
  }

  get(url, config = {}) {
    return this.request({ ...config, url, method: "GET" });
  }

  post(url, config = {}) {
    return this.request({ ...config, url, method: "POST" });
  }

  async request(req) {
    await this.throttle();

    const prepared = await applyAll(
      {
        ...req,
        headers: { ...this.baseHeaders, ...(req.headers ?? {}) },
      },
      [...this.requestTransformers, ...asArray(req.transformRequest)],
    );

    const target = buildUrl(prepared.url, prepared.params);
    const headers = {};
    for (const [key, value] of Object.entries(prepared.headers ?? {})) {
      headers[key] = String(value);
    }
    const cookies = [...this.cookies, ...(prepared.cookies ?? [])];
    if (cookies.length > 0) {
      headers.cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), prepared.timeout ?? this.timeout);

    let raw;
    try {
      raw = await fetch(target, {
        method: prepared.method ?? "GET",
        headers,
        body: prepared.body,
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await raw.text();
    const response = {
      data,
      status: raw.status,
      headers: Object.fromEntries(raw.headers.entries()),
      request: prepared,
    };

    const validate = prepared.validateStatus ?? this.statusValidator;
    const ok = validate ? validate(raw.status) : raw.status >= 200 && raw.status < 300;

    const transformed = await applyAll(response, [
      ...this.responseTransformers,
      ...asArray(prepared.transformResponse),
    ]);

    if (!ok) {
      throw new NetworkError(
        "NetworkError",
        STATUS_MESSAGES[raw.status] ?? `Request failed with status ${raw.status}`,
        prepared,
        transformed,
      );
    }

    return transformed;
  }

  async throttle() {
    if (!this.requestsPerSecond) return;
    const minGap = 1000 / this.requestsPerSecond;
    const wait = this.lastRequestAt + minGap - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
  }
}

/** In-memory stand-in for the app's key-value stores. */
export class ManaStore {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
  }

  async get(k) {
    return this.values.has(k) ? this.values.get(k) : null;
  }

  async set(k, v) {
    this.values.set(k, v);
  }

  async remove(k) {
    this.values.delete(k);
  }

  async string(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (typeof value !== "string") throw new Error(`${k} is not a string`);
    return value;
  }

  async boolean(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (typeof value !== "boolean") throw new Error(`${k} is not a boolean`);
    return value;
  }

  async number(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (typeof value !== "number") throw new Error(`${k} is not a number`);
    return value;
  }

  async stringArray(k) {
    const value = this.values.get(k);
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      throw new Error(`${k} is not a string array`);
    }
    return value;
  }
}

/** The intent bit layout the mana-dev runtime uses, in declaration order. */
export const INTENT_NAMES = [
  "preferenceMenuBuilder",
  "requiresSetup",
  "imageRequestHandler",
  "pageLinkResolver",
  "libraryPageLinkProvider",
  "authenticatable",
  "basicAuth",
  "basicAuthUsesEmail",
  "webviewAuth",
  "oauthAuth",
  "providesSearch",
  "providesSearchForm",
  "providesSearchSortOptions",
  "chapterEventHandler",
  "contentEventHandler",
  "librarySyncHandler",
  "pageReadHandler",
  "progressSyncHandler",
  "groupedUpdateFetcher",
  "redrawingHandler",
  "chaptersInContent",
  "providesChapters",
  "canHandleURL",
  "allowsMultipleInstances",
  "requiresAuthenticationToAccessContent",
];

export function decodeIntents(mask) {
  return INTENT_NAMES.filter((_, index) => (mask >> index) & 1);
}
