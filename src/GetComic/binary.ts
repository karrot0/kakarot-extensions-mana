const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64ToBytes(str: string): Uint8Array | null {
  const clean = str.replace(/\s+/g, "");
  if (clean.length === 0 || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean))
    return null;

  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((clean.length / 4) * 3 - padding);

  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = BASE64_CHARS.indexOf(clean[i]);
    const c1 = BASE64_CHARS.indexOf(clean[i + 1]);
    const c2 = clean[i + 2] === "=" ? 0 : BASE64_CHARS.indexOf(clean[i + 2]);
    const c3 = clean[i + 3] === "=" ? 0 : BASE64_CHARS.indexOf(clean[i + 3]);
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) return null;

    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 16) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 8) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = triple & 0xff;
  }

  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chars: string[] = [];
  const len = bytes.length;

  for (let i = 0; i < len; i += 3) {
    const hasB1 = i + 1 < len;
    const hasB2 = i + 2 < len;
    const triple =
      (bytes[i] << 16) | ((hasB1 ? bytes[i + 1] : 0) << 8) | (hasB2 ? bytes[i + 2] : 0);

    chars.push(BASE64_CHARS[(triple >> 18) & 0x3f]);
    chars.push(BASE64_CHARS[(triple >> 12) & 0x3f]);
    chars.push(hasB1 ? BASE64_CHARS[(triple >> 6) & 0x3f] : "=");
    chars.push(hasB2 ? BASE64_CHARS[triple & 0x3f] : "=");
  }

  return chars.join("");
}
