import { unzipSync, type Unzipped } from "fflate";
import type { ChapterPage } from "@mana-app/types";
import { base64ToBytes, bytesToBase64 } from "./binary.ts";
import { extractRarImages, isRarMagic } from "./rar.ts";

/**
 * GetComics releases are occasionally full omnibuses/bundles that can run into
 * the gigabytes. Those are downloaded, not unpacked in-memory here.
 */
const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif)$/i;
const NESTED_ARCHIVE_EXTENSION = /\.(cbz|cbr|zip|rar)$/i;

/**
 * `console` is not part of the JavaScriptCore engine -- it exists only if the
 * host installs it, and Mana's type package does not declare one. Reached
 * through `globalThis` so its absence is a no-op rather than a ReferenceError.
 */
const logSink = (globalThis as { console?: { log?: (message: string) => void } }).console;

/**
 * A step-by-step record of one unpack attempt.
 *
 * Diagnostics go to two places on purpose. `console` is the convenient channel
 * but may not exist; the thrown error message always reaches the app UI. When
 * something fails in the field, the trace travels with the exception so the
 * cause is visible without a log viewer.
 */
class Trace {
  private readonly steps: string[] = [];

  add(step: string): void {
    this.steps.push(step);
    logSink?.log?.(`[GetComics] ${step}`);
  }

  toString(): string {
    return this.steps.join("\n  - ");
  }
}

export class UnreadableArchiveError extends Error {
  constructor(reason: string, trace: Trace) {
    super(`${reason}\n\nUnpack trace:\n  - ${trace.toString()}`);
  }
}

/**
 * Fetches a GetComics "DOWNLOAD NOW" archive and unpacks it into page images.
 *
 * The response body arrives through {@link NetworkResponse.data}, which is
 * typed as a plain `string` -- there is no documented binary/arraybuffer mode
 * for this client, so how it represents non-text bytes is unverified. Every
 * step here is written to fail closed (throw {@link UnreadableArchiveError})
 * rather than risk silently returning corrupt page data.
 */
export async function fetchArchivePages(
  client: NetworkClient,
  downloadUrl: string,
): Promise<ChapterPage[]> {
  const trace = new Trace();
  trace.add(`GET target: ${downloadUrl}`);

  const head = await client.request({ url: downloadUrl, method: "HEAD" });
  const expectedSize = parseContentLength(head?.headers);
  trace.add(
    `HEAD -> status=${head?.status ?? "?"} content-length=${expectedSize ?? "absent"} ` +
      `content-type=${headerValue(head?.headers, "content-type") ?? "absent"}`,
  );

  if (expectedSize !== undefined && expectedSize > MAX_ARCHIVE_BYTES) {
    throw new UnreadableArchiveError(
      `Archive exceeds the safe in-app unpacking size (${expectedSize} bytes > ${MAX_ARCHIVE_BYTES})`,
      trace,
    );
  }

  const response = await client.get(downloadUrl);
  const bodySize = expectedSize ?? parseContentLength(response?.headers);

  // `data` is described before it is dereferenced, and every field is reached
  // optionally. The host bridge marshals the body into a JS string, and a
  // binary body is exactly the case that can defeat it -- Swift's
  // `String(data:encoding:.utf8)` is failable and yields nil on bytes that are
  // not valid UTF-8. Touching `.length` first would throw a TypeError from
  // inside the trace message itself, losing the very diagnostic being built.
  trace.add(
    `GET -> status=${response?.status ?? "?"} body=${describeBody(response?.data)} ` +
      `content-length=${parseContentLength(response?.headers) ?? "absent"} ` +
      `response keys=[${Object.keys(response ?? {}).join(", ")}]`,
  );

  const data = response?.data;
  if (typeof data !== "string" || data.length === 0) {
    throw new UnreadableArchiveError(
      "The host returned no usable body for the archive. The bytes reached the " +
        "device (the transfer completed) but could not be represented as a JS " +
        "string, so nothing is recoverable in-source -- this needs a binary " +
        "response mode on the host side",
      trace,
    );
  }

  // The single most diagnostic number available: how the host marshalled the
  // body into a JS string. Only latin1 and base64 preserve the bytes; a UTF-8
  // decode destroys them before this code ever runs.
  trace.add(`transport: ${describeEncoding(data.length, bodySize)}`);
  trace.add(`first 16 code units: ${hexPreview(data, 16)}`);

  // A generous multiplier covers both the latin1 (~1x) and base64 (~1.34x)
  // encoding hypotheses below without needing to know which applies yet.
  if (data.length > MAX_ARCHIVE_BYTES * 1.4) {
    throw new UnreadableArchiveError(
      `Archive exceeds the safe in-app unpacking size (${data.length} code units)`,
      trace,
    );
  }

  const bytes = decodeArchiveBytes(data, bodySize, trace);
  if (!bytes) {
    throw new UnreadableArchiveError(
      "Could not decode the archive response into a zip/rar file",
      trace,
    );
  }

  const images = await extractImages(bytes, trace);
  if (!images) {
    throw new UnreadableArchiveError(
      "Archive did not contain a readable, unambiguous set of images",
      trace,
    );
  }

  trace.add(`encoding ${images.length} pages to base64`);
  return images.map((data) => ({ raw: bytesToBase64(data) }));
}

async function extractImages(bytes: Uint8Array, trace: Trace): Promise<Uint8Array[] | null> {
  const top = await extractArchiveEntries(bytes, trace, "top-level");
  if (!top) return null;

  const direct = sortedImageEntries(top);
  trace.add(
    `top-level: ${Object.keys(top).length} entries, ${direct.length} images` +
      `${direct.length === 0 ? ` (names: ${sampleNames(top)})` : ""}`,
  );
  if (direct.length > 0) return direct;

  // Some releases wrap a single issue's own .cbz/.cbr inside an outer folder
  // -- recurse exactly one level for that case. Bundles containing multiple
  // nested archives (e.g. a "#1-6" pack with one .cbr per issue) are
  // genuinely ambiguous -- there's no single chapter to map them to -- so
  // they're left to the caller's download-links fallback rather than guessed
  // at.
  const nestedNames = Object.keys(top).filter((name) => NESTED_ARCHIVE_EXTENSION.test(name));
  if (nestedNames.length !== 1) {
    trace.add(
      `nested archives found: ${nestedNames.length} -- need exactly 1 to recurse` +
        `${nestedNames.length > 1 ? ` (${nestedNames.slice(0, 5).join(", ")})` : ""}`,
    );
    return null;
  }

  trace.add(`recursing into nested archive: ${nestedNames[0]}`);
  const inner = await extractArchiveEntries(top[nestedNames[0]], trace, "nested");
  if (!inner) return null;

  const innerImages = sortedImageEntries(inner);
  trace.add(`nested: ${Object.keys(inner).length} entries, ${innerImages.length} images`);
  return innerImages.length > 0 ? innerImages : null;
}

async function extractArchiveEntries(
  bytes: Uint8Array,
  trace: Trace,
  label: string,
): Promise<Record<string, Uint8Array> | null> {
  if (isZipMagic(bytes)) {
    trace.add(`${label}: detected zip (${bytes.length} bytes)`);
    try {
      return unzipSync(bytes);
    } catch (error) {
      trace.add(`${label}: unzipSync failed -- ${errorText(error)}`);
      return null;
    }
  }

  if (isRarMagic(bytes)) {
    trace.add(`${label}: detected rar (${bytes.length} bytes)`);
    const entries = extractRarImages(bytes);
    if (!entries) {
      trace.add(
        `${label}: rar reader returned null -- pages are compressed, encrypted, ` +
          `or split across volumes (only store/-m0 is supported without WASM)`,
      );
    }
    return entries;
  }

  trace.add(`${label}: no zip or rar magic -- first bytes ${bytesHexPreview(bytes, 8)}`);
  return null;
}

function sortedImageEntries(entries: Unzipped | Record<string, Uint8Array>): Uint8Array[] {
  return Object.entries(entries)
    .filter(([name, data]) => data.length > 0 && IMAGE_EXTENSION.test(name))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map(([, data]) => data);
}

function decodeArchiveBytes(
  data: string,
  expectedSize: number | undefined,
  trace: Trace,
): Uint8Array | null {
  const latin1 = strToLatin1Bytes(data);
  if (isPlausibleArchive(latin1, expectedSize)) {
    trace.add(`decode: latin1 accepted (${latin1.length} bytes)`);
    return latin1;
  }
  trace.add(
    `decode: latin1 rejected -- length=${latin1.length} expected=${expectedSize ?? "unknown"} ` +
      `zip=${isZipMagic(latin1)} rar=${isRarMagic(latin1)}`,
  );

  const base64Decoded = base64ToBytes(data);
  if (base64Decoded && isPlausibleArchive(base64Decoded, expectedSize)) {
    trace.add(`decode: base64 accepted (${base64Decoded.length} bytes)`);
    return base64Decoded;
  }
  trace.add(
    base64Decoded
      ? `decode: base64 rejected -- length=${base64Decoded.length} ` +
          `expected=${expectedSize ?? "unknown"} zip=${isZipMagic(base64Decoded)} ` +
          `rar=${isRarMagic(base64Decoded)}`
      : `decode: base64 rejected -- body is not valid base64`,
  );

  return null;
}

/**
 * Classifies the host's byte-to-string marshalling from the size ratio alone.
 * The thresholds come from measuring each strategy against known binaries:
 * latin1 is 1:1, base64 is 4:3, a UTF-8 decode inflates well past that as
 * multi-byte sequences expand, and a C-string hop truncates at the first NUL.
 */
function describeEncoding(stringLength: number, byteLength: number | undefined): string {
  if (byteLength === undefined || byteLength === 0) {
    return "ratio=unknown (no content-length to compare against)";
  }

  // Both byte-preserving strategies have exact, closed-form lengths, so they
  // are tested for equality rather than with a tolerance band. A band would be
  // actively misleading here: a UTF-8 decode SHRINKS the string (each valid
  // multi-byte sequence collapses into one UTF-16 unit), so a body that
  // happens to hold few multi-byte runs lands within a hair of 1.0 and would
  // be reported as "bytes preserved" while actually being unrecoverable.
  const base64Length = Math.ceil(byteLength / 3) * 4;
  const ratio = (stringLength / byteLength).toFixed(4);

  let label: string;
  if (stringLength === byteLength) {
    label = "latin1 -- bytes preserved, unpacking should work";
  } else if (stringLength === base64Length) {
    label = "base64 -- bytes preserved, unpacking should work";
  } else if (stringLength < byteLength * 0.5) {
    label = "TRUNCATED (C-string hop stopping at a NUL) -- bytes lost at the host bridge";
  } else {
    label =
      "MANGLED (most likely a UTF-8 decode) -- bytes destroyed at the host bridge, " +
      `unrecoverable in JS; latin1 would be ${byteLength} and base64 ${base64Length}`;
  }

  return `ratio=${ratio} (${stringLength}/${byteLength}) -> ${label}`;
}

/**
 * Describes a response body without dereferencing it. Distinguishing "the host
 * gave us nothing" from "the host gave us a mangled string" matters: the first
 * is a host-side limitation with no in-source fix, the second is a decoding
 * problem this file can reason about.
 */
function describeBody(data: unknown): string {
  if (data === undefined) return "undefined -- host supplied no body";
  if (data === null) return "null -- host supplied no body";
  if (typeof data !== "string") return `${typeof data} -- expected a string`;
  if (data.length === 0) return "empty string -- host supplied no body";
  return `string of ${data.length} code units`;
}

/** Raw UTF-16 code units, so U+FFFD replacement chars show up as `fffd`. */
function hexPreview(data: string, count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(count, data.length); i++) {
    parts.push(data.charCodeAt(i).toString(16).padStart(2, "0"));
  }
  return parts.join(" ") || "(empty)";
}

function bytesHexPreview(bytes: Uint8Array, count: number): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(count, bytes.length); i++) {
    parts.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return parts.join(" ") || "(empty)";
}

function sampleNames(entries: Record<string, Uint8Array>): string {
  const names = Object.keys(entries).slice(0, 5);
  return names.length > 0 ? names.join(", ") : "(none)";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function strToLatin1Bytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

function isPlausibleArchive(bytes: Uint8Array, expectedSize: number | undefined): boolean {
  if (expectedSize !== undefined && bytes.length !== expectedSize) return false;
  return isZipMagic(bytes) || isRarMagic(bytes);
}

function isZipMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  return bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07;
}

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== lower) continue;
    const raw = headers[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return undefined;
}

function parseContentLength(headers: Record<string, unknown> | undefined): number | undefined {
  const value = headerValue(headers, "content-length");
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
