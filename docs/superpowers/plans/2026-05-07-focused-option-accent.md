# Focused Option Accent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight the currently focused `AskUserQuestion` answer marker and label with the theme accent color before the user selects it.

**Architecture:** Keep the existing custom TUI structure in `extensions/ask-user-question.ts`. Extract a small pure row-formatting helper so tests can verify the focused marker/label styling without running an interactive terminal, then call that helper from the existing `optionLines()` path used by both standard and preview layouts.

**Tech Stack:** TypeScript ESM, `@mariozechner/pi-coding-agent` extension API, `@mariozechner/pi-tui` rendering helpers, Node's built-in test runner.

---

## File Structure

- Modify `extensions/ask-user-question.ts`
  - Add an exported `formatOptionLabelLine()` helper near the existing rendering helpers.
  - Update `optionLines()` so the focused prefix, marker, and option label are styled as separate ANSI segments.
- Modify `tests/ask-user-question-state.test.ts`
  - Import `formatOptionLabelLine()`.
  - Add focused and unfocused option row formatting tests.
- Modify `CHANGELOG.md`
  - Add an Unreleased note for the focused answer highlight.

---

### Task 1: Focused Option Formatter and UI Wiring

**Files:**
- Modify: `tests/ask-user-question-state.test.ts`
- Modify: `extensions/ask-user-question.ts`

- [ ] **Step 1: Write the failing formatter tests**

Update the import in `tests/ask-user-question-state.test.ts` to include `formatOptionLabelLine`:

```ts
import {
	answerDisplayText,
	formatOptionLabelLine,
	hasSubmitTab,
	isSubmitTab,
	missingQuestionHeaders,
	nextQuestionOrSubmitTab,
	submitTabIndex,
	validateParams,
} from "../extensions/ask-user-question.ts";
```

Append this test block to `tests/ask-user-question-state.test.ts`:

```ts
describe("AskUserQuestion option rendering", () => {
	const styles = {
		accent: (text: string) => `<accent>${text}</accent>`,
		text: (text: string) => `<text>${text}</text>`,
	};

	it("colors the focused marker and label with the accent style", () => {
		assert.equal(
			formatOptionLabelLine(true, "●", "VPN only (Recommended)", styles),
			"<accent>› </accent><accent>● VPN only (Recommended)</accent>",
		);
	});

	it("keeps unfocused marker and label in the text style", () => {
		assert.equal(
			formatOptionLabelLine(false, "○", "Cloudflare Access", styles),
			"  <text>○ Cloudflare Access</text>",
		);
	});
});
```

- [ ] **Step 2: Run the focused formatter tests and verify they fail**

Run:

```bash
node --test tests/ask-user-question-state.test.ts
```

Expected: the test command fails because `extensions/ask-user-question.ts` does not export `formatOptionLabelLine` yet. The error should mention that the module does not provide that export.

- [ ] **Step 3: Add the formatter helper and wire it into option rendering**

In `extensions/ask-user-question.ts`, add this helper after `function padAnsi(...)`:

```ts
type OptionTextStyle = (text: string) => string;

export interface OptionLabelLineStyles {
	accent: OptionTextStyle;
	text: OptionTextStyle;
}

export function formatOptionLabelLine(focused: boolean, marker: string, label: string, styles: OptionLabelLineStyles): string {
	const prefix = focused ? styles.accent("› ") : "  ";
	const markerAndLabel = `${marker} ${label}`;
	return `${prefix}${focused ? styles.accent(markerAndLabel) : styles.text(markerAndLabel)}`;
}
```

In `extensions/ask-user-question.ts`, replace the focused row construction inside `optionLines()` with this code:

```ts
						for (let i = 0; i < options.length; i++) {
							const option = options[i];
							const focused = i === optionIndex;
							const marker = question.multiSelect
								? multiSelection.has(i)
									? "[x]"
									: "[ ]"
								: focused
									? "●"
									: "○";
							lines.push(
								formatOptionLabelLine(focused, marker, option.label, {
									accent: (text) => theme.fg("accent", text),
									text: (text) => theme.fg("text", text),
								}),
							);

							for (const descriptionLine of wrapTextWithAnsi(option.description, Math.max(1, width - 6))) {
								lines.push(`      ${theme.fg("muted", descriptionLine)}`);
							}
						}
```

This keeps description lines muted and avoids nesting `theme.fg("accent", ...)` around a string that already contains an ANSI reset from the focused prefix.

- [ ] **Step 4: Run the focused formatter tests and verify they pass**

Run:

```bash
node --test tests/ask-user-question-state.test.ts
```

Expected: all tests in `tests/ask-user-question-state.test.ts` pass.

- [ ] **Step 5: Commit the formatter and UI wiring**

Run:

```bash
git add extensions/ask-user-question.ts tests/ask-user-question-state.test.ts
git commit -m "fix: accent focused option labels"
```

Expected: git creates a commit containing only `extensions/ask-user-question.ts` and `tests/ask-user-question-state.test.ts`.

---

### Task 2: Changelog and Verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the visible UI change**

Update the top of `CHANGELOG.md` so the Unreleased section reads:

```md
## Unreleased

- Highlight the focused answer marker and label in `AskUserQuestion` dialogs with the accent color.
```

Keep the existing `v1.1.0` and `v1.0.0` sections unchanged below it.

- [ ] **Step 2: Run the full automated test suite**

Run:

```bash
npm test
```

Expected: Node reports all tests passing.

- [ ] **Step 3: Perform the interactive visual check**

Start pi from the package root with the local package enabled:

```bash
pi -e .
```

In the pi prompt, ask for a one-question `AskUserQuestion` dialog with two options, for example:

```text
Use AskUserQuestion to ask me which option to choose, with options Alpha and Beta.
```

Expected visual result before pressing Enter:

- The focused row still has the left `›` marker.
- The focused radio marker and option label use the same accent color as `›`.
- The focused option description remains muted.
- Moving with `↑`/`↓` transfers the accent label styling to the newly focused row.

Exit the pi test session after the visual check.

- [ ] **Step 4: Commit the changelog**

Run:

```bash
git add CHANGELOG.md
git commit -m "docs: document focused option highlight"
```

Expected: git creates a commit containing only `CHANGELOG.md`.

---

## Final Verification

Run:

```bash
npm test
git status --short
```

Expected:

- `npm test` passes.
- `git status --short` shows no uncommitted tracked changes.
