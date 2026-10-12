import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ctr } from "@noble/ciphers/aes.js";

const SALT = "NO57DoQRq7oxY3MCO5_SNw4_3vFRsUq7";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64.length; i++) table[BASE64.charCodeAt(i)] = i;
  return table;
})();

export type SessionKey = {
  mac: Uint8Array;
  offset: number;
};

export type ChapterResponse = {
  chapter?: {
    pages?: { src?: string; k?: string; n?: string; t?: string }[];
  };
};

function utf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    let code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      i += 1;
      code = 0x10000 + (((code & 0x3ff) << 10) | (value.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    }
  }
  return new Uint8Array(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    output += BASE64[b0 >> 2];
    output += BASE64[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    output += b1 === undefined ? "=" : BASE64[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    output += b2 === undefined ? "=" : BASE64[b2 & 63];
  }
  return output;
}

export function base64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    const c0 = BASE64_LOOKUP[padded.charCodeAt(i)] ?? 0;
    const c1 = BASE64_LOOKUP[padded.charCodeAt(i + 1)] ?? 0;
    const c2 = BASE64_LOOKUP[padded.charCodeAt(i + 2)] ?? 0;
    const c3 = BASE64_LOOKUP[padded.charCodeAt(i + 3)] ?? 0;
    bytes.push((c0 << 2) | (c1 >> 4));
    if (padded[i + 2] !== "=") bytes.push(((c1 & 15) << 4) | (c2 >> 2));
    if (padded[i + 3] !== "=") bytes.push(((c2 & 3) << 6) | c3);
  }
  return new Uint8Array(bytes);
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const output = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) output[i] = a[i] ?? 0 ^ (b[i % b.length] ?? 0);
  return output;
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(12);
  for (let i = 0; i < nonce.length; i++) nonce[i] = Math.floor(Math.random() * 256);
  return nonce;
}

export function deriveSessionKey(keyB64: string, now: number): SessionKey {
  const digest = sha256(utf8(`sign:${SALT}`));
  return {
    mac: xor(fromBase64(keyB64), digest),
    offset: now - Date.now(),
  };
}

export function signChapter(session: SessionKey, path: string): string {
  const timestamp = String(Date.now() + session.offset);
  const nonce = base64url(randomNonce());
  const signature = base64url(
    hmac(sha256, session.mac, utf8(`${timestamp}.${nonce}.${path}`)),
  ).slice(0, 32);
  return `v1.${timestamp}.${nonce}.${signature}`;
}

export function rewritePageKey(session: SessionKey, key: string, nonce: string): Uint8Array {
  const derived = hmac(sha256, session.mac, utf8(`page.${nonce}`));
  return xor(fromBase64(key), derived);
}

export function decryptPage(key: Uint8Array, nonce: string, ciphertext: Uint8Array): Uint8Array {
  const counter = new Uint8Array(16);
  counter.set(fromBase64(nonce).subarray(0, 8), 0);
  return ctr(key, counter).decrypt(ciphertext);
}
