// @ts-check
"use strict";

/**
 * Host shims for running a built `.mana` bundle outside the Mana app.
 *
 * The bundle is self-contained JavaScript that ends in
 * `globalThis.Target = __exports__.Target`. Its inlined `HttpClient` talks to
 * the host through `globalThis.__manaHTTPBridge`; the source also expects
 * `ObjectStore`, `SecureStore` and `WebViewPage` as globals. These
 * implementations mirror the contract the in-app runtime provides, backed by
 * Node's `fetch`.
 */

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

const Operation = {
  Fetch: 0,
  Read: 1,
  Release: 2,
  Cancel: 3,
  CreateBody: 4,
  RetainBody: 5,
  Invalidate: 6,
  BeginOperation: 7,
  EndOperation: 8,
};

const BODY_BYTES = 3;
const READER_BASE64 = 1;

function decodeStrictUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("String could not be serialized with encoding: Unicode (UTF-8)");
  }
}

/**
 * The host adapter `@mana-app/types` HttpClient calls. Bodies stay here,
 * keyed by id, until the bundle reads or releases them.
 */
export function createHttpBridge() {
  const bodies = new Map();
  const transfers = new Map();
  let nextId = 0;

  const store = (bytes) => {
    const bodyID = String(++nextId);
    bodies.set(bodyID, bytes);
    return { bodyID, sessionID: "harness" };
  };

  const fetchNative = async (message) => {
    const controller = new AbortController();
    if (message.requestID) transfers.set(message.requestID, controller);
    const timer = setTimeout(() => controller.abort(), message.timeoutMs ?? 30_000);
    try {
      const body =
        message.body === undefined
          ? undefined
          : message.bodyKind === BODY_BYTES
            ? Buffer.from(message.body, "base64")
            : message.body;
      const raw = await fetch(message.url, {
        method: METHODS[message.method] ?? "GET",
        headers: message.headers,
        body,
        redirect: "follow",
        signal: controller.signal,
      });
      const bytes = new Uint8Array(await raw.arrayBuffer());
      return {
        ...store(bytes),
        status: raw.status,
        url: raw.url || message.url,
        headers: Object.fromEntries(raw.headers.entries()),
      };
    } finally {
      clearTimeout(timer);
      if (message.requestID) transfers.delete(message.requestID);
    }
  };

  const read = (message) => {
    const bytes = bodies.get(message.bodyID);
    if (!bytes) throw new Error(`Response body ${message.bodyID} was released`);
    const value =
      message.reader === READER_BASE64
        ? Buffer.from(bytes).toString("base64")
        : decodeStrictUtf8(bytes);
    return { value };
  };

  return {
    now: () => Date.now(),
    async send(message) {
      switch (message.operation) {
        case Operation.Fetch:
          return fetchNative(message);
        case Operation.Read:
          return read(message);
        case Operation.Release:
          bodies.delete(message.bodyID);
          return {};
        case Operation.Cancel:
          transfers.get(message.requestID)?.abort();
          return {};
        case Operation.CreateBody:
          return store(new Uint8Array(Buffer.from(message.value, "base64")));
        default:
          return {};
      }
    },
  };
}

class WebViewPageShim {
  constructor(release) {
    this.release = release;
    this.html = "";
    this.closed = false;
  }

  async goto(url) {
    if (this.closed) throw new Error("WebView page is closed");
    const raw = await fetch(url, { redirect: "follow" });
    this.html = new TextDecoder("utf-8").decode(await raw.arrayBuffer());
  }

  async evaluateScript(script) {
    if (this.closed) throw new Error("WebView page is closed");
    if (!/document\.documentElement\.outerHTML/.test(script)) {
      throw new Error(`WebView shim cannot evaluate: ${script}`);
    }
    return this.html;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.release();
  }
}

export const WebViewPage = {
  active: false,
  async create() {
    if (WebViewPage.active) throw new Error("A WebView is already active for this source");
    WebViewPage.active = true;
    return new WebViewPageShim(() => {
      WebViewPage.active = false;
    });
  },
};

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
  "retired",
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
  "coverTransport",
  "pageTransport",
];

export function decodeIntents(mask) {
  return INTENT_NAMES.filter((_, index) => (mask >> index) & 1);
}
