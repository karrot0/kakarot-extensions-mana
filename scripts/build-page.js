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
try { pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")); } catch {}

const repoDisplayName = data.repositoryName ?? pkg.name ?? "Extensions";
const homepage = pkg.homepage ?? "";
const sourcesUrl = homepage
  ? homepage.replace(/\/?$/, "/main")
  : "https://your-pages-url/main";

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

const LANG_MAP = /** @type {Record<string,string>} */({
  en_US: "EN", en: "EN", ja_JP: "JA", ja: "JA", ko_KR: "KO", ko: "KO",
  zh_CN: "ZH", zh: "ZH", fr_FR: "FR", fr: "FR", de_DE: "DE", de: "DE",
  es_ES: "ES", es: "ES", pt_BR: "PT", pt: "PT", it_IT: "IT", it: "IT",
  ru_RU: "RU", ru: "RU", universal: "ALL",
});

/** @param {string[]} langs */
function langBadges(langs) {
  return (langs ?? []).map(l =>
    `<span class="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">${LANG_MAP[l] ?? l}</span>`
  ).join("");
}

// ── card ───────────────────────────────────────────────────────────────────

const BOOK_SVG = `<svg class="w-6 h-6" stroke="#71717a" viewBox="0 0 24 24" fill="none" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>`;

/** @param {any} s */
function sourceCard(s) {
  const devNames = (s.developers ?? []).map(/** @param {{name:string}} d */ d => d.name).join(", ");
  const iconFile = s.thumbnail ?? "icon.png";
  const thumbSrc = s.path ? `sources/${s.path}/${iconFile}` : "";
  const thumb = thumbSrc
    ? `<img src="${thumbSrc}" alt="${s.name}" class="w-full h-full object-cover rounded-lg" onerror="imgErr(this)" />`
    : BOOK_SVG;

  return `
<div class="group relative flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-600 hover:shadow-lg hover:shadow-black/40 transition-all duration-200">
  <div class="flex items-start gap-3.5 p-4 pb-3">
    <div class="w-12 h-12 rounded-lg bg-zinc-800 border border-zinc-700/50 flex items-center justify-center shrink-0 overflow-hidden">
      ${thumb}
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <h2 class="font-semibold text-sm text-zinc-100 leading-tight">${s.name}</h2>
        <span class="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">v${s.version ?? "?"}</span>
      </div>
      ${devNames ? `<p class="text-[11px] text-zinc-500 mt-0.5">${devNames}</p>` : ""}
    </div>
  </div>

  ${s.description ? `
  <div class="px-4 pb-3">
    <p class="text-xs text-zinc-400 leading-relaxed line-clamp-2">${s.description}</p>
  </div>` : ""}

  <div class="px-4 pb-4 flex flex-wrap items-center gap-1.5 mt-auto">
    ${ratingBadge(s.rating ?? 0)}
    ${langBadges(s.supportedLanguages ?? [])}
    ${s.website ? `
    <a href="${s.website}" target="_blank" rel="noopener"
       class="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/></svg>
      Site
    </a>` : ""}
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
    const destDir = path.join(distDir, "sources", s.path);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcIcon, path.join(destDir, iconFile));
  }
}

const cards = sources.map(sourceCard).join("\n");
const count = sources.length;
const built = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${repoDisplayName}</title>
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
        },
      },
    };
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
  <style>
    body { font-family: "Inter", ui-sans-serif, system-ui, sans-serif; }
    .line-clamp-2 { display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
    .truncate { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    #copy-btn.copied { color:#4ade80; }
  </style>
</head>
<body class="bg-zinc-950 text-zinc-50 min-h-screen antialiased">

  <!-- sticky header -->
  <header class="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
      <div class="flex items-center gap-2.5">
        <svg class="w-5 h-5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
        </svg>
        <span class="font-semibold text-sm text-zinc-100">${repoDisplayName}</span>
        <span class="hidden sm:inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
          ${count} extension${count !== 1 ? "s" : ""}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-zinc-600 hidden md:block">Built ${built}</span>
      </div>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">

    <!-- install banner -->
    <div class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div class="flex items-start gap-3">
        <div class="mt-0.5 w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
          <svg class="w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
        <div class="flex-1 min-w-0 space-y-2">
          <div>
            <p class="text-sm font-medium text-zinc-100">Add Repository to Mana</p>
            <p class="text-xs text-zinc-500 mt-0.5 flex items-center gap-1 flex-wrap">Copy the URL below and paste it in
              <span class="inline-flex items-center gap-0.5 text-zinc-400 font-medium">Mana
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
            <code class="flex-1 min-w-0 block text-xs font-mono text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 truncate">${sourcesUrl}</code>
            <button id="copy-btn"
              onclick="navigator.clipboard.writeText('${sourcesUrl}').then(()=>{const b=document.getElementById('copy-btn');b.classList.add('copied');b.querySelector('span').textContent='Copied!';setTimeout(()=>{b.classList.remove('copied');b.querySelector('span').textContent='Copy';},2000)})"
              class="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-zinc-100 transition-colors">
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
      <h1 class="text-base font-semibold text-zinc-100">
        Extensions
        <span class="ml-2 text-sm font-normal text-zinc-500">${count} available</span>
      </h1>
    </div>

    <!-- cards grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
${cards}
    </div>

  </main>

  <footer class="border-t border-zinc-800 mt-12">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
          </svg>
          <span class="text-xs font-medium text-zinc-500">${repoDisplayName}</span>
        </div>
        ${homepage ? `<a href="${homepage}" target="_blank" rel="noopener"
           class="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22"/>
          </svg>
          GitHub Pages
        </a>` : ""}
      </div>
      <span class="text-xs text-zinc-600">Built ${built}</span>
    </div>
  </footer>

</body>
</html>`;

fs.writeFileSync(path.join(distDir, "index.html"), html, "utf-8");
process.stdout.write("[mana-dev] \uD83C\uDF10 Generated dist/index.html\n");
