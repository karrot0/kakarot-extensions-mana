// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const cwd = process.cwd();
const distDir = path.join(cwd, "dist");
const sourcesPath = path.join(distDir, "sources.json");

if (!fs.existsSync(sourcesPath)) {
  process.stderr.write("[mana-dev] sources.json not found — skipping page generation\n");
  return;
}

/** @type {{ repositoryName?: string; sources: any[] }} */
let data;
try {
  data = JSON.parse(fs.readFileSync(sourcesPath, "utf-8"));
} catch {
  process.stderr.write("[mana-dev] Failed to parse sources.json — skipping page generation\n");
  return;
}

/** @type {any} */
let pkg = {};
try {
  pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8"));
} catch {}

/**
 * Parses CHANGELOG.md's `## Extension (current: vX.Y.Z)` / `### heading` /
 * `- item` structure. Wrapped bullet lines (indented continuation, no
 * leading "-") are folded back onto the previous item so authors can wrap
 * long entries in the source file without it showing up as a second bullet.
 * @param {string} markdown
 */
function parseChangelog(markdown) {
  /** @type {{ name: string; version: string; entries: { heading: string; items: string[] }[] }[]} */
  const extensions = [];
  let currentExt = /** @type {typeof extensions[number] | null} */ (null);
  let currentEntry = /** @type {typeof extensions[number]["entries"][number] | null} */ (null);

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    const extMatch = /^##\s+(.+?)\s*\(current:\s*v?([^)]+)\)\s*$/.exec(line);
    if (extMatch) {
      currentExt = {
        name: extMatch[1].trim(),
        version: extMatch[2].trim(),
        entries: [],
      };
      extensions.push(currentExt);
      currentEntry = null;
      continue;
    }

    const entryMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (entryMatch && currentExt) {
      currentEntry = { heading: entryMatch[1].trim(), items: [] };
      currentExt.entries.push(currentEntry);
      continue;
    }

    const itemMatch = /^-\s+(.+)$/.exec(line);
    if (itemMatch && currentEntry) {
      currentEntry.items.push(itemMatch[1].trim());
      continue;
    }

    if (currentEntry?.items.length && /^\s+\S/.test(rawLine)) {
      const items = currentEntry.items;
      items[items.length - 1] += ` ${line.trim()}`;
    }
  }

  return extensions;
}

/** @param {string} str */
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes text, then renders markdown `code` spans -- the only inline markdown a changelog entry needs. @param {string} text */
function renderInline(text) {
  return escapeHtml(text).replace(
    /`([^`]+)`/g,
    '<code class="px-1 py-0.5 rounded bg-ink-800 text-red-300 text-[11px] font-mono">$1</code>',
  );
}

/** @param {ReturnType<typeof parseChangelog>} extensions */
function changelogSection(extensions) {
  if (!extensions.length) return "";

  const blocks = extensions
    .map(
      (ext, i) => `
<details class="group rounded-xl border border-ink-800 bg-ink-900 overflow-hidden"${i === 0 ? " open" : ""}>
  <summary class="cursor-pointer select-none list-none flex items-center justify-between gap-3 px-4 py-3 hover:bg-red-950/30 transition-colors">
    <div class="flex items-center gap-2">
      <span class="text-sm font-semibold text-ink-100">${escapeHtml(ext.name)}</span>
      <span class="text-[10px] font-mono text-ink-500 bg-ink-800 px-1.5 py-0.5 rounded border border-ink-700">v${escapeHtml(ext.version)}</span>
    </div>
    <svg class="w-4 h-4 text-ink-500 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
  </summary>
  <div class="px-4 pb-4 space-y-4 border-t border-ink-800 pt-3">
    ${ext.entries
      .map(
        (entry) => `
    <div>
      <p class="text-xs font-medium text-ink-400 mb-1.5">${escapeHtml(entry.heading)}</p>
      <ul class="space-y-1">
        ${entry.items
          .map(
            (item) =>
              `<li class="text-xs text-ink-500 leading-relaxed pl-3 relative before:content-['—'] before:absolute before:left-0 before:text-red-800">${renderInline(item)}</li>`,
          )
          .join("\n        ")}
      </ul>
    </div>`,
      )
      .join("\n")}
  </div>
</details>`,
    )
    .join("\n");

  return `
    <!-- changelog -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h1 class="text-base font-semibold text-ink-100 border-l-2 border-red-600 pl-3">Changelog</h1>
        <a href="CHANGELOG.md" class="text-[11px] text-ink-500 hover:text-red-400 transition-colors">View raw</a>
      </div>
      <div class="space-y-2.5">
        ${blocks}
      </div>
    </div>`;
}

let changelogExtensions = /** @type {ReturnType<typeof parseChangelog>} */ ([]);
try {
  changelogExtensions = parseChangelog(fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf-8"));
} catch {
  process.stderr.write("[mana-dev] CHANGELOG.md not found -- skipping changelog section\n");
}

const repoDisplayName = data.repositoryName ?? pkg.name ?? "Extensions";
const homepage = pkg.homepage ?? "";
const sourcesUrl = homepage ? homepage.replace(/\/?$/, "/main") : "https://your-pages-url/main";
// Mana opens a preview card for this link; nothing is added until the user accepts.
const addRepoLink = `mana://add-repo?url=${encodeURIComponent(sourcesUrl)}&name=${encodeURIComponent(repoDisplayName)}`;

/**
 * Repo URL from package.json's `repository`, falling back to a GitHub Pages
 * homepage -- user.github.io/repo maps 1:1 onto github.com/user/repo.
 * @param {any} pkg @param {string} homepage
 */
function repoUrlFrom(pkg, homepage) {
  const declared =
    typeof pkg.repository === "string" ? pkg.repository : (pkg.repository?.url ?? "");
  if (declared) return declared.replace(/^git\+/, "").replace(/\.git$/, "");
  const pages = /^https?:\/\/([^.]+)\.github\.io\/([^/]+)/.exec(homepage);
  return pages ? `https://github.com/${pages[1]}/${pages[2]}` : "";
}

const repoUrl = repoUrlFrom(pkg, homepage);

/** @param {string} cls */
const cubeSvg = (cls) =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>`;

/** @param {string} cls */
const githubSvg = (cls) =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58l-.01-2.05c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016.01 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.22.7.83.58A12 12 0 0024 12.5C24 5.87 18.63.5 12 .5z"/></svg>`;

const sources = data.sources ?? [];

// ── helpers ────────────────────────────────────────────────────────────────

/** @param {number} rating */
function ratingBadge(rating) {
  if (rating === 2)
    return `<span class="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-950 text-red-400 border border-red-900">
      <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      NSFW</span>`;
  if (rating === 1)
    return `<span class="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-yellow-950 text-yellow-400 border border-yellow-900">
      <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Mixed</span>`;
  return `<span class="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-900">
    <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
    Safe</span>`;
}

const LANG_MAP = /** @type {Record<string,string>} */ ({
  en_US: "EN",
  en: "EN",
  ja_JP: "JA",
  ja: "JA",
  ko_KR: "KO",
  ko: "KO",
  zh_CN: "ZH",
  zh: "ZH",
  fr_FR: "FR",
  fr: "FR",
  de_DE: "DE",
  de: "DE",
  es_ES: "ES",
  es: "ES",
  pt_BR: "PT",
  pt: "PT",
  it_IT: "IT",
  it: "IT",
  ru_RU: "RU",
  ru: "RU",
  universal: "ALL",
});

/** @param {string[]} langs */
function langBadges(langs) {
  return (langs ?? [])
    .map(
      (l) =>
        `<span class="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-ink-800 text-ink-400 border border-ink-700">${LANG_MAP[l] ?? l}</span>`,
    )
    .join("");
}

// ── card ───────────────────────────────────────────────────────────────────

const BOOK_SVG = `<svg class="w-6 h-6" stroke="#71717a" viewBox="0 0 24 24" fill="none" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>`;

/** @param {any} s */
function sourceCard(s) {
  const devNames = (s.developers ?? [])
    .map(/** @param {{name:string}} d */ (d) => d.name)
    .join(", ");
  const thumbSrc = s.thumbnail ? `assets/${s.thumbnail}` : "";
  const thumb = thumbSrc
    ? `<img src="${thumbSrc}" alt="${s.name}" class="w-full h-full object-cover rounded-lg" onerror="imgErr(this)" />`
    : BOOK_SVG;

  return `
<div class="group relative flex flex-col bg-ink-900 border border-ink-800 rounded-xl overflow-hidden hover:border-red-800 hover:shadow-lg hover:shadow-red-950/50 transition-all duration-200">
  <div class="flex items-start gap-3.5 p-4 pb-3">
    <div class="w-12 h-12 rounded-lg bg-ink-800 border border-ink-700/50 flex items-center justify-center shrink-0 overflow-hidden">
      ${thumb}
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <h2 class="font-semibold text-sm text-ink-100 leading-tight">${s.name}</h2>
        <span class="text-[10px] font-mono text-ink-500 bg-ink-800 px-1.5 py-0.5 rounded border border-ink-700">v${s.version ?? "?"}</span>
      </div>
      ${devNames ? `<p class="text-[11px] text-ink-500 mt-0.5">${devNames}</p>` : ""}
    </div>
  </div>

  ${
    s.description
      ? `
  <div class="px-4 pb-3">
    <p class="text-xs text-ink-400 leading-relaxed line-clamp-2">${s.description}</p>
  </div>`
      : ""
  }

  <div class="px-4 pb-4 flex flex-wrap items-center gap-1.5 mt-auto">
    ${ratingBadge(s.rating ?? 0)}
    ${langBadges(s.supportedLanguages ?? [])}
    ${
      s.website
        ? `
    <a href="${s.website}" target="_blank" rel="noopener"
       class="ml-auto inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-red-400 transition-colors">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></svg>
      Site
    </a>`
        : ""
    }
  </div>
</div>`;
}

// ── background ─────────────────────────────────────────────────────────────

// The cats are rendered as colored ASCII for the empty gutters beside the content column.
// Each character takes the average color of the photo under it; its shape comes from brightness.
/**
 * One eye cell: how far it sits from the eye's middle row, the eye's half height, and the
 * lid look (fur color, fur glyph, lash-line color) taken from the fur around the eye.
 * @typedef {{ dy: number; half: number; fur: string; furCh: string; lash: string }} EyeCell
 */

// eyeTint says which colors are an eye for that photo: the first cat has a yellow-green and a
// blue eye, the gray cat has two olive rings. Anything else (fur, nose) is not an eye. peakEyes
// tests each cell's most eye-like pixel instead of its average, for the thin rings of the gray cat.
const ASCII_CATS = [
  {
    file: "assets/6c226d9a-9c2f-43d9-a89c-fecf0b97fd86.png",
    side: "right",
    peakEyes: false,
    eyeTint: (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) =>
      g - b > 25 && r - b > 25 ? "green" : b - r > 15 && b - g > 8 ? "blue" : null,
  },
  {
    file: "assets/gray-cat.png",
    side: "left",
    peakEyes: true,
    eyeTint: (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) =>
      g - b > 22 && r - b > 40 ? "green" : null,
  },
];
const ASCII_COLS = 96;
// No backtick, backslash, $, <, >, & here, so characters go into HTML unescaped.
const ASCII_RAMP = " .'^,:;Il!i~+_-?][1)(|tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW8%B@";

/**
 * Decodes an 8-bit RGB or RGBA PNG (no interlacing) into RGBA bytes.
 * @param {Buffer} buf
 */
function decodePng(buf) {
  let width = 0;
  let height = 0;
  let channels = 0;
  /** @type {Buffer[]} */
  const idat = [];
  for (let pos = 8; pos < buf.length; ) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only non-interlaced 8-bit PNGs are supported");
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!channels) throw new Error("only RGB and RGBA PNGs are supported");
    } else if (type === "IDAT") {
      idat.push(data);
    }
    pos += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = (cur[i] + pred) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * channels;
      out[o] = cur[s];
      out[o + 1] = cur[s + 1];
      out[o + 2] = cur[s + 2];
      out[o + 3] = channels === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }
  return { width, height, rgba: out };
}

/**
 * Groups [row, col] cells that touch each other, where cells within `gap` rows or columns
 * count as touching. Returns the groups largest first.
 * @param {[number, number][]} cells @param {number} gap
 * @returns {[number, number][][]}
 */
function touchingGroups(cells, gap) {
  const seen = new Set();
  /** @type {[number, number][][]} */
  const groups = [];
  for (const start of cells) {
    if (seen.has(start.join(","))) continue;
    seen.add(start.join(","));
    /** @type {[number, number][]} */
    const group = [start];
    for (let i = 0; i < group.length; i++) {
      for (const other of cells) {
        const key = other.join(",");
        if (seen.has(key)) continue;
        if (Math.max(Math.abs(other[0] - group[i][0]), Math.abs(other[1] - group[i][1])) <= gap) {
          seen.add(key);
          group.push(other);
        }
      }
    }
    groups.push(group);
  }
  return groups.sort((a, b) => b.length - a.length);
}

/** Renders the cat as colored ASCII (one <pre>-ready string), or "" if the image can't be read. */
function buildAsciiArt(cat) {
  let img;
  try {
    img = decodePng(fs.readFileSync(path.join(cwd, cat.file)));
  } catch (err) {
    process.stderr.write(`[mana-dev] ASCII art skipped: ${/** @type {Error} */ (err).message}\n`);
    return "";
  }

  const { width: W, rgba } = img;
  // Crop to the cutout so the empty transparent margin doesn't waste columns.
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < W; x++) {
      if (rgba[(y * W + x) * 4 + 3] <= 16) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const cellW = (x1 - x0 + 1) / ASCII_COLS;
  const cellH = cellW * 2; // terminal cells are about twice as tall as they are wide
  const rows = Math.floor((y1 - y0 + 1) / cellH);

  /** @type {{ ch: string; hex: string | null; tint: string | null; eye: EyeCell | null; rgb: number[] | null }[][]} */
  const grid = [];
  for (let r = 0; r < rows; r++) {
    /** @type {{ ch: string; hex: string | null; tint: string | null; eye: EyeCell | null; rgb: number[] | null }[]} */
    const line = [];
    for (let c = 0; c < ASCII_COLS; c++) {
      const sx0 = Math.floor(x0 + c * cellW);
      const sx1 = Math.min(x1 + 1, Math.floor(x0 + (c + 1) * cellW));
      const sy0 = Math.floor(y0 + r * cellH);
      const sy1 = Math.min(y1 + 1, Math.floor(y0 + (r + 1) * cellH));
      let R = 0;
      let G = 0;
      let B = 0;
      let A = 0;
      let n = 0;
      // The most eye-like opaque pixel: an iris ring is too thin to survive averaging.
      let peak = null;
      let peakScore = -Infinity;
      for (let y = sy0; y < sy1; y++) {
        for (let x = sx0; x < sx1; x++) {
          const i = (y * W + x) * 4;
          const a = rgba[i + 3];
          R += rgba[i] * a;
          G += rgba[i + 1] * a;
          B += rgba[i + 2] * a;
          A += a;
          n++;
          const score = rgba[i + 1] - rgba[i + 2] + (rgba[i] - rgba[i + 2]);
          if (a > 128 && score > peakScore) {
            peakScore = score;
            peak = [rgba[i], rgba[i + 1], rgba[i + 2]];
          }
        }
      }
      const coverage = n ? A / (n * 255) : 0;
      if (coverage < 0.2) {
        line.push({ ch: " ", hex: null, tint: null, eye: null, rgb: null });
        continue;
      }
      // Alpha-weighted average color of the cat under this cell.
      const cr = R / A;
      const cg = G / A;
      const cb = B / A;
      const luma = (0.299 * cr + 0.587 * cg + 0.114 * cb) / 255;
      const t = Math.min(1, Math.max(0, (luma * coverage - 0.08) / 0.92));
      const ch = ASCII_RAMP[Math.round(t * (ASCII_RAMP.length - 1))];
      // Quantize to 16 levels per channel so neighbouring cells merge into longer runs.
      const hex = [cr, cg, cb].map((v) => Math.round(v / 17).toString(16)).join("");
            const tint = cat.peakEyes
        ? peak && cat.eyeTint(peak[0], peak[1], peak[2])
        : cat.eyeTint(cr, cg, cb);
      line.push({ ch, hex, tint, eye: null, rgb: [cr, cg, cb] });
    }
    grid.push(line);
  }

  // Each eye is a box around its tinted cells, with an odd height so the middle row can
  // stand in for the closed lid. Every cell in the box can be covered by the lid.
  for (const tint of ["green", "blue"]) {
    /** @type {[number, number][]} */
    const found = [];
    grid.forEach((line, r) =>
      line.forEach((cell, c) => {
        if (cell.tint === tint) found.push([r, c]);
      }),
    );
    for (const cells of touchingGroups(found, 2).filter((group) => group.length >= 3).slice(0, 2)) {
      const top = Math.min(...cells.map(([r]) => r)) - 1;
      let bottom = Math.max(...cells.map(([r]) => r)) + 1;
      if ((bottom - top + 1) % 2 === 0) bottom++;
      const left = Math.min(...cells.map(([, c]) => c)) - 1;
      const right = Math.max(...cells.map(([, c]) => c)) + 1;
      const mid = (top + bottom) / 2;
      const half = (bottom - top) / 2;
    // The fur ring two cells around the box sets the lid's color and glyph, so it blends in.
    let fr = 0;
    let fg = 0;
    let fb = 0;
    let fn = 0;
    for (let r = Math.max(0, top - 2); r <= Math.min(grid.length - 1, bottom + 2); r++) {
      for (let c = Math.max(0, left - 2); c <= Math.min(grid[r].length - 1, right + 2); c++) {
        const inside = r >= top && r <= bottom && c >= left && c <= right;
        const rgb = grid[r][c].rgb;
        if (inside || !rgb || grid[r][c].tint) continue;
        fr += rgb[0];
        fg += rgb[1];
        fb += rgb[2];
        fn++;
      }
    }
    const furRgb = fn ? [fr / fn, fg / fn, fb / fn] : [200, 200, 200];
    const furLuma = (0.299 * furRgb[0] + 0.587 * furRgb[1] + 0.114 * furRgb[2]) / 255;
    const furT = Math.min(1, Math.max(0, (furLuma - 0.08) / 0.92));
    const look = {
      fur: `rgb(${furRgb.map(Math.round).join(",")})`,
      furCh: ASCII_RAMP[Math.round(furT * (ASCII_RAMP.length - 1))],
      // the lash line is the fur's own shadow, so it reads as a crease on the lid
      lash: `rgb(${furRgb.map((v) => Math.round(v * 0.3)).join(",")})`,
    };
      for (let r = Math.max(0, top); r <= Math.min(grid.length - 1, bottom); r++) {
        for (let c = Math.max(0, left); c <= Math.min(grid[r].length - 1, right); c++) {
          grid[r][c].eye = { dy: Math.abs(r - mid), half, ...look };
        }
      }
    }
  }

  // Blank rows at the top and bottom are dropped.
  const isBlank = (/** @type {{ ch: string; eye: unknown }[]} */ line) =>
    line.every((cell) => cell.ch === " " && !cell.eye);
  while (grid.length && isBlank(grid[0])) grid.shift();
  while (grid.length && isBlank(grid[grid.length - 1])) grid.pop();

  // The lid is fur-colored; the middle row of each eye is a dark lash line.
  /** @param {{ ch: string; hex: string | null; eye: EyeCell | null; rgb: number[] | null }} cell */
  const eyeCell = (cell) => {
    const { dy, half, fur, furCh, lash } = /** @type {EyeCell} */ (cell.eye);
    const open = cell.hex
      ? `<span class="o" style="color:#${cell.hex}">${cell.ch}</span>`
      : `<span class="o">${cell.ch}</span>`;
    const lid =
      dy === 0
        ? `<span class="l" style="color:${lash}">-</span>`
        : `<span class="l" style="color:${fur}">${furCh}</span>`;
    // --c: delay when the lid closes (outer rows first); --r: delay when it opens (middle first).
    return `<span class="ec" style="--c:${half - dy};--r:${dy}">${open}${lid}</span>`;
  };

  return grid
    .map((line) => {
      // Consecutive cells with the same color share one <span>.
      let html = "";
      let run = "";
      let runHex = null;
      const flush = () => {
        if (!run) return;
        html += runHex ? `<span style="color:#${runHex}">${run}</span>` : run;
        run = "";
      };
      for (const cell of line) {
        if (cell.eye) {
          flush();
          html += eyeCell(cell);
          continue;
        }
        if (cell.hex !== runHex) {
          flush();
          runHex = cell.hex;
        }
        run += cell.ch;
      }
      flush();
      return html;
    })
    .join("\n");
}

const asciiCats = ASCII_CATS.map((cat) => ({ side: cat.side, html: buildAsciiArt(cat) }));

// ── page ───────────────────────────────────────────────────────────────────

const cards = sources.map(sourceCard).join("\n");

const brandIcon = (() => {
  const brand = pkg.mana?.brandSource;
  const s = brand ? sources.find(/** @param {any} s */ (s) => s.path === brand) : sources[0];
  if (!s?.thumbnail) return "";
  return fs.existsSync(path.join(cwd, "assets", s.thumbnail)) ? `assets/${s.thumbnail}` : "";
})();

const count = sources.length;
const built = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${repoDisplayName}</title>
  ${
    brandIcon
      ? `<link rel="icon" href="${brandIcon}" />
  <link rel="apple-touch-icon" href="${brandIcon}" />`
      : ""
  }
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    function imgErr(el) {
      el.outerHTML = '<svg class="w-6 h-6" stroke="#71717a" viewBox="0 0 24 24" fill="none" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>';
    }
  </script>
  <script>
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          fontFamily: { sans: ["Inter","ui-sans-serif","system-ui","sans-serif"] },
          // Mirrors .github/assets/header.svg: text stays neutral, surfaces pick up its red-black.
          colors: {
            ink: {
              50: "#fafafa", 100: "#f4f4f5", 300: "#d4d4d8", 400: "#a1a1aa", 500: "#71717a",
              600: "#52525b", 700: "#3a2222", 800: "#261414", 900: "#160707", 950: "#0a0a0a",
            },
          },
        },
      },
    };
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
  <style>
    body { font-family: "Inter", ui-sans-serif, system-ui, sans-serif; background-color: #0a0a0a; }

    .bg { position: fixed; inset: 0; z-index: 1; overflow: hidden; pointer-events: none; }
    /* Each cat is about a third of the viewport wide (96 columns at 0.6em each). The script
       below moves them around the screen, so their position is set with transform. */
    .ascii { position: absolute; left: 0; top: 0; will-change: transform;
             margin: 0; font-family: ui-monospace, Consolas, "Courier New", monospace;
             font-size: calc(34vw / 57.6); line-height: 1; white-space: pre;
             opacity: .7; user-select: none; }
    @media (max-width: 900px) { .ascii { display: none; } }
    .ascii-left { opacity: 1; }
    /* Eyes: each cell is one character cell with the open glyph and the lid stacked on top.
       Hovering the cat (.lidded) fades the open glyphs out from the outside rows inward while
       the fur-colored lid fades in, so the eyes close from top and bottom into a lash line. */
    .ascii .ec { display: inline-grid; vertical-align: top; }
    .ascii .ec > span { grid-area: 1 / 1; transition: opacity .12s linear; }
    .ascii .ec .o { opacity: 1; transition-delay: calc(var(--r) * 45ms); }
    .ascii .ec .l { opacity: 0; transition-delay: calc(var(--r) * 45ms); }
    .ascii.lidded .ec .o { opacity: 0; transition-delay: calc(var(--c) * 45ms); }
    .ascii.lidded .ec .l { opacity: 1; transition-delay: calc(var(--c) * 45ms); }
    @media (prefers-reduced-motion: reduce) { .ascii .ec > span { transition: none; } }
    ::selection { background: #dc2626; color: #fff; }
    .line-clamp-2 { display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
    .truncate { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    #copy-btn.copied { background:#7f1d1d; border-color:#7f1d1d; }
  </style>
</head>
<body class="bg-ink-950 text-ink-50 min-h-screen antialiased pt-[4.25rem] sm:pt-[4.5rem]">
  <div class="bg" aria-hidden="true">${asciiCats.map((cat) => `<pre class="ascii ascii-${cat.side}" aria-hidden="true">${cat.html}</pre>`).join("")}</div>

  <!-- floating header -->
  <header class="fixed inset-x-0 top-3 sm:top-4 z-20 px-3 sm:px-6">
    <div class="max-w-5xl mx-auto h-14 px-4 sm:px-5 flex items-center justify-between gap-4 rounded-2xl border border-ink-800 bg-ink-950/80 backdrop-blur-md shadow-lg shadow-black/50">
      <div class="flex items-center gap-2.5">
        ${
          brandIcon
            ? `<img src="${brandIcon}" alt="" class="w-6 h-6 rounded-md object-cover shrink-0 ring-1 ring-red-600/70" />`
            : cubeSvg("w-5 h-5 text-ink-400 shrink-0")
        }
        <span class="font-semibold text-sm text-ink-100">${repoDisplayName}</span>
        <span class="hidden sm:inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-950/60 text-red-300 border border-red-900/70">
          ${count} extension${count !== 1 ? "s" : ""}
        </span>
      </div>
      <div class="flex items-center gap-2.5">
        <span class="text-[11px] text-ink-600 hidden md:block">Built ${built}</span>
        ${
          repoUrl
            ? `<a href="${repoUrl}" target="_blank" rel="noopener" aria-label="View source on GitHub"
           class="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-ink-900 hover:bg-red-950/40 border border-ink-800 hover:border-red-700 text-ink-400 hover:text-white transition-colors">
          ${githubSvg("w-4 h-4 shrink-0")}
          <span class="hidden sm:inline">GitHub</span>
        </a>`
            : ""
        }
      </div>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">

    <!-- install banner -->
    <div class="rounded-xl border border-ink-800 bg-ink-900 p-4">
      <div class="flex items-start gap-3">
        <div class="mt-0.5 w-8 h-8 rounded-lg bg-red-600/15 border border-red-800/60 flex items-center justify-center shrink-0">
          <svg class="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
        <div class="flex-1 min-w-0 space-y-2">
          <div>
            <p class="text-sm font-medium text-ink-100">Add Repository to Mana</p>
            <p class="text-xs text-ink-500 mt-0.5 flex items-center gap-1 flex-wrap">Tap Open in Mana, or copy the URL below and paste it in
              <span class="inline-flex items-center gap-0.5 text-ink-400 font-medium">Mana
                <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                Discover
                <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                Repositories
                <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                Add Repo
              </span>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <code class="flex-1 min-w-0 block text-xs font-mono text-ink-300 bg-ink-950 border border-ink-800 rounded-lg px-3 py-2 truncate">${sourcesUrl}</code>
            <button id="copy-btn"
              onclick="navigator.clipboard.writeText('${sourcesUrl}').then(()=>{const b=document.getElementById('copy-btn');b.classList.add('copied');b.querySelector('span').textContent='Copied!';setTimeout(()=>{b.classList.remove('copied');b.querySelector('span').textContent='Copy';},2000)})"
              class="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 border border-red-500 text-white transition-colors">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
              <span>Copy</span>
            </button>
            <a href="${addRepoLink.replace(/&/g, "&amp;")}"
              class="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-ink-900 hover:bg-red-950/40 border border-ink-800 hover:border-red-700 text-ink-300 hover:text-white transition-colors">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              <span class="hidden sm:inline">Open in Mana</span><span class="sm:hidden">Open</span>
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- section heading -->
    <div class="flex items-center justify-between">
      <h1 class="text-base font-semibold text-ink-100 border-l-2 border-red-600 pl-3">
        Extensions
        <span class="ml-2 text-sm font-normal text-ink-500">${count} available</span>
      </h1>
    </div>

    <!-- cards grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
${cards}
    </div>
${changelogSection(changelogExtensions)}
  </main>

  <footer class="border-t border-ink-800 mt-12">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2">
          ${cubeSvg("w-4 h-4 text-ink-600")}
          <span class="text-xs font-medium text-ink-500">${repoDisplayName}</span>
        </div>
        ${
          homepage
            ? `<a href="${homepage}" target="_blank" rel="noopener"
           class="inline-flex items-center gap-1.5 text-xs text-ink-600 hover:text-red-400 transition-colors">
          ${githubSvg("w-3.5 h-3.5")}
          GitHub Pages
        </a>`
            : ""
        }
      </div>
      <span class="text-xs text-ink-600">Built ${built}</span>
    </div>
  </footer>

  <script>
    (function () {
      var SPEED = 80; // px per second
      var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var pointer = null;
      var state = [].slice.call(document.querySelectorAll(".ascii")).map(function (el) {
        return { el: el, x: 0, y: 0, vx: 0, vy: 0, w: el.offsetWidth, h: el.offsetHeight };
      });

      // Each cat starts on its own side, moving on a random diagonal.
      state.forEach(function (s) {
        s.x = s.el.classList.contains("ascii-left") ? 16 : innerWidth - s.w - 16;
        s.y = (innerHeight - s.h) / 2;
        var angle = Math.PI / 6 + (Math.random() * Math.PI) / 3;
        s.vx = (Math.random() < 0.5 ? -1 : 1) * SPEED * Math.cos(angle);
        s.vy = (Math.random() < 0.5 ? -1 : 1) * SPEED * Math.sin(angle);
      });

      function inside(el, x, y) {
        var b = el.getBoundingClientRect();
        return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
      }
      function hover() {
        state.forEach(function (s) {
          s.el.classList.toggle("lidded", !!pointer && inside(s.el, pointer.x, pointer.y));
        });
      }
      function draw() {
        state.forEach(function (s) {
          s.el.style.transform = "translate3d(" + s.x + "px," + s.y + "px,0)";
        });
      }

      // A cat's collision box is its art's silhouette, a little inside its full box.
      function box(s) {
        return { x: s.x + s.w * 0.08, y: s.y + s.h * 0.08, w: s.w * 0.84, h: s.h * 0.84 };
      }
      // Touching cats trade their velocity along the axis they hit on, like equal-mass balls.
      function collide(a, b) {
        var A = box(a);
        var B = box(b);
        var ox = Math.min(A.x + A.w - B.x, B.x + B.w - A.x);
        var oy = Math.min(A.y + A.h - B.y, B.y + B.h - A.y);
        if (ox <= 0 || oy <= 0) return;
        if (ox < oy) {
          var nx = A.x + A.w / 2 < B.x + B.w / 2 ? -1 : 1;
          if ((a.vx - b.vx) * nx < 0) {
            var tx = a.vx;
            a.vx = b.vx;
            b.vx = tx;
          }
          a.x += (nx * ox) / 2;
          b.x -= (nx * ox) / 2;
        } else {
          var ny = A.y + A.h / 2 < B.y + B.h / 2 ? -1 : 1;
          if ((a.vy - b.vy) * ny < 0) {
            var ty = a.vy;
            a.vy = b.vy;
            b.vy = ty;
          }
          a.y += (ny * oy) / 2;
          b.y -= (ny * oy) / 2;
        }
      }

      var last = 0;
      function step(now) {
        var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
        last = now;
        var vw = innerWidth;
        var vh = innerHeight;
        state.forEach(function (s) {
          s.w = s.el.offsetWidth;
          s.h = s.el.offsetHeight;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          // Bounce off each edge; a cat that hits two edges at once bounces off a corner.
          if (s.x < 0) {
            s.x = 0;
            s.vx = Math.abs(s.vx);
          }
          if (s.x + s.w > vw) {
            s.x = Math.max(0, vw - s.w);
            s.vx = -Math.abs(s.vx);
          }
          if (s.y < 0) {
            s.y = 0;
            s.vy = Math.abs(s.vy);
          }
          if (s.y + s.h > vh) {
            s.y = Math.max(0, vh - s.h);
            s.vy = -Math.abs(s.vy);
          }
        });
        if (state.length === 2) collide(state[0], state[1]);
        draw();
        hover();
        requestAnimationFrame(step);
      }

      draw();
      if (!reduceMotion) requestAnimationFrame(step);

      document.addEventListener("pointermove", function (e) {
        pointer = { x: e.clientX, y: e.clientY };
        hover();
      });
      document.documentElement.addEventListener("pointerleave", function () {
        pointer = null;
        hover();
      });
    })();
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(distDir, "index.html"), html, "utf-8");

// Copied alongside index.html so the "View raw" changelog link resolves on GitHub Pages too.
const changelogSrc = path.join(cwd, "CHANGELOG.md");
if (fs.existsSync(changelogSrc)) {
  fs.copyFileSync(changelogSrc, path.join(distDir, "CHANGELOG.md"));
}

process.stdout.write("[mana-dev] \uD83C\uDF10 Generated dist/index.html\n");
