import { createExtractorFromData } from "node-unrar-js";
import { UNRAR_WASM_BASE64 } from "./unrar-wasm.ts";
import { base64ToBytes } from "./binary.ts";

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif)$/i;

let wasmBinary: ArrayBuffer | undefined;

function isWebAssemblyAvailable(): boolean {
  return typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function getWasmBinary(): ArrayBuffer {
  if (!wasmBinary) {
    const bytes = base64ToBytes(UNRAR_WASM_BASE64);
    if (!bytes) throw new Error("Embedded unrar.wasm failed to decode");
    wasmBinary = toArrayBuffer(bytes);
  }
  return wasmBinary;
}

/**
 * Extracts the image entries from a RAR (.cbr) archive, using the official
 * unrar source compiled to WebAssembly. Whether this source runtime exposes
 * `WebAssembly` at all is unverified, so every failure mode here -- missing
 * WebAssembly, a corrupt/encrypted archive, an extraction error -- resolves
 * to `null` rather than throwing, so callers can fail safe to the existing
 * Download Links fallback instead of crashing the read attempt.
 */
export async function extractRarImages(
  bytes: Uint8Array,
): Promise<Record<string, Uint8Array> | null> {
  if (!isWebAssemblyAvailable()) return null;

  try {
    const extractor = await createExtractorFromData({
      data: toArrayBuffer(bytes),
      wasmBinary: getWasmBinary(),
    });

    const { files } = extractor.extract({
      files: (fileHeader) => !fileHeader.flags.directory && IMAGE_EXTENSION.test(fileHeader.name),
    });

    const entries: Record<string, Uint8Array> = {};
    for (const file of files) {
      if (file.extraction && file.extraction.length > 0) {
        entries[file.fileHeader.name] = file.extraction;
      }
    }

    return Object.keys(entries).length > 0 ? entries : null;
  } catch {
    return null;
  }
}

export function isRarMagic(bytes: Uint8Array): boolean {
  // "Rar!\x1A\x07" (RAR4) or "Rar!\x1A\x07\x01\x00" (RAR5)
  return (
    bytes.length >= 7 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x72 &&
    bytes[3] === 0x21 &&
    bytes[4] === 0x1a &&
    bytes[5] === 0x07
  );
}
