/**
 * A WASM-free, dependency-free reader for RAR archives whose entries are
 * stored (compression method "store" / `-m0`).
 *
 * Why this exists: this source runs in JavaScriptCore on iOS, where
 * `WebAssembly` may be entirely absent, and shipping the official unrar library
 * as an embedded base64 wasm blob cost every user ~270KB of bundle. Comic
 * pages are already-compressed JPEG/PNG, so packers gain little by
 * recompressing them, which makes a pure-JS reader for the store case worth
 * having and a full RAR decompressor unnecessary.
 *
 * Scope, deliberately narrow: this reads the RAR *container* only. Any entry
 * that is actually compressed, encrypted, or split across volumes is not
 * something this can produce bytes for, so the read fails with `null` rather
 * than returning a partial or corrupt page set. `null` is the only failure
 * signal -- nothing here throws, so callers fall back cleanly to the
 * download-links path.
 *
 * Constraints honoured: no WASM, no `Buffer`, no `fs`, no `TextDecoder` (not
 * guaranteed present in bare JavaScriptCore), no bit-shifts on values that can
 * exceed 32 bits.
 */

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif)$/i;

export interface RarStoreOptions {
  /**
   * Selects which entries the caller actually needs. Entries rejected here are
   * skipped entirely, and -- importantly -- are allowed to be compressed or
   * encrypted without failing the read. Defaults to "every file".
   */
  wanted?: (name: string) => boolean;
}

/** Result of a successful read: entry name -> zero-copy view into `bytes`. */
export type RarStoreEntries = Record<string, Uint8Array>;

const RAR4_SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];
const RAR5_SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];

/** 2**32, used to fold "high" 32-bit size halves in without shifting. */
const FOUR_GB = 4294967296;

/** RAR 4.x block types. */
const R4_HEAD_MAIN = 0x73;
const R4_HEAD_FILE = 0x74;
const R4_HEAD_ENDARC = 0x7b;

/** RAR 4.x main-header flags. */
const R4_MHD_VOLUME = 0x0001;
const R4_MHD_PASSWORD = 0x0080;

/** RAR 4.x file-header flags. */
const R4_LHD_SPLIT_BEFORE = 0x0001;
const R4_LHD_SPLIT_AFTER = 0x0002;
const R4_LHD_PASSWORD = 0x0004;
const R4_LHD_WINDOWMASK = 0x00e0;
const R4_LHD_DIRECTORY = 0x00e0;
const R4_LHD_LARGE = 0x0100;
const R4_LHD_UNICODE = 0x0200;
const R4_LONG_BLOCK = 0x8000;

/** RAR 4.x stores method as an ASCII digit; '0' means stored verbatim. */
const R4_METHOD_STORE = 0x30;

/** RAR 5.0 block types. */
const R5_TYPE_MAIN = 1;
const R5_TYPE_FILE = 2;
const R5_TYPE_ENCRYPTION = 4;
const R5_TYPE_ENDARC = 5;

/** RAR 5.0 common header flags. */
const R5_HFL_EXTRA = 0x0001;
const R5_HFL_DATA = 0x0002;
const R5_HFL_SPLIT_BEFORE = 0x0008;
const R5_HFL_SPLIT_AFTER = 0x0010;

/** RAR 5.0 file flags. */
const R5_FFL_DIRECTORY = 0x0001;
const R5_FFL_HAS_MTIME = 0x0002;
const R5_FFL_HAS_CRC32 = 0x0004;
const R5_FFL_UNKNOWN_SIZE = 0x0008;

/** RAR 5.0 archive flags. */
const R5_AFL_VOLUME = 0x0001;

/** RAR 5.0 extra-area record type for per-file encryption. */
const R5_EXTRA_ENCRYPTION = 1;

/** Vints wider than this cannot be represented exactly by a JS number. */
const MAX_VINT_BYTES = 10;

function matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/** True for either RAR 4.x or RAR 5.0 archives. */
export function isRarMagic(bytes: Uint8Array): boolean {
  return matchesSignature(bytes, RAR4_SIGNATURE) || matchesSignature(bytes, RAR5_SIGNATURE);
}

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

/** Unsigned -- `<< 24` would sign-flip, so the top byte is multiplied in. */
function u32(bytes: Uint8Array, at: number): number {
  return bytes[at] + bytes[at + 1] * 0x100 + bytes[at + 2] * 0x10000 + bytes[at + 3] * 0x1000000;
}

interface Vint {
  value: number;
  /** Offset just past the last byte consumed. */
  next: number;
}

/**
 * RAR 5.0 variable-length integer: little-endian, 7 payload bits per byte, top
 * bit set means "another byte follows".
 *
 * Accumulated with multiplication rather than `<<`, because RAR sizes routinely
 * exceed 32 bits and `<<` in JS coerces to int32 -- a 5-byte vint would wrap
 * and silently produce a garbage offset.
 */
function readVint(bytes: Uint8Array, at: number): Vint | null {
  let value = 0;
  let scale = 1;
  let pos = at;

  for (let i = 0; i < MAX_VINT_BYTES; i++) {
    if (pos >= bytes.length) return null;
    const byte = bytes[pos++];
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) {
      return Number.isSafeInteger(value) ? { value, next: pos } : null;
    }
    scale *= 128;
  }

  return null;
}

/**
 * Minimal UTF-8 decoder. `TextDecoder` is a WHATWG API supplied by the browser
 * environment, not by the JavaScriptCore engine itself, so it cannot be relied
 * on here. Malformed sequences become U+FFFD rather than failing the read -- a
 * mangled character in a page filename is harmless, since names are only used
 * for the extension test and sort order.
 */
function decodeUtf8(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  let i = start;

  while (i < end) {
    const b0 = bytes[i++];

    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      continue;
    }

    let codePoint = -1;
    if (b0 >= 0xc2 && b0 <= 0xdf && i < end) {
      const b1 = bytes[i];
      if ((b1 & 0xc0) === 0x80) {
        codePoint = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
        i += 1;
      }
    } else if (b0 >= 0xe0 && b0 <= 0xef && i + 1 < end) {
      const b1 = bytes[i];
      const b2 = bytes[i + 1];
      if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
        const cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
        // Reject overlongs and lone surrogates.
        if (cp >= 0x800 && (cp < 0xd800 || cp > 0xdfff)) codePoint = cp;
        i += 2;
      }
    } else if (b0 >= 0xf0 && b0 <= 0xf4 && i + 2 < end) {
      const b1 = bytes[i];
      const b2 = bytes[i + 1];
      const b3 = bytes[i + 2];
      if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80 && (b3 & 0xc0) === 0x80) {
        const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
        if (cp >= 0x10000 && cp <= 0x10ffff) codePoint = cp;
        i += 3;
      }
    }

    if (codePoint < 0) {
      out += "�";
    } else if (codePoint <= 0xffff) {
      out += String.fromCharCode(codePoint);
    } else {
      const offset = codePoint - 0x10000;
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    }
  }

  return out;
}

/** RAR 4.x names are bytes in an OEM codepage; ASCII is the portion we need. */
function decodeLatin1(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * RAR 4.x filename field. With `LHD_UNICODE` the field holds the ASCII name, a
 * NUL, then a RAR-specific (emphatically *not* UTF-8) compressed encoding of
 * the real Unicode name. Decoding that custom scheme buys nothing here: the
 * ASCII prefix is a complete, usable name for extension matching and page
 * ordering, so the field is truncated at the first NUL.
 */
function readRar4Name(bytes: Uint8Array, start: number, size: number, flags: number): string {
  let end = start + size;

  if ((flags & R4_LHD_UNICODE) !== 0) {
    for (let i = start; i < end; i++) {
      if (bytes[i] === 0x00) {
        end = i;
        break;
      }
    }
  }

  return decodeLatin1(bytes, start, end);
}

function normalizeName(name: string): string {
  return name.replace(/\\/g, "/");
}

function readRar4(bytes: Uint8Array, wanted: (name: string) => boolean): RarStoreEntries | null {
  const entries: RarStoreEntries = {};
  let pos = RAR4_SIGNATURE.length;
  let sawMain = false;

  while (pos + 7 <= bytes.length) {
    const headType = bytes[pos + 2];
    const flags = u16(bytes, pos + 3);
    const headSize = u16(bytes, pos + 5);

    // A block must be at least the 7-byte short header, otherwise the walk
    // cannot make forward progress and the file is not a RAR we understand.
    if (headSize < 7) return null;
    if (pos + headSize > bytes.length) return null;

    if (headType === R4_HEAD_ENDARC) break;

    let dataSize = 0;

    if (headType === R4_HEAD_MAIN) {
      sawMain = true;
      // Encrypted headers make every later offset unreadable; a volume member
      // cannot yield a complete page set.
      if ((flags & R4_MHD_PASSWORD) !== 0) return null;
      if ((flags & R4_MHD_VOLUME) !== 0) return null;
      if ((flags & R4_LONG_BLOCK) !== 0) {
        if (pos + 11 > bytes.length) return null;
        dataSize = u32(bytes, pos + 7);
      }
    } else if (headType === R4_HEAD_FILE) {
      if (headSize < 32 || pos + 32 > bytes.length) return null;

      let packSize = u32(bytes, pos + 7);
      let unpSize = u32(bytes, pos + 11);
      const method = bytes[pos + 25];
      const nameSize = u16(bytes, pos + 26);
      let nameStart = pos + 32;

      if ((flags & R4_LHD_LARGE) !== 0) {
        if (headSize < 40 || pos + 40 > bytes.length) return null;
        packSize += u32(bytes, pos + 32) * FOUR_GB;
        unpSize += u32(bytes, pos + 36) * FOUR_GB;
        nameStart = pos + 40;
      }

      if (nameStart + nameSize > pos + headSize) return null;

      const isDirectory = (flags & R4_LHD_WINDOWMASK) === R4_LHD_DIRECTORY;
      const name = normalizeName(readRar4Name(bytes, nameStart, nameSize, flags));

      if (!isDirectory && wanted(name)) {
        if ((flags & R4_LHD_PASSWORD) !== 0) return null;
        if ((flags & (R4_LHD_SPLIT_BEFORE | R4_LHD_SPLIT_AFTER)) !== 0) return null;
        if (method !== R4_METHOD_STORE) return null;
        // For a stored entry these must agree; if they disagree the header is
        // lying and the payload cannot be trusted.
        if (packSize !== unpSize) return null;

        const dataStart = pos + headSize;
        if (dataStart + packSize > bytes.length) return null;
        entries[name] = bytes.subarray(dataStart, dataStart + packSize);
      }

      dataSize = packSize;
    } else if ((flags & R4_LONG_BLOCK) !== 0) {
      if (pos + 11 > bytes.length) return null;
      dataSize = u32(bytes, pos + 7);
    }

    const next = pos + headSize + dataSize;
    if (next <= pos || next > bytes.length) return null;
    pos = next;
  }

  return sawMain ? entries : null;
}

interface Rar5Header {
  type: number;
  flags: number;
  extraSize: number;
  dataSize: number;
  /** Offset of the first type-specific field. */
  bodyStart: number;
  /** Offset just past the header (and so the start of the data area). */
  headerEnd: number;
  /** Offset just past the data area -- where the next block begins. */
  blockEnd: number;
}

function readRar5Header(bytes: Uint8Array, at: number): Rar5Header | null {
  // 4-byte header CRC32, then the header size vint.
  const sizeField = readVint(bytes, at + 4);
  if (!sizeField) return null;

  // `HeaderSize` is measured from the header-type field, i.e. from the byte
  // right after the size vint -- not from the start of the block.
  const headerStart = sizeField.next;
  const headerEnd = headerStart + sizeField.value;
  if (headerEnd > bytes.length || headerEnd <= at) return null;

  const type = readVint(bytes, headerStart);
  if (!type || type.next > headerEnd) return null;
  const flags = readVint(bytes, type.next);
  if (!flags || flags.next > headerEnd) return null;

  let cursor = flags.next;
  let extraSize = 0;
  let dataSize = 0;

  if ((flags.value & R5_HFL_EXTRA) !== 0) {
    const extra = readVint(bytes, cursor);
    if (!extra || extra.next > headerEnd) return null;
    extraSize = extra.value;
    cursor = extra.next;
  }

  if ((flags.value & R5_HFL_DATA) !== 0) {
    const data = readVint(bytes, cursor);
    if (!data || data.next > headerEnd) return null;
    dataSize = data.value;
    cursor = data.next;
  }

  if (extraSize > sizeField.value) return null;

  const blockEnd = headerEnd + dataSize;
  if (blockEnd > bytes.length || blockEnd <= at) return null;

  return {
    type: type.value,
    flags: flags.value,
    extraSize,
    dataSize,
    bodyStart: cursor,
    headerEnd,
    blockEnd,
  };
}

/**
 * Scans a RAR 5.0 extra area for a per-file encryption record. Returns `null`
 * if the area is malformed, which the caller treats the same as "encrypted" --
 * an unparseable extra area means the header's guarantees are unknown.
 */
function rar5HasEncryptionRecord(bytes: Uint8Array, header: Rar5Header): boolean | null {
  if (header.extraSize === 0) return false;

  let pos = header.headerEnd - header.extraSize;
  if (pos < header.bodyStart) return null;

  while (pos < header.headerEnd) {
    const size = readVint(bytes, pos);
    if (!size) return null;

    // Record size covers the type field and the record data, but not itself.
    const recordEnd = size.next + size.value;
    if (recordEnd > header.headerEnd || recordEnd <= pos) return null;

    const type = readVint(bytes, size.next);
    if (!type || type.next > recordEnd) return null;
    if (type.value === R5_EXTRA_ENCRYPTION) return true;

    pos = recordEnd;
  }

  return false;
}

function readRar5(bytes: Uint8Array, wanted: (name: string) => boolean): RarStoreEntries | null {
  const entries: RarStoreEntries = {};
  let pos = RAR5_SIGNATURE.length;
  let sawMain = false;

  while (pos + 4 < bytes.length) {
    const header = readRar5Header(bytes, pos);
    if (!header) return null;

    if (header.type === R5_TYPE_ENDARC) break;
    // A whole-archive encryption header means every following header is
    // ciphertext; there is nothing further to parse.
    if (header.type === R5_TYPE_ENCRYPTION) return null;

    if (header.type === R5_TYPE_MAIN) {
      sawMain = true;
      const archiveFlags = readVint(bytes, header.bodyStart);
      if (!archiveFlags) return null;
      if ((archiveFlags.value & R5_AFL_VOLUME) !== 0) return null;
    } else if (header.type === R5_TYPE_FILE) {
      const fileFlags = readVint(bytes, header.bodyStart);
      if (!fileFlags) return null;
      const unpackedSize = readVint(bytes, fileFlags.next);
      if (!unpackedSize) return null;
      const attributes = readVint(bytes, unpackedSize.next);
      if (!attributes) return null;

      let cursor = attributes.next;
      if ((fileFlags.value & R5_FFL_HAS_MTIME) !== 0) cursor += 4;
      if ((fileFlags.value & R5_FFL_HAS_CRC32) !== 0) cursor += 4;
      if (cursor > header.headerEnd) return null;

      const compInfo = readVint(bytes, cursor);
      if (!compInfo) return null;
      const hostOs = readVint(bytes, compInfo.next);
      if (!hostOs) return null;
      const nameLength = readVint(bytes, hostOs.next);
      if (!nameLength) return null;

      const nameStart = nameLength.next;
      const nameEnd = nameStart + nameLength.value;
      if (nameEnd > header.headerEnd) return null;

      const isDirectory = (fileFlags.value & R5_FFL_DIRECTORY) !== 0;
      const name = normalizeName(decodeUtf8(bytes, nameStart, nameEnd));

      if (!isDirectory && wanted(name)) {
        // Bits 7-9 select the compression method; 0 is store. Divided rather
        // than shifted because `compInfo` is a vint and may exceed 32 bits.
        const method = Math.floor(compInfo.value / 128) % 8;
        if (method !== 0) return null;

        if ((header.flags & (R5_HFL_SPLIT_BEFORE | R5_HFL_SPLIT_AFTER)) !== 0) return null;

        const encrypted = rar5HasEncryptionRecord(bytes, header);
        if (encrypted !== false) return null;

        if (
          (fileFlags.value & R5_FFL_UNKNOWN_SIZE) === 0 &&
          unpackedSize.value !== header.dataSize
        ) {
          return null;
        }

        if (header.headerEnd + header.dataSize > bytes.length) return null;
        entries[name] = bytes.subarray(header.headerEnd, header.headerEnd + header.dataSize);
      }
    }
    // Service blocks (comments, recovery records, NTFS streams) and any block
    // type RAR adds later need no special handling: the header already told us
    // how far to jump, data area included.

    if (header.blockEnd <= pos) return null;
    pos = header.blockEnd;
  }

  return sawMain ? entries : null;
}

/**
 * Reads the stored (uncompressed) entries out of a RAR 4.x or RAR 5.0 archive.
 *
 * Returns `null` -- never throws -- when the archive is not a RAR, is
 * structurally inconsistent, or when any *wanted* entry is compressed,
 * encrypted, or continues into another volume. Entries the `wanted` predicate
 * rejects are ignored entirely and cannot cause a failure.
 *
 * Returned values are zero-copy `subarray` views over `bytes`; keeping `bytes`
 * alive keeps them valid, and mutating `bytes` corrupts them.
 */
export function readRarStoreEntries(
  bytes: Uint8Array,
  options: RarStoreOptions = {},
): RarStoreEntries | null {
  const wanted = options.wanted ?? (() => true);

  try {
    if (matchesSignature(bytes, RAR5_SIGNATURE)) return readRar5(bytes, wanted);
    if (matchesSignature(bytes, RAR4_SIGNATURE)) return readRar4(bytes, wanted);
    return null;
  } catch {
    // Defensive: the walkers are written to return `null` on every malformed
    // input, but a caller must never see a throw from a corrupt download.
    return null;
  }
}

/**
 * Extracts the image entries from a RAR (.cbr) archive.
 *
 * Only image entries are required to be stored -- a compressed `ComicInfo.xml`
 * or readme sitting alongside stored pages is skipped rather than failing the
 * whole archive. Resolves to `null` (never throws) when the pages themselves
 * are compressed or encrypted, so callers fall back to the Download Links.
 */
export function extractRarImages(bytes: Uint8Array): Record<string, Uint8Array> | null {
  const entries = readRarStoreEntries(bytes, {
    wanted: (name) => IMAGE_EXTENSION.test(name),
  });
  if (!entries) return null;

  const images: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries)) {
    if (data.length > 0) images[name] = data;
  }

  return Object.keys(images).length > 0 ? images : null;
}
