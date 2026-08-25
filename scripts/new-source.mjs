// @ts-check
"use strict";

/**
 * Scaffolds a new source from src/Template.
 *
 *   node scripts/new-source.mjs <Name> --id <id> --url <https://site> [--description "..."]
 *
 * Copies the Template directory, rewrites the class name and `info` block,
 * seeds a CHANGELOG section in the exact format scripts/build-page.js parses,
 * and adds a README table row.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(ROOT, "src", "Template");

function parseArgs(argv) {
  const args = { name: undefined, id: undefined, url: undefined, description: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--id") args.id = argv[++i];
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--description") args.description = argv[++i];
    else if (!arg.startsWith("-") && !args.name) args.name = arg;
  }
  return args;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function hostOf(url) {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

const args = parseArgs(process.argv.slice(2));

if (!args.name) {
  console.error(
    'usage: node scripts/new-source.mjs <Name> --id <id> --url <https://site> [--description "..."]',
  );
  process.exit(2);
}
if (!/^[A-Z][A-Za-z0-9]*$/.test(args.name)) {
  fail(`"${args.name}" must be PascalCase with no spaces — it becomes the directory name`);
}

const name = args.name;
const id = (args.id ?? name.toLowerCase()).trim();
const url = (args.url ?? "").replace(/\/+$/, "");
const description = args.description ?? `Pulls comics from ${hostOf(url) || "the site"}`;

if (!url) fail("--url is required (the site's base URL, e.g. https://example.com)");
if (!/^https?:\/\//i.test(url)) fail(`--url must start with http:// or https:// (got "${url}")`);

const dest = path.join(ROOT, "src", name);
if (fs.existsSync(dest)) fail(`src/${name} already exists`);
if (!fs.existsSync(TEMPLATE)) fail("src/Template is missing — nothing to copy from");

// -- copy ------------------------------------------------------------------

fs.mkdirSync(dest, { recursive: true });
for (const entry of fs.readdirSync(TEMPLATE, { withFileTypes: true })) {
  const from = path.join(TEMPLATE, entry.name);
  const to = path.join(dest, entry.name);
  if (entry.isDirectory()) fs.cpSync(from, to, { recursive: true });
  else fs.copyFileSync(from, to);
}
fs.mkdirSync(path.join(dest, "assets"), { recursive: true });

// -- rewrite main.ts -------------------------------------------------------

const mainPath = path.join(dest, "main.ts");
let main = fs.readFileSync(mainPath, "utf-8");
main = main
  .replace(/class TemplateSource\b/, `class ${name}Source`)
  .replace(/extends TemplateSource\b/, `extends ${name}Source`)
  .replace(/id: "template",/, `id: "${id}",`)
  .replace(/name: "Template",/, `name: "${name}",`)
  .replace(/version: "[^"]*",/, 'version: "1.0.0",')
  .replace(/description: "[^"]*",/, `description: "${description.replace(/"/g, '\\"')}",`)
  .replace(/owningLinks: \[[^\]]*\],/, `owningLinks: ["${hostOf(url)}"],`);
fs.writeFileSync(mainPath, main, "utf-8");

// -- rewrite model.ts ------------------------------------------------------

const modelPath = path.join(dest, "model.ts");
let model = fs.readFileSync(modelPath, "utf-8");
model = model.replace(/export const BASE_URL = "[^"]*";/, `export const BASE_URL = "${url}";`);
fs.writeFileSync(modelPath, model, "utf-8");

// -- probe -----------------------------------------------------------------

const probeDir = path.join(ROOT, "scripts", "probes");
fs.mkdirSync(probeDir, { recursive: true });
fs.writeFileSync(
  path.join(probeDir, `${name}.json`),
  `${JSON.stringify({ query: "batman", contentId: "", chapterId: "" }, null, 2)}\n`,
  "utf-8",
);

// -- CHANGELOG -------------------------------------------------------------

const changelogPath = path.join(ROOT, "CHANGELOG.md");
if (fs.existsSync(changelogPath)) {
  const changelog = fs.readFileSync(changelogPath, "utf-8");
  if (!changelog.includes(`## ${name} (current:`)) {
    const today = new Date().toISOString().slice(0, 10);
    const section = `## ${name} (current: v1.0.0)\n\n### ${today}\n- Initial implementation.\n\n`;
    const firstSection = changelog.indexOf("\n## ");
    const updated =
      firstSection === -1
        ? `${changelog.trimEnd()}\n\n${section}`
        : `${changelog.slice(0, firstSection + 1)}${section}${changelog.slice(firstSection + 1)}`;
    fs.writeFileSync(changelogPath, updated, "utf-8");
  }
}

// -- README table ----------------------------------------------------------

const readmePath = path.join(ROOT, "README.md");
if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, "utf-8");
  const rowMarker = /\n\| (?!Name)(?!-)[^\n]*\|\n(?!\|)/;
  const row = `| ${name.padEnd(13)} | 1.0.0   | English  | Safe   |\n`;
  const lines = readme.split("\n");
  let lastRow = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\| \S/.test(lines[i]) && !/^\| Name/.test(lines[i]) && !/^\| -/.test(lines[i])) lastRow = i;
  }
  if (lastRow >= 0 && !readme.includes(`| ${name} `)) {
    lines.splice(lastRow + 1, 0, row.trimEnd());
    fs.writeFileSync(readmePath, lines.join("\n"), "utf-8");
  }
  void rowMarker;
}

console.log(`created src/${name}`);
console.log("");
console.log("next:");
console.log(`  1. drop an icon at src/${name}/assets/icon.png`);
console.log(`  2. fill in the selectors in src/${name}/main.ts and the filters in model.ts`);
console.log(`  3. put a real contentId/chapterId in scripts/probes/${name}.json`);
console.log(`  4. bun run typecheck && bun run build && bun run verify ${name}`);
