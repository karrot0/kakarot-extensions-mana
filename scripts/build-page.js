// @ts-check
"use strict";

const fs = require("fs");
const path = require("path");

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
  const iconFile = s.thumbnail ?? "icon.png";
  const thumbSrc = s.path ? `sources/${s.path}/${iconFile}` : "";
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

// ── page ───────────────────────────────────────────────────────────────────

// Copy source icons into dist/sources/<path>/ so they're reachable
for (const s of sources) {
  if (!s.path) continue;
  const iconFile = s.thumbnail ?? "icon.png";
  const srcIcon = path.join(cwd, "src", s.path, iconFile);
  if (fs.existsSync(srcIcon)) {
    const destPath = path.join(distDir, "sources", s.path, iconFile);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcIcon, destPath);
  }
}

const cards = sources.map(sourceCard).join("\n");

const brandIcon = (() => {
  const brand = pkg.mana?.brandSource;
  const s = brand ? sources.find(/** @param {any} s */ (s) => s.path === brand) : sources[0];
  if (!s?.path) return "";
  const iconFile = s.thumbnail ?? "icon.png";
  return fs.existsSync(path.join(cwd, "src", s.path, iconFile))
    ? `sources/${s.path}/${iconFile}`
    : "";
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

    /* Ambient background: three soft red blobs drifting on slow, offset loops over the
       banner's #0a0a0a -> #160707 base. Motion is on transform only, so it composites on
       the GPU and never repaints the page. Blurring is done on the blob, not the layer. */
    .bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none;
          background: linear-gradient(135deg, #0a0a0a 0%, #160707 100%); }
    .bg::after { content: ""; position: absolute; inset: 0;
          background: radial-gradient(ellipse at center, transparent 55%, rgba(10,10,10,.4) 100%); }
    .blob { position: absolute; width: 60vmax; height: 60vmax; border-radius: 50%;
            filter: blur(70px); opacity: .8; will-change: transform; }
    .blob-1 { top: -30vmax; right: -20vmax;
              background: radial-gradient(circle, rgba(220,38,38,.75), rgba(220,38,38,0) 70%);
              animation: drift-1 16s ease-in-out infinite; }
    .blob-2 { bottom: -35vmax; left: -25vmax;
              background: radial-gradient(circle, rgba(153,27,27,.7), rgba(153,27,27,0) 70%);
              animation: drift-2 20s ease-in-out infinite; }
    .blob-3 { top: 30%; left: 35%; width: 45vmax; height: 45vmax; opacity: .5;
              background: radial-gradient(circle, rgba(239,68,68,.6), rgba(239,68,68,0) 70%);
              animation: drift-3 24s ease-in-out infinite; }
    @keyframes drift-1 { 0%,100% { transform: translate(0,0) scale(1); }
                          50%     { transform: translate(-18vw, 22vh) scale(1.15); } }
    @keyframes drift-2 { 0%,100% { transform: translate(0,0) scale(1); }
                          50%     { transform: translate(22vw, -20vh) scale(1.1); } }
    @keyframes drift-3 { 0%,100% { transform: translate(0,0) scale(1); }
                          33%     { transform: translate(-16vw, -14vh) scale(1.2); }
                          66%     { transform: translate(14vw, 12vh) scale(.9); } }
    @media (prefers-reduced-motion: reduce) { .blob { animation: none; } }
    ::selection { background: #dc2626; color: #fff; }
    .line-clamp-2 { display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
    .truncate { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    #copy-btn.copied { background:#7f1d1d; border-color:#7f1d1d; }
  </style>
</head>
<body class="bg-ink-950 text-ink-50 min-h-screen antialiased pt-[4.25rem] sm:pt-[4.5rem]">
  <div class="bg" aria-hidden="true"><div class="blob blob-1"></div><div class="blob blob-2"></div><div class="blob blob-3"></div></div>

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
            <p class="text-xs text-ink-500 mt-0.5 flex items-center gap-1 flex-wrap">Copy the URL below and paste it in
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

</body>
</html>`;

fs.writeFileSync(path.join(distDir, "index.html"), html, "utf-8");

// Copied alongside index.html so the "View raw" changelog link resolves on GitHub Pages too.
const changelogSrc = path.join(cwd, "CHANGELOG.md");
if (fs.existsSync(changelogSrc)) {
  fs.copyFileSync(changelogSrc, path.join(distDir, "CHANGELOG.md"));
}

process.stdout.write("[mana-dev] \uD83C\uDF10 Generated dist/index.html\n");
