# Navigation and Multi-select Answering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AskUserQuestion` option navigation wrap, restore focus to answered options, and treat multi-select Space toggles as answered.

**Architecture:** Keep the dialog state in `extensions/index.ts` and add small exported pure helpers for navigation and multi-select answer state. Integrate those helpers into the existing key handlers without changing the rendering structure.

**Tech Stack:** TypeScript, Node's built-in `node:test`, `@earendil-works/pi-tui`, `typebox`.

---

## File Structure

- Modify `extensions/index.ts`
  - Export pure helpers for wrapping focus, restoring answered focus, building multi-select answer text, and updating the answer record.
  - Use those helpers inside the existing custom TUI state machine.
- Modify `tests/ask-user-question-state.test.ts`
  - Import the new helpers.
  - Add focused unit tests for navigation wrapping, answered-focus restoration, and immediate multi-select answer updates.
- Modify `CHANGELOG.md`
  - Add an Unreleased entry describing the behavior changes.

---

### Task 1: Add failing tests for navigation and multi-select answer helpers

**Files:**
- Modify: `tests/ask-user-question-state.test.ts`

- [ ] **Step 1: Extend the helper imports**

Update the import from `../extensions/index.ts` near the top of `tests/ask-user-question-state.test.ts` so it includes the new helper names:

```ts
import askUserQuestion, {
	answerDisplayText,
	formatOptionDescriptionText,
	formatOptionLabelLine,
	hasSubmitTab,
	isSubmitTab,
	missingQuestionHeaders,
	multiAnswerTextFromSelection,
	nextQuestionOrSubmitTab,
	optionMarker,
	preferredOptionIndexForQuestion,
	promptGuidance,
	promptSnippet,
	submitTabIndex,
	updateMultiAnswerRecord,
	validateParams,
	wrapInlineItems,
	wrapOptionIndex,
} from "../extensions/index.ts";
```

- [ ] **Step 2: Add the new test block**

Append this block after the existing `AskUserQuestion submit tab helpers` describe block and before `AskUserQuestion wrapping`:

```ts
describe("AskUserQuestion navigation and answer state helpers", () => {
	it("wraps option focus at both ends", () => {
		assert.equal(wrapOptionIndex(2, 1, 3), 0);
		assert.equal(wrapOptionIndex(0, -1, 3), 2);
		assert.equal(wrapOptionIndex(1, 1, 3), 2);
		assert.equal(wrapOptionIndex(1, -1, 3), 0);
	});

	it("restores focus to a selected single-select option", () => {
		assert.equal(
			preferredOptionIndexForQuestion({
				questionIndex: 0,
				optionCount: 3,
				multiSelect: false,
				selectedSingle: new Map([[0, 1]]),
				selectedMulti: new Map(),
				selectedOtherQuestions: new Set(),
				fallbackIndex: 0,
			}),
			1,
		);
	});

	it("restores focus to Other for a custom single-select answer", () => {
		assert.equal(
			preferredOptionIndexForQuestion({
				questionIndex: 0,
				optionCount: 3,
				multiSelect: false,
				selectedSingle: new Map(),
				selectedMulti: new Map(),
				selectedOtherQuestions: new Set([0]),
				fallbackIndex: 0,
			}),
			2,
		);
	});

	it("restores focus to the first selected multi-select option before Other", () => {
		assert.equal(
			preferredOptionIndexForQuestion({
				questionIndex: 0,
				optionCount: 4,
				multiSelect: true,
				selectedSingle: new Map(),
				selectedMulti: new Map([[0, new Set([2, 1])]]),
				selectedOtherQuestions: new Set([0]),
				fallbackIndex: 0,
			}),
			1,
		);
	});

	it("restores focus to Other when it is the only multi-select choice", () => {
		assert.equal(
			preferredOptionIndexForQuestion({
				questionIndex: 0,
				optionCount: 4,
				multiSelect: true,
				selectedSingle: new Map(),
				selectedMulti: new Map([[0, new Set()]]),
				selectedOtherQuestions: new Set([0]),
				fallbackIndex: 0,
			}),
			3,
		);
	});

	it("updates multi-select answer text immediately after Space toggles", () => {
		const question = {
			question: "Which layers should we test?",
			header: "Testing",
			multiSelect: true,
			options: [
				{ label: "Unit", description: "Unit tests." },
				{ label: "E2E", description: "End-to-end tests." },
			],
		};
		const options = [
			...question.options,
			{ label: "Other...", description: "Type a custom answer.", isOther: true },
		];
		const answers: Record<string, string> = {};
		const selection = new Set([1, 0]);

		updateMultiAnswerRecord(question, 0, selection, options, new Set(), new Map(), answers);

		assert.equal(answers[question.question], "Unit, E2E");
	});

	it("includes a custom Other answer in multi-select answer text", () => {
		const options = [
			{ label: "Unit", description: "Unit tests." },
			{ label: "Other...", description: "Type a custom answer.", isOther: true },
		];

		assert.equal(multiAnswerTextFromSelection(0, new Set([0]), options, new Set([0]), new Map([[0, "Contract tests"]])), "Unit, Contract tests");
	});

	it("clears a multi-select answer record when every selected option is deselected", () => {
		const question = {
			question: "Which layers should we test?",
			header: "Testing",
			multiSelect: true,
			options: [
				{ label: "Unit", description: "Unit tests." },
				{ label: "E2E", description: "End-to-end tests." },
			],
		};
		const answers: Record<string, string> = { [question.question]: "Unit" };
		const options = [
			...question.options,
			{ label: "Other...", description: "Type a custom answer.", isOther: true },
		];

		updateMultiAnswerRecord(question, 0, new Set(), options, new Set(), new Map(), answers);

		assert.equal(Object.hasOwn(answers, question.question), false);
	});
});
```

- [ ] **Step 3: Run the tests and verify they fail for missing exports**

Run:

```bash
npm test
```

Expected: FAIL. The failure should report that one or more of `multiAnswerTextFromSelection`, `preferredOptionIndexForQuestion`, `updateMultiAnswerRecord`, or `wrapOptionIndex` is not exported from `extensions/index.ts`.

---

### Task 2: Implement pure state helpers

**Files:**
- Modify: `extensions/index.ts`

- [ ] **Step 1: Export `DisplayOption` and add helper types/functions near `displayOptions`**

Replace the current `DisplayOption` type declaration:

```ts
type DisplayOption = AskUserQuestionOption & { isOther?: boolean };
```

with:

```ts
export type DisplayOption = AskUserQuestionOption & { isOther?: boolean };
```

Then add this code immediately after `displayOptions(question: AskUserQuestionQuestion): DisplayOption[]`:

```ts
function clampOptionIndex(index: number, optionCount: number): number {
	if (optionCount <= 0) return 0;
	return Math.min(optionCount - 1, Math.max(0, index));
}

export function wrapOptionIndex(currentIndex: number, delta: number, optionCount: number): number {
	if (optionCount <= 0) return 0;
	return (((currentIndex + delta) % optionCount) + optionCount) % optionCount;
}

export interface PreferredOptionIndexArgs {
	questionIndex: number;
	optionCount: number;
	multiSelect: boolean;
	selectedSingle: Map<number, number>;
	selectedMulti: Map<number, Set<number>>;
	selectedOtherQuestions: Set<number>;
	fallbackIndex?: number;
}

export function preferredOptionIndexForQuestion({
	questionIndex,
	optionCount,
	multiSelect,
	selectedSingle,
	selectedMulti,
	selectedOtherQuestions,
	fallbackIndex = 0,
}: PreferredOptionIndexArgs): number {
	if (optionCount <= 0) return 0;

	const fallback = clampOptionIndex(fallbackIndex, optionCount);
	const otherIndex = optionCount - 1;

	if (multiSelect) {
		const selection = selectedMulti.get(questionIndex);
		const firstSelected = selection
			? Array.from(selection)
					.sort((a, b) => a - b)
					.find((index) => index >= 0 && index < optionCount)
			: undefined;
		if (firstSelected !== undefined) return firstSelected;
		if (selectedOtherQuestions.has(questionIndex)) return otherIndex;
		return fallback;
	}

	const selected = selectedSingle.get(questionIndex);
	if (selected !== undefined && selected >= 0 && selected < optionCount) return selected;
	if (selectedOtherQuestions.has(questionIndex)) return otherIndex;
	return fallback;
}

export function multiAnswerTextFromSelection(
	questionIndex: number,
	selection: Set<number>,
	options: DisplayOption[],
	selectedOtherQuestions: Set<number>,
	customOtherAnswers: Map<number, string>,
): string {
	const labels = Array.from(selection)
		.sort((a, b) => a - b)
		.map((index) => options[index])
		.filter((option): option is DisplayOption => option !== undefined && option.isOther !== true)
		.map((option) => option.label);

	if (selectedOtherQuestions.has(questionIndex)) {
		const customAnswer = customOtherAnswers.get(questionIndex);
		if (customAnswer !== undefined) labels.push(customAnswer);
	}

	return labels.join(", ");
}

export function updateMultiAnswerRecord(
	question: AskUserQuestionQuestion,
	questionIndex: number,
	selection: Set<number>,
	options: DisplayOption[],
	selectedOtherQuestions: Set<number>,
	customOtherAnswers: Map<number, string>,
	answers: Record<string, string>,
): void {
	const hasSelection = selection.size > 0 || selectedOtherQuestions.has(questionIndex);
	if (!hasSelection) {
		delete answers[question.question];
		return;
	}

	answers[question.question] = multiAnswerTextFromSelection(questionIndex, selection, options, selectedOtherQuestions, customOtherAnswers);
}
```

- [ ] **Step 2: Replace the local multi-answer formatter body**

Replace the body of the existing nested `multiAnswerText(questionIndex, selection, options)` function inside `execute` with this implementation:

```ts
					function multiAnswerText(questionIndex: number, selection: Set<number>, options: DisplayOption[]): string {
						return multiAnswerTextFromSelection(questionIndex, selection, options, selectedOtherQuestions, customOtherAnswers);
					}
```

- [ ] **Step 3: Run the new helper tests**

Run:

```bash
node --test tests/ask-user-question-state.test.ts --test-name-pattern "navigation and answer state helpers"
```

Expected: PASS for the new helper tests.

---

### Task 3: Integrate helpers into the interactive dialog

**Files:**
- Modify: `extensions/index.ts`

- [ ] **Step 1: Add focus and answer-update helpers inside `execute`**

After the existing nested `currentOptions()` function, add:

```ts
					function preferredCurrentOptionIndex(fallbackIndex = optionIndex): number {
						return preferredOptionIndexForQuestion({
							questionIndex: currentQuestionIndex(),
							optionCount: currentOptions().length,
							multiSelect: currentQuestion().multiSelect,
							selectedSingle,
							selectedMulti,
							selectedOtherQuestions,
							fallbackIndex,
						});
					}

					function focusCurrentTab(fallbackIndex = optionIndex) {
						optionIndex = onSubmitTab() ? 0 : preferredCurrentOptionIndex(fallbackIndex);
					}

					function updateCurrentMultiAnswer() {
						const question = currentQuestion();
						const questionIndex = currentQuestionIndex();
						updateMultiAnswerRecord(question, questionIndex, currentMultiSelection(), currentOptions(), selectedOtherQuestions, customOtherAnswers, answers);
					}
```

- [ ] **Step 2: Preserve chosen focus when moving to another question or review**

In `moveToNextQuestionOrReview()`, replace:

```ts
						currentTabIndex = next === "submit" ? reviewTabIndex : next;
						optionIndex = 0;
						submitPickerIndex = 0;
```

with:

```ts
						currentTabIndex = next === "submit" ? reviewTabIndex : next;
						focusCurrentTab(0);
						submitPickerIndex = 0;
```

- [ ] **Step 3: Use immediate multi-select answer updates for custom Other input**

Inside `editor.onSubmit`, in the `inputMode === "other"` branch, replace this multi-select block:

```ts
							if (question.multiSelect) {
								answers[question.question] = multiAnswerText(questionIndex, currentMultiSelection(), options);
							} else {
								selectedSingle.set(questionIndex, options.length - 1);
								answers[question.question] = text;
							}
```

with:

```ts
							if (question.multiSelect) {
								updateCurrentMultiAnswer();
							} else {
								selectedSingle.set(questionIndex, options.length - 1);
								answers[question.question] = text;
							}
```

- [ ] **Step 4: Keep empty multi-select confirmation while using the shared updater**

In `saveMultiAnswer()`, replace:

```ts
						answers[question.question] = multiAnswerText(questionIndex, selection, currentOptions());
						moveToNextQuestionOrReview();
```

with:

```ts
						if (hasSelection) {
							updateCurrentMultiAnswer();
						} else {
							answers[question.question] = "";
						}
						moveToNextQuestionOrReview();
```

- [ ] **Step 5: Update Space toggles so multi-select questions count as answered immediately**

In `toggleFocusedMultiOption()`, add a `question` constant near the top and call `updateCurrentMultiAnswer()` after changing the selection. Replace the whole function with:

```ts
					function toggleFocusedMultiOption() {
						const question = currentQuestion();
						const options = currentOptions();
						const option = options[optionIndex];
						if (!option) return;
						if (option.isOther) {
							startInput("other");
							return;
						}

						const selection = currentMultiSelection();
						if (selection.has(optionIndex)) {
							selection.delete(optionIndex);
						} else {
							selection.add(optionIndex);
						}
						updateCurrentMultiAnswer();
						emptySelectionWarnings.delete(currentQuestionIndex());
						statusMessage = question.multiSelect && Object.hasOwn(answers, question.question) ? "Answer updated." : "";
						refresh();
					}
```

- [ ] **Step 6: Restore selected focus when moving between question tabs**

In `handleInput(data)`, replace the `Key.tab`/`Key.right` block:

```ts
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
							currentTabIndex = (currentTabIndex + 1) % totalTabs;
							optionIndex = onSubmitTab() ? 0 : Math.min(optionIndex, currentOptions().length - 1);
							submitPickerIndex = 0;
							statusMessage = "";
							refresh();
							return;
						}
```

with:

```ts
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
							currentTabIndex = (currentTabIndex + 1) % totalTabs;
							focusCurrentTab();
							submitPickerIndex = 0;
							statusMessage = "";
							refresh();
							return;
						}
```

Replace the `Key.shift("tab")`/`Key.left` block:

```ts
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentTabIndex = (currentTabIndex - 1 + totalTabs) % totalTabs;
							optionIndex = onSubmitTab() ? 0 : Math.min(optionIndex, currentOptions().length - 1);
							submitPickerIndex = 0;
							statusMessage = "";
							refresh();
							return;
						}
```

with:

```ts
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentTabIndex = (currentTabIndex - 1 + totalTabs) % totalTabs;
							focusCurrentTab();
							submitPickerIndex = 0;
							statusMessage = "";
							refresh();
							return;
						}
```

- [ ] **Step 7: Wrap option up/down navigation**

In the submit tab handler, replace:

```ts
							if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
								submitPickerIndex = Math.max(0, submitPickerIndex - 1);
```

with:

```ts
							if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
								submitPickerIndex = wrapOptionIndex(submitPickerIndex, -1, 2);
```

Replace:

```ts
							if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
								submitPickerIndex = Math.min(1, submitPickerIndex + 1);
```

with:

```ts
							if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
								submitPickerIndex = wrapOptionIndex(submitPickerIndex, 1, 2);
```

In the normal question handler, replace:

```ts
						if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
							optionIndex = Math.max(0, optionIndex - 1);
```

with:

```ts
						if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
							optionIndex = wrapOptionIndex(optionIndex, -1, options.length);
```

Replace:

```ts
						if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
							optionIndex = Math.min(options.length - 1, optionIndex + 1);
```

with:

```ts
						if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
							optionIndex = wrapOptionIndex(optionIndex, 1, options.length);
```

- [ ] **Step 8: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS for all tests.

- [ ] **Step 9: Commit the implementation**

Run:

```bash
git add extensions/index.ts tests/ask-user-question-state.test.ts
git commit -m "feat: improve AskUserQuestion navigation state"
```

---

### Task 4: Document the behavior change

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the Unreleased changelog bullets**

Replace the empty Unreleased section:

```md
## Unreleased
```

with:

```md
## Unreleased

- Wrap AskUserQuestion option navigation from last to first and first to last.
- Restore focus to the chosen option when revisiting answered questions.
- Count multi-select Space toggles as answered immediately while keeping Enter available for advancing and empty-answer confirmation.
```

- [ ] **Step 2: Run the full test suite after documentation changes**

Run:

```bash
npm test
```

Expected: PASS for all tests.

- [ ] **Step 3: Commit the changelog**

Run:

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for navigation behavior"
```

---

## Self-Review

- Spec coverage: Task 3 Step 7 implements option wrapping; Task 3 Steps 1, 2, and 6 implement chosen-option focus restoration; Task 3 Steps 3, 4, and 5 implement immediate multi-select answer updates while preserving empty-answer confirmation.
- Test coverage: Task 1 adds tests for wrapping, focus restoration, multi-select answer text, custom Other text, and answer clearing after deselection.
- Type consistency: Helper names used by tests match the exports added in Task 2. Interactive integration calls the same helper names and passes existing `selectedSingle`, `selectedMulti`, `selectedOtherQuestions`, `customOtherAnswers`, and `answers` state objects.
