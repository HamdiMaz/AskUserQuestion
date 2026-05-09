# Earendil Package Scope Release Design

## Goal

Release `@mazli/pi-ask-user-question` v1.3.2 so installing or updating the pi package no longer pulls deprecated `@mariozechner/*` pi peer dependencies.

## Selected approach

Use a patch release that updates the extension's pi core package references from the deprecated `@mariozechner/*` scope to the current `@earendil-works/*` scope.

- Replace peer dependency names in `package.json`.
- Replace extension imports in `extensions/index.ts`.
- Keep `typebox` as a peer dependency.
- Add a regression test that fails if the manifest or extension source references `@mariozechner/*` again.
- Publish npm and GitHub releases for `v1.3.2`.

## Scope

Change only packaging metadata, import specifiers, release metadata, and tests:

- `package.json`
- `extensions/index.ts`
- `tests/package-manifest.test.ts`
- `CHANGELOG.md`
- `README.md` versioned release links

## Implementation design

The extension API usage is unchanged. The only runtime code change is the module specifier used for `ExtensionAPI` and TUI imports. Pi's package docs say pi core packages should be peer dependencies with `*` ranges, so the peer dependency object should contain:

```json
{
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
  "typebox": "*"
}
```

The regression test should read `package.json` and `extensions/index.ts` as text, asserting that:

- `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` are present where expected.
- No `@mariozechner/` strings remain in the manifest or extension source.

## Testing

Use TDD for the scope regression:

1. Add the manifest/source test first and verify it fails on the current deprecated scope.
2. Update imports and peer dependencies.
3. Run the focused test and full `npm test` suite.
4. Run `npm pack --dry-run` to verify the publish tarball contents.

## Release

After verification, commit the fix and release metadata, merge to `main`, tag `v1.3.2`, push, publish to npm, create the GitHub release from the `CHANGELOG.md` v1.3.2 section, then verify npm and GitHub publication.

## Out of scope

- Adding `@earendil-works/pi-ai`, because this package does not import `pi-ai` directly.
- Changing tool behavior or TUI behavior.
- Changing package installation instructions beyond versioned release links.
