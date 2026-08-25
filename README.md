<div align="center">
  <h1>Kakarot Extensions</h1>
  <p>A collection of content sources for the <a href="https://github.com/Mana-iOS/mana-dev">Mana</a> app, built with <code>@mana-app/dev</code>.</p>

  <img src="https://img.shields.io/github/actions/workflow/status/karrot0/kakarot-extensions-mana/test.yaml?label=test" alt="Tests">
  <img src="https://img.shields.io/github/actions/workflow/status/karrot0/kakarot-extensions-mana/bundle-deploy.yaml?label=build" alt="Deploy">
</div>

---

## Adding to Mana

1. Open the Mana app and navigate to **Discover**
2. Click the package button
3. Tap **Plus**
4. Paste the URL:
   ```
   https://karrot0.github.io/kakarot-extensions-mana/main
   ```

---

## Sources

| Name          | Version | Language | Rating |
| ------------- | ------- | -------- | ------ |
| Batcave       | 1.7.0   | English  | Safe   |
| KakarotComics | 1.2.0   | English  | Mixed  |
| OceComic      | 1.1.0   | English  | Mixed  |
| ZipComic      | 1.1.0   | English  | Mixed  |

See [CHANGELOG.md](CHANGELOG.md) for what changed.

---

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- Node.js 18+

### Setup

```bash
bun install
```

### Creating a New Source

```bash
bun run new-source <Name> --id <id> --url https://site
```

Copies `src/Template/`, rewrites the class and `info` block, and seeds the
CHANGELOG entry and README row. Then drop an icon at
`src/<Name>/assets/icon.png` and fill in the selectors.

Claude Code users: the `mana-extension` skill in `.claude/skills/` walks the
whole flow (site recon, scaffold, implement, verify) and documents the
`@mana-app/types` surface, the intent bitmask, and the runtime's constraints.

### Checks

```bash
bun run lint
bun run format
bun run typecheck
bun run build
```

`typecheck` matters: the build uses esbuild, which strips types without
checking them, so a source written against a removed API compiles cleanly and
then does nothing in the app.

### Verifying against the live site

```bash
bun run verify <Name>    # or --all
```

Loads the built `.mana` bundle with host shims and drives it through the
methods the app calls — search form, home sections, search, content, chapters,
pages — asserting the shape of each result. Put a real `contentId` in
`scripts/probes/<Name>.json` so the content half runs. A Cloudflare block reports
SKIP rather than FAIL, so protected sites do not produce false failures; a SKIP
means unverified, not working.

---
