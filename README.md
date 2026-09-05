<div align="center">
  <img src=".github/assets/header.svg" alt="Kakarot Extensions" width="100%">
  <br><br>
  <a href="https://karrot0.github.io/kakarot-extensions-mana"><img src="https://img.shields.io/badge/Add_to_Mana-dc2626?style=for-the-badge&labelColor=0a0a0a&logo=apple&logoColor=white" alt="Add to Mana"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/Changelog-0a0a0a?style=for-the-badge&labelColor=dc2626&logo=git&logoColor=white" alt="Changelog"></a>
  <a href="https://github.com/Mana-iOS/mana-dev"><img src="https://img.shields.io/badge/Mana-0a0a0a?style=for-the-badge&labelColor=dc2626&logo=github&logoColor=white" alt="Mana"></a>
  <br><br>
  <img src="https://img.shields.io/github/actions/workflow/status/karrot0/kakarot-extensions-mana/test.yaml?label=test&style=for-the-badge&labelColor=0a0a0a" alt="Tests">
  <img src="https://img.shields.io/github/actions/workflow/status/karrot0/kakarot-extensions-mana/bundle-deploy.yaml?label=build&style=for-the-badge&labelColor=0a0a0a" alt="Deploy">
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

|                                                                             | Name          | Version | Language | Rating |
| :-------------------------------------------------------------------------: | ------------- | ------- | -------- | ------ |
|    <img src="src/Batcave/assets/icon.png" width="28" height="28" alt="">    | Batcave       | 1.7.1   | English  | Safe   |
| <img src="src/KakarotComics/assets/icon.jpg" width="28" height="28" alt=""> | KakarotComics | 1.2.1   | English  | Mixed  |
|   <img src="src/OceComic/assets/icon.png" width="28" height="28" alt="">    | OceComic      | 1.2.1   | English  | Mixed  |
|   <img src="src/Zipcomic/assets/icon.png" width="28" height="28" alt="">    | ZipComic      | 1.1.1   | English  | Mixed  |

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
