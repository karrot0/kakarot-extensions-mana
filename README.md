<div align="center">
  <h1>Kakarot Extensions</h1>
  <p>A collection of content sources for the <a href="https://github.com/Mana-iOS/mana-dev">Mana</a> app, built with <code>@mana-app/dev</code>.</p>

  <img src="https://img.shields.io/github/actions/workflow/status/Karrot/kakarot-extensions_mana/test.yaml?label=tests" alt="Tests">
  <img src="https://img.shields.io/github/actions/workflow/status/Karrot/kakarot-extensions_mana/bundle-deploy.yaml?label=deploy" alt="Deploy">
</div>

---

## Adding to Mana

1. Open the Mana app and navigate to **Discover**
2. Click the package button
3. Tap **Plus**
4. Paste the URL:
   ```
   https://karrot.github.io/kakarot-extensions-mana/
   ```

---

## Sources

| Name | Version | Language | Rating |
|------|---------|----------|--------|
| Template | 1.0.0 | English | Safe |

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

1. Copy `src/Template/` to `src/<YourSourceName>/`
2. Update `info.id`, `info.name`, and `info.website` in `main.ts`
3. Implement `search`, `getContent`, `getChapters`, and `getChapterData`
4. Add your `icon.png` to `src/<YourSourceName>/assets/`
5. Run `bun run build` to verify

---