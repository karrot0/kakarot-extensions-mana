# Releasing a source

## Gates

All four must pass. Nothing ships on a red gate.

```bash
bun run lint
bun run format
bun run typecheck
bun run build
```

`typecheck` is the one that matters most: `mana-dev build` uses esbuild, which strips types
without checking them, so a source written against a removed API builds cleanly and fails
silently in the app. CI runs all four.

Then the contract test against the live site:

```bash
bun run verify <Name>      # one source
bun run verify --all       # every source
```

SKIP is not PASS. A Cloudflare SKIP means the source is unverified, not working.

## Confirm the intents

The bitmask in `dist/sources.json` is what the app actually reads. After any change to
which methods a source defines, confirm the result:

```bash
node -e "const d=require('./dist/sources.json');for(const s of d.sources)console.log(s.name,s.intents)"
```

Bit 11 (`providesSearchForm`, value 2048) set means filters will appear. If you added
`getSearchForm` and the bit is not set, the method is not on the instance — check that the
class really declares it and that `Target` extends the class you edited.

## Version

Bump `info.version` in `src/<Name>/main.ts`. Semantic:

- **patch** — a selector fix, no behaviour change
- **minor** — a new filter, section, or preference
- **major** — content ids or chapter ids change shape, which invalidates users' libraries

## CHANGELOG

`scripts/build-page.js` parses this file into the published page, and the format is exact:

```markdown
## <Name> (current: v<X.Y.Z>)

### <YYYY-MM-DD>

- What changed, in one sentence per bullet.
```

- The `## ` heading must match `## Name (current: vX.Y.Z)` — the `(current: ...)` part is
  the version shown on the card.
- Entries are `### ` headings; use a date, or `Unreleased`.
- Bullets are `- `. A wrapped continuation line must be indented and must not start with
  `-`, or it renders as a second bullet.
- Newest extension first; newest entry first within an extension.

`info.version` and the `(current: v...)` value must agree — nothing enforces it.

## README

Keep the source table in sync: name, version, language, rating. Add a row for a new source,
update the version on an existing one.

## Assets

`info.thumbnail` must be `assets/icon.png` (or `.jpg`) and the file must exist at
`src/<Name>/assets/`. `scripts/build-page.js` copies it into `dist/sources/<Name>/`; a
missing or misnamed file renders a placeholder on the published page. A full URL also works.

## Checklist

- [ ] `bun run lint && bun run format && bun run typecheck && bun run build` clean
- [ ] `bun run verify <Name>` — PASS, with SKIPs understood
- [ ] intent bitmask has the bits the source intends
- [ ] `info.version` bumped
- [ ] CHANGELOG entry, heading version matching `info.version`
- [ ] README row current
- [ ] `src/<Name>/assets/icon.*` exists and matches `info.thumbnail`
- [ ] `scripts/probes/<Name>.json` has a real `contentId`
- [ ] `client.ts` and `forms/*` match `src/Template/` if you changed them
