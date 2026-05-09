# Earendil Package Scope Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `@mazli/pi-ask-user-question` v1.3.2 without deprecated `@mariozechner/*` pi package references.

**Architecture:** Keep the extension behavior unchanged and update only module specifiers, peer dependency names, release metadata, and regression coverage. Verify with a static package/source test, the full Node test suite, and npm/GitHub publication checks.

**Tech Stack:** TypeScript ESM, Node's built-in test runner, npm package publishing, GitHub CLI releases.

---

## File Structure

- Modify `tests/package-manifest.test.ts`
  - Add a regression test that reads `package.json` and `extensions/index.ts` and rejects deprecated `@mariozechner/` references.
- Modify `package.json`
  - Bump `version` to `1.3.2`.
  - Replace `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui` peer dependencies with `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.
- Modify `extensions/index.ts`
  - Replace the two import specifiers with `@earendil-works/*` names.
- Modify `CHANGELOG.md`
  - Add a `v1.3.2` section describing the package-scope fix.
- Modify `README.md`
  - Update versioned GitHub links from `v1.3.1` to `v1.3.2`.

---

### Task 1: Deprecated Scope Regression Test

**Files:**
- Modify: `tests/package-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test to `tests/package-manifest.test.ts` inside the existing `describe("package manifest", () => { ... })` block:

```ts
	it("uses current @earendil-works pi package names", () => {
		const packageJsonText = readFileSync(packageJsonUrl, "utf8");
		const packageJson = JSON.parse(packageJsonText) as {
			peerDependencies?: Record<string, string>;
		};
		const extensionSource = readFileSync(new URL("extensions/index.ts", packageRootUrl), "utf8");

		assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"], "*");
		assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-tui"], "*");
		assert.equal(packageJson.peerDependencies?.["@mariozechner/pi-coding-agent"], undefined);
		assert.equal(packageJson.peerDependencies?.["@mariozechner/pi-tui"], undefined);
		assert.doesNotMatch(packageJsonText, /@mariozechner\//);
		assert.doesNotMatch(extensionSource, /@mariozechner\//);
		assert.match(extensionSource, /@earendil-works\/pi-coding-agent/);
		assert.match(extensionSource, /@earendil-works\/pi-tui/);
	});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test tests/package-manifest.test.ts
```

Expected: FAIL because `package.json` and `extensions/index.ts` still contain `@mariozechner/*` references.

- [ ] **Step 3: Commit nothing**

Do not commit after the red test. Continue to Task 2 so the same change can make the test pass.

---

### Task 2: Package Scope Fix

**Files:**
- Modify: `package.json`
- Modify: `extensions/index.ts`

- [ ] **Step 1: Update package metadata**

In `package.json`, change:

```json
"version": "1.3.1"
```

to:

```json
"version": "1.3.2"
```

Replace the peer dependencies block with:

```json
"peerDependencies": {
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
  "typebox": "*"
}
```

- [ ] **Step 2: Update extension imports**

At the top of `extensions/index.ts`, change the imports to:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
```

- [ ] **Step 3: Refresh local development peer installs without committing a lockfile**

Run:

```bash
npm install --no-package-lock
rm -f package-lock.json
```

Expected: `node_modules` contains the `@earendil-works/*` packages needed for local tests, and `package-lock.json` is absent.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
node --test tests/package-manifest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the scope fix**

Run:

```bash
git add package.json extensions/index.ts tests/package-manifest.test.ts
git commit -m "fix: use current pi package scope"
```

Expected: one commit with the import, peer dependency, version, and regression test changes.

---

### Task 3: Release Metadata and Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Update changelog**

Change the top of `CHANGELOG.md` to:

```md
## Unreleased

## v1.3.2

- Replace deprecated pi peer dependencies and imports with `@earendil-works/*` package names.
```

Keep the existing `v1.3.1` and older sections below.

- [ ] **Step 2: Update README versioned links**

Replace all `v1.3.1` occurrences in `README.md` with `v1.3.2` so screenshots and git-install instructions point at the new tag.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm pack --dry-run
git diff --check
rg '@mariozechner' package.json extensions/index.ts README.md
```

Expected:

- `npm test` reports all tests passing.
- `npm pack --dry-run` lists the intended package files.
- `git diff --check` prints no whitespace errors.
- `rg '@mariozechner' package.json extensions/index.ts README.md` exits with status 1 and no matches in shipped/runtime metadata.

- [ ] **Step 4: Commit release metadata**

Run:

```bash
git add CHANGELOG.md README.md
git commit -m "docs: prepare v1.3.2 release"
```

Expected: one commit containing only release documentation updates.

---

### Task 4: Publish npm and GitHub Releases

**Files:**
- No source file changes after this task starts.

- [ ] **Step 1: Verify final working tree and release preflight**

Run:

```bash
git status --short --branch
git fetch --tags origin
git ls-remote --tags origin refs/tags/v1.3.2
npm whoami
npm view @mazli/pi-ask-user-question version
```

Expected:

- Working tree is clean on the release branch.
- Remote tag `v1.3.2` does not exist.
- npm authentication succeeds.
- npm currently reports an older version than `1.3.2`.

- [ ] **Step 2: Merge to main in the primary worktree and verify on main**

Run from `/home/maz/Projects/AskUserQuestion`, where `main` is checked out:

```bash
cd /home/maz/Projects/AskUserQuestion
git pull --ff-only origin main
git merge --ff-only release/v1.3.2-new-scope
npm install --no-package-lock
rm -f package-lock.json
npm test
npm pack --dry-run
git status --short --branch
```

Expected: fast-forward merge succeeds in the primary worktree, verification passes, and no uncommitted tracked changes remain.

- [ ] **Step 3: Tag and push**

Run:

```bash
git tag -a v1.3.2 -m "Release v1.3.2"
git push origin main
git push origin v1.3.2
```

Expected: branch and tag push successfully.

- [ ] **Step 4: Publish npm package**

Run:

```bash
npm publish --access public
```

Expected: npm publishes `@mazli/pi-ask-user-question@1.3.2`.

- [ ] **Step 5: Create GitHub release**

Run:

```bash
notes_file=$(mktemp)
python - "v1.3.2" "$notes_file" <<'PY'
import sys
from pathlib import Path

tag = sys.argv[1]
output = Path(sys.argv[2])
text = Path("CHANGELOG.md").read_text(encoding="utf-8")
section = text.split(f"## {tag}", 1)[1].split("\n## ", 1)[0].strip()
output.write_text(section + "\n", encoding="utf-8")
PY
gh release create v1.3.2 --title "v1.3.2" --notes-file "$notes_file" --verify-tag
rm -f "$notes_file"
```

Expected: GitHub release `v1.3.2` is created from the changelog section.

- [ ] **Step 6: Verify publication**

Run:

```bash
npm view @mazli/pi-ask-user-question@1.3.2 peerDependencies version
git ls-remote origin refs/heads/main refs/tags/v1.3.2 'refs/tags/v1.3.2^{}'
gh release view v1.3.2 --json tagName,name,url,body
```

Expected:

- npm reports version `1.3.2` and `@earendil-works/*` peer dependencies.
- GitHub remote reports `main` and the annotated tag object/peeled commit.
- GitHub release metadata is visible.
