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

export class UnreadableArchiveError extends Error {}

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
  const head = await client.request({ url: downloadUrl, method: "HEAD" });
  const expectedSize = parseContentLength(head.headers);
  if (expectedSize !== undefined && expectedSize > MAX_ARCHIVE_BYTES) {
    throw new UnreadableArchiveError("Archive exceeds the safe in-app unpacking size");
  }

  const response = await client.get(downloadUrl);
  // A generous multiplier covers both the latin1 (~1x) and base64 (~1.34x)
  // encoding hypotheses below without needing to know which applies yet.
  if (response.data.length > MAX_ARCHIVE_BYTES * 1.4) {
    throw new UnreadableArchiveError("Archive exceeds the safe in-app unpacking size");
  }

  const bytes = decodeArchiveBytes(
    response.data,
    expectedSize ?? parseContentLength(response.headers),
  );
  if (!bytes) {
    throw new UnreadableArchiveError("Could not decode the archive response into a zip/rar file");
  }

  const images = await extractImages(bytes);
  if (!images) {
    throw new UnreadableArchiveError(
      "Archive did not contain a readable, unambiguous set of images",
    );
  }

  return images.map((data) => ({ raw: bytesToBase64(data) }));
}

async function extractImages(bytes: Uint8Array): Promise<Uint8Array[] | null> {
  const top = await extractArchiveEntries(bytes);
  if (!top) return null;

  const direct = sortedImageEntries(top);
  if (direct.length > 0) return direct;

  // Some releases wrap a single issue's own .cbz/.cbr inside an outer folder
  // -- recurse exactly one level for that case. Bundles containing multiple
  // nested archives (e.g. a "#1-6" pack with one .cbr per issue) are
  // genuinely ambiguous -- there's no single chapter to map them to -- so
  // they're left to the caller's download-links fallback rather than guessed
  // at.
  const nestedNames = Object.keys(top).filter((name) => NESTED_ARCHIVE_EXTENSION.test(name));
  if (nestedNames.length !== 1) return null;

  const inner = await extractArchiveEntries(top[nestedNames[0]]);
  if (!inner) return null;

  const innerImages = sortedImageEntries(inner);
  return innerImages.length > 0 ? innerImages : null;
}

async function extractArchiveEntries(
  bytes: Uint8Array,
): Promise<Record<string, Uint8Array> | null> {
  if (isZipMagic(bytes)) {
    try {
      return unzipSync(bytes);
    } catch {
      return null;
    }
  }

  if (isRarMagic(bytes)) {
    return extractRarImages(bytes);
  }

  return null;
}

function sortedImageEntries(entries: Unzipped | Record<string, Uint8Array>): Uint8Array[] {
  return Object.entries(entries)
    .filter(([name, data]) => data.length > 0 && IMAGE_EXTENSION.test(name))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map(([, data]) => data);
}

function decodeArchiveBytes(data: string, expectedSize: number | undefined): Uint8Array | null {
  const latin1 = strToLatin1Bytes(data);
  if (isPlausibleArchive(latin1, expectedSize)) return latin1;

  const base64Decoded = base64ToBytes(data);
  if (base64Decoded && isPlausibleArchive(base64Decoded, expectedSize)) return base64Decoded;

  return null;
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

function parseContentLength(headers: Record<string, unknown> | undefined): number | undefined {
  if (!headers) return undefined;
  const raw = headers["content-length"] ?? headers["Content-Length"] ?? headers["Content-length"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
