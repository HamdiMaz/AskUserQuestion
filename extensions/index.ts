import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface AskUserQuestionOption {
	label: string;
	description: string;
	preview?: string;
}

interface AskUserQuestionQuestion {
	question: string;
	header: string;
	options: AskUserQuestionOption[];
	multiSelect: boolean;
}

interface AskUserQuestionParams {
	questions: AskUserQuestionQuestion[];
	metadata?: {
		source?: string;
	};
}

interface AskUserQuestionAnnotation {
	notes?: string;
	preview?: string;
}

interface AskUserQuestionResult {
	cancelled: boolean;
	answers?: Record<string, string>;
	annotations?: Record<string, AskUserQuestionAnnotation>;
}

export type DisplayOption = AskUserQuestionOption & { isOther?: boolean };
type InputMode = "other" | "notes" | null;

const OtherLabel = "Other...";

const OptionSchema = Type.Object(
	{
		label: Type.String({ description: "1-5 word display text." }),
		description: Type.String({ description: "Trade-off / implication context." }),
		preview: Type.Optional(Type.String({ description: "Optional markdown preview (single-select only)." })),
	},
	{ additionalProperties: false },
);

const QuestionSchema = Type.Object(
	{
		question: Type.String({ description: "Full question, ends with '?'." }),
		header: Type.String({ description: "Short chip label, ≤12 chars." }),
		multiSelect: Type.Boolean({ default: false }),
		options: Type.Array(OptionSchema, {
			minItems: 2,
			maxItems: 4,
			description: "Answer options. Do not include Other; it is added automatically.",
		}),
	},
	{ additionalProperties: false },
);

const AskUserQuestionParameters = Type.Object(
	{
		questions: Type.Array(QuestionSchema, {
			minItems: 1,
			maxItems: 8,
			description: "Questions to ask the user. Use 1-8 questions per call.",
		}),
		metadata: Type.Optional(
			Type.Object(
				{
					source: Type.Optional(Type.String({ description: "Analytics tag, e.g. 'clarify' or 'remember'." })),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export const promptSnippet = "Ask the user one or more structured questions, batching up to 8 related questions when useful.";

export const promptGuidance = `When to use AskUserQuestion:

You face 2-4 reasonable paths and the user's preference materially changes the outcome.
You hit ambiguity that you cannot resolve from context.
You want to surface a recommendation while still letting the user steer.

AskUserQuestion can ask one question or a batch of related questions in the same call.
Use multiple questions when several independent decisions are needed before continuing, especially during requirements gathering or option selection.
Use a single question when only one decision is blocking progress or when asking step-by-step would be clearer.
Do not split clearly related decisions into separate tool calls just because single-question dialogs feel safer; batching 2-8 related questions is allowed and often preferred.

When NOT to use it:

For yes/no confirmation of risky actions — use the permission system.
For plan approval — use the planning flow.
When you can reasonably infer the answer from prior context or conventions.
For more than 8 questions at once — break into sequential calls instead.

Authoring rules:

1-8 questions per call. 2-4 options per question.
Never include an "Other" option; the harness adds one.
Place your recommended option first and suffix its label with " (Recommended)".
Keep header ≤12 chars and label to 1-5 words.
Use preview only for visual comparisons, and only on single-select questions.
question must end with ?. Phrase multi-select questions in plural ("Which features…").`;

export function validateParams(params: AskUserQuestionParams): string | undefined {
	if (params.questions.length < 1 || params.questions.length > 8) {
		return "questions must have 1–8 items";
	}

	const seenQuestions = new Set<string>();
	for (const q of params.questions) {
		if (seenQuestions.has(q.question)) {
			return "duplicate question text; result keying would collide";
		}
		seenQuestions.add(q.question);

		if (q.options.length < 2 || q.options.length > 4) {
			return "each question needs 2–4 options";
		}
		if (q.header.length > 12) {
			return `header exceeds 12 chars: ${q.header}`;
		}
		if (!q.question.trimEnd().endsWith("?")) {
			return "question must end with '?'";
		}

		const seenLabels = new Set<string>();
		for (const option of q.options) {
			const labelKey = option.label.trim().toLowerCase();
			if (seenLabels.has(labelKey)) {
				return `duplicate label '${option.label}' in question '${q.question}'`;
			}
			seenLabels.add(labelKey);

			const normalizedOtherLabel = labelKey.replace(/[.!…]+$/u, "");
			if (normalizedOtherLabel === "other") {
				return "do not include an 'Other' option; it is added automatically";
			}
			if (q.multiSelect && option.preview !== undefined) {
				return "preview is only supported on single-select questions";
			}
		}
	}
	return undefined;
}

function displayOptions(question: AskUserQuestionQuestion): DisplayOption[] {
	return [...question.options, { label: OtherLabel, description: "Type a custom answer.", isOther: true }];
}

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

function optionHasPreview(question: AskUserQuestionQuestion): boolean {
	return !question.multiSelect && question.options.some((option) => option.preview !== undefined);
}

function padAnsi(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

export function wrapInlineItems(items: string[], width: number): string[] {
	const safeWidth = Math.max(1, width);
	const lines: string[] = [];
	let currentLine = "";

	for (const item of items) {
		const fittedItem = visibleWidth(item) > safeWidth ? truncateToWidth(item, safeWidth) : item;
		if (!currentLine) {
			currentLine = fittedItem;
			continue;
		}

		const candidate = `${currentLine} ${fittedItem}`;
		if (visibleWidth(candidate) <= safeWidth) {
			currentLine = candidate;
		} else {
			lines.push(currentLine);
			currentLine = fittedItem;
		}
	}

	if (currentLine) lines.push(currentLine);
	return lines.length > 0 ? lines : [""];
}

type OptionTextStyle = (text: string) => string;

export interface OptionLabelLineStyles {
	accent: OptionTextStyle;
	selected: OptionTextStyle;
	text: OptionTextStyle;
}

export function optionMarker(multiSelect: boolean, focused: boolean, selected: boolean): string {
	if (selected) return multiSelect ? "[X]" : "✓";
	return multiSelect ? "[ ]" : focused ? "●" : "○";
}

export function formatOptionLabelLine(focused: boolean, selected: boolean, marker: string, label: string, styles: OptionLabelLineStyles): string {
	const prefix = focused ? styles.accent("› ") : "  ";
	const markerAndLabel = `${marker} ${label}`;
	const style = selected ? styles.selected : focused ? styles.accent : styles.text;
	return `${prefix}${style(markerAndLabel)}`;
}

export function formatOptionDescriptionText(description: string, isOther: boolean | undefined, selected: boolean, customAnswer: string | undefined): string {
	return isOther && selected && customAnswer !== undefined ? answerDisplayText(customAnswer) : description;
}

function plainPreviewLines(text: string, width: number): string[] {
	const lines: string[] = [];
	for (const sourceLine of text.split("\n")) {
		const wrapped = wrapTextWithAnsi(sourceLine || " ", Math.max(1, width));
		lines.push(...(wrapped.length > 0 ? wrapped : [""]));
	}
	return lines.length > 0 ? lines : [""];
}

function stringifyResult(result: AskUserQuestionResult): string {
	return JSON.stringify(result, null, 2);
}

export function hasSubmitTab(questionCount: number): boolean {
	return questionCount > 1;
}

export function submitTabIndex(questionCount: number): number | undefined {
	return hasSubmitTab(questionCount) ? questionCount : undefined;
}

export function isSubmitTab(tabIndex: number, questionCount: number): boolean {
	return submitTabIndex(questionCount) === tabIndex;
}

export function missingQuestionHeaders(questions: AskUserQuestionQuestion[], answers: Record<string, string>): string[] {
	return questions.filter((question) => !Object.hasOwn(answers, question.question)).map((question) => question.header);
}

export function nextQuestionOrSubmitTab(currentIndex: number, questions: AskUserQuestionQuestion[], answers: Record<string, string>): number | "submit" {
	for (let offset = 1; offset <= questions.length; offset++) {
		const candidate = (currentIndex + offset) % questions.length;
		if (!Object.hasOwn(answers, questions[candidate]!.question)) return candidate;
	}
	return hasSubmitTab(questions.length) ? "submit" : currentIndex;
}

export function answerDisplayText(answer: string): string {
	return answer === "" ? "(empty answer)" : answer;
}

function createCancelledResult(): AskUserQuestionResult {
	return { cancelled: true };
}

export default function askUserQuestion(pi: ExtensionAPI) {
	pi.registerTool({
		name: "AskUserQuestion",
		label: "Ask User Question",
		description:
			"Use this tool when you need to ask the user questions during execution. Allows you to gather preferences, clarify ambiguity, get decisions on implementation choices, or offer directional choices. Users always have an Other option to provide custom text. Use multiSelect: true when answers aren't mutually exclusive. If recommending an option, place it first and suffix its label with ' (Recommended)'. Use preview only for visual side-by-side comparisons (mockups, code, diagrams) and only with single-select.",
		promptSnippet,
		promptGuidelines: [`Use AskUserQuestion as follows:\n\n${promptGuidance}`],
		parameters: AskUserQuestionParameters,

		async execute(_toolCallId, params: AskUserQuestionParams, _signal, _onUpdate, ctx) {
			const validationError = validateParams(params);
			if (validationError) {
				throw new Error(validationError);
			}
			if (!ctx.hasUI || !process.stdin.isTTY || !process.stdout.isTTY) {
				throw new Error("AskUserQuestion requires an interactive terminal");
			}

			const questions = params.questions;
			let shouldTerminateAfterDialog = false;
			let result: AskUserQuestionResult;
			ctx.ui.setWorkingVisible(false);
			try {
				result = (await ctx.ui.custom<AskUserQuestionResult>((tui, theme, _keybindings, done) => {
					let currentTabIndex = 0;
					let optionIndex = 0;
					let submitPickerIndex = 0;
					let inputMode: InputMode = null;
					let pendingEscape = false;
					let showHelp = false;
					let statusMessage = "";
					let cachedLines: string[] | undefined;

					const answers: Record<string, string> = {};
					const annotations: Record<string, AskUserQuestionAnnotation> = {};
					const selectedSingle = new Map<number, number>();
					const selectedMulti = new Map<number, Set<number>>();
					const selectedOtherQuestions = new Set<number>();
					const customOtherAnswers = new Map<number, string>();
					const emptySelectionWarnings = new Set<number>();

					const editorTheme: EditorTheme = {
						borderColor: (s) => theme.fg("accent", s),
						selectList: {
							selectedPrefix: (t) => theme.fg("accent", t),
							selectedText: (t) => theme.fg("accent", t),
							description: (t) => theme.fg("muted", t),
							scrollInfo: (t) => theme.fg("dim", t),
							noMatch: (t) => theme.fg("warning", t),
						},
					};
					const editor = new Editor(tui, editorTheme);

					function refresh() {
						cachedLines = undefined;
						tui.requestRender();
					}

					const multiQuestion = questions.length > 1;
					const reviewTabIndex = questions.length;

					function currentQuestionIndex(): number {
						return Math.min(currentTabIndex, questions.length - 1);
					}

					function onSubmitTab(): boolean {
						return multiQuestion && currentTabIndex === reviewTabIndex;
					}

					function currentQuestion(): AskUserQuestionQuestion {
						return questions[currentQuestionIndex()]!;
					}

					function currentOptions(): DisplayOption[] {
						return displayOptions(currentQuestion());
					}

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

					function currentMultiSelection(): Set<number> {
						const questionIndex = currentQuestionIndex();
						let selection = selectedMulti.get(questionIndex);
						if (!selection) {
							selection = new Set<number>();
							selectedMulti.set(questionIndex, selection);
						}
						return selection;
					}

					function isOptionSelected(question: AskUserQuestionQuestion, questionIndex: number, index: number, option: DisplayOption, multiSelection: Set<number>): boolean {
						if (question.multiSelect) {
							return multiSelection.has(index) || (option.isOther === true && selectedOtherQuestions.has(questionIndex));
						}
						return selectedSingle.get(questionIndex) === index;
					}

					function multiAnswerText(questionIndex: number, selection: Set<number>, options: DisplayOption[]): string {
						return multiAnswerTextFromSelection(questionIndex, selection, options, selectedOtherQuestions, customOtherAnswers);
					}

					function allAnswered(): boolean {
						return questions.every((question) => Object.hasOwn(answers, question.question));
					}

					function finishWithAnswers() {
						const finalAnnotations = Object.keys(annotations).length > 0 ? annotations : undefined;
						done({ cancelled: false, answers, annotations: finalAnnotations });
					}

					function moveToNextQuestionOrReview() {
						if (!multiQuestion) {
							finishWithAnswers();
							return;
						}

						const next = nextQuestionOrSubmitTab(currentQuestionIndex(), questions, answers);
						currentTabIndex = next === "submit" ? reviewTabIndex : next;
						focusCurrentTab(0);
						submitPickerIndex = 0;
						statusMessage = "";
						refresh();
					}

					function dismissToChat() {
						shouldTerminateAfterDialog = true;
						done(createCancelledResult());
					}

					function saveAnnotation(question: AskUserQuestionQuestion, patch: AskUserQuestionAnnotation) {
						const current = annotations[question.question] ?? {};
						annotations[question.question] = { ...current, ...patch };
					}

					function saveSingleAnswer(option: DisplayOption) {
						const question = currentQuestion();
						const questionIndex = currentQuestionIndex();
						selectedSingle.set(questionIndex, optionIndex);
						selectedOtherQuestions.delete(questionIndex);
						customOtherAnswers.delete(questionIndex);
						answers[question.question] = option.label;
						if (option.preview) {
							saveAnnotation(question, { preview: option.preview });
						}
						moveToNextQuestionOrReview();
					}

					function saveMultiAnswer() {
						const question = currentQuestion();
						const questionIndex = currentQuestionIndex();
						const selection = currentMultiSelection();
						const hasSelection = selection.size > 0 || selectedOtherQuestions.has(questionIndex);
						if (!hasSelection && !emptySelectionWarnings.has(questionIndex)) {
							emptySelectionWarnings.add(questionIndex);
							statusMessage = "No options selected. Press Enter again to confirm an empty answer.";
							refresh();
							return;
						}
						if (hasSelection) {
							updateCurrentMultiAnswer();
						} else {
							answers[question.question] = "";
						}
						moveToNextQuestionOrReview();
					}

					function startInput(mode: InputMode) {
						inputMode = mode;
						pendingEscape = false;
						statusMessage = mode === "other" ? "Type a custom answer." : "Add a note for the focused option.";
						editor.setText(mode === "other" ? (customOtherAnswers.get(currentQuestionIndex()) ?? "") : "");
						refresh();
					}

					editor.onSubmit = (value) => {
						const text = value.trim();
						if (!text) {
							statusMessage = "Input cannot be empty.";
							refresh();
							return;
						}

						const question = currentQuestion();
						if (inputMode === "other") {
							const questionIndex = currentQuestionIndex();
							const options = currentOptions();
							selectedOtherQuestions.add(questionIndex);
							customOtherAnswers.set(questionIndex, text);
							if (question.multiSelect) {
								updateCurrentMultiAnswer();
							} else {
								selectedSingle.set(questionIndex, options.length - 1);
								answers[question.question] = text;
							}
							inputMode = null;
							editor.setText("");
							moveToNextQuestionOrReview();
							return;
						}

						if (inputMode === "notes") {
							saveAnnotation(question, { notes: text });
							inputMode = null;
							editor.setText("");
							statusMessage = "Note saved.";
							refresh();
						}
					};

					function confirmFocusedOption() {
						const question = currentQuestion();
						const options = currentOptions();
						const option = options[optionIndex];
						if (!option) return;

						if (option.isOther) {
							startInput("other");
							return;
						}

						if (question.multiSelect) {
							saveMultiAnswer();
						} else {
							saveSingleAnswer(option);
						}
					}

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

					function handleInput(data: string) {
						if (matchesKey(data, Key.ctrl("c"))) {
							dismissToChat();
							return;
						}

						if (inputMode) {
							if (matchesKey(data, Key.escape)) {
								inputMode = null;
								editor.setText("");
								statusMessage = "";
								refresh();
								return;
							}
							editor.handleInput(data);
							refresh();
							return;
						}

						if (showHelp) {
							showHelp = false;
							refresh();
							return;
						}

						if (matchesKey(data, Key.escape)) {
							if (pendingEscape) {
								dismissToChat();
								return;
							}
							pendingEscape = true;
							statusMessage = "Press Esc again to dismiss and return to chat.";
							refresh();
							return;
						}
						pendingEscape = false;

						const totalTabs = multiQuestion ? questions.length + 1 : questions.length;
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
							currentTabIndex = (currentTabIndex + 1) % totalTabs;
							focusCurrentTab();
							submitPickerIndex = 0;
							statusMessage = "";
							refresh();
							return;
						}
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentTabIndex = (currentTabIndex - 1 + totalTabs) % totalTabs;
							focusCurrentTab();
							submitPickerIndex = 0;
							statusMessage = "";
							refresh();
							return;
						}

						if (onSubmitTab()) {
							if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
								submitPickerIndex = wrapOptionIndex(submitPickerIndex, -1, 2);
								statusMessage = "";
								refresh();
								return;
							}
							if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
								submitPickerIndex = wrapOptionIndex(submitPickerIndex, 1, 2);
								statusMessage = "";
								refresh();
								return;
							}
							if (matchesKey(data, Key.enter)) {
								if (submitPickerIndex === 1) {
									dismissToChat();
									return;
								}
								const missing = missingQuestionHeaders(questions, answers);
								if (missing.length > 0) {
									statusMessage = `Answer remaining questions before submitting: ${missing.join(", ")}`;
									refresh();
									return;
								}
								finishWithAnswers();
								return;
							}
							return;
						}

						const question = currentQuestion();
						const options = currentOptions();

						if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
							optionIndex = wrapOptionIndex(optionIndex, -1, options.length);
							statusMessage = "";
							refresh();
							return;
						}
						if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
							optionIndex = wrapOptionIndex(optionIndex, 1, options.length);
							statusMessage = "";
							refresh();
							return;
						}
						if (matchesKey(data, Key.space)) {
							if (question.multiSelect) {
								toggleFocusedMultiOption();
							}
							return;
						}
						if (matchesKey(data, Key.enter)) {
							confirmFocusedOption();
							return;
						}
						if (matchesKey(data, "o")) {
							startInput("other");
							return;
						}
						if (matchesKey(data, "n")) {
							startInput("notes");
							return;
						}
						if (matchesKey(data, Key.question)) {
							showHelp = true;
							refresh();
						}
					}

					function chipBarLines(width: number): string[] {
						const chips = questions.map((question, index) => {
							const answered = Object.hasOwn(answers, question.question);
							const active = !onSubmitTab() && index === currentQuestionIndex();
							const marker = answered ? "✓" : "○";
							const raw = `[${marker} ${question.header}]`;
							if (active) return theme.bg("selectedBg", theme.fg("text", raw));
							return theme.fg(answered ? "success" : "muted", raw);
						});

						if (multiQuestion) {
							const raw = "[✓ Submit]";
							chips.push(onSubmitTab() ? theme.bg("selectedBg", theme.fg("text", raw)) : theme.fg(allAnswered() ? "success" : "dim", raw));
						}

						return wrapInlineItems(chips, width);
					}

					function addBoxLine(lines: string[], content: string, innerWidth: number) {
						lines.push(`${theme.fg("accent", "│ ")}${padAnsi(truncateToWidth(content, innerWidth), innerWidth)}${theme.fg("accent", " │")}`);
					}

					function optionLines(question: AskUserQuestionQuestion, width: number): string[] {
						const options = displayOptions(question);
						const questionIndex = currentQuestionIndex();
						const multiSelection = question.multiSelect ? currentMultiSelection() : new Set<number>();
						const lines: string[] = [];

						for (let i = 0; i < options.length; i++) {
							const option = options[i];
							const focused = i === optionIndex;
							const selected = isOptionSelected(question, questionIndex, i, option, multiSelection);
							const marker = optionMarker(question.multiSelect, focused, selected);
							lines.push(
								formatOptionLabelLine(focused, selected, marker, option.label, {
									accent: (text) => theme.fg("accent", text),
									selected: (text) => theme.fg("warning", text),
									text: (text) => theme.fg("text", text),
								}),
							);

							const customOtherSelected = option.isOther === true && selected && customOtherAnswers.has(questionIndex);
							const description = formatOptionDescriptionText(option.description, option.isOther, selected, customOtherAnswers.get(questionIndex));
							const descriptionStyle = customOtherSelected ? "warning" : "muted";
							for (const descriptionLine of wrapTextWithAnsi(description, Math.max(1, width - 6))) {
								lines.push(`      ${theme.fg(descriptionStyle, descriptionLine)}`);
							}
						}
						return lines.map((line) => truncateToWidth(line, width));
					}

					function renderPreviewLayout(lines: string[], question: AskUserQuestionQuestion, innerWidth: number) {
						const leftWidth = Math.max(24, Math.min(38, Math.floor((innerWidth - 3) * 0.42)));
						const rightWidth = Math.max(12, innerWidth - leftWidth - 3);
						const options = currentOptions();
						const previewText = options[optionIndex]?.preview ?? "No preview for this option.";
						const leftLines = optionLines(question, leftWidth);
						const rightLines = plainPreviewLines(previewText, rightWidth - 2).map((line) => theme.fg("text", line));
						const rows = Math.max(leftLines.length, rightLines.length);

						addBoxLine(lines, `${theme.fg("accent", "Options")}${" ".repeat(Math.max(1, leftWidth - 7))}   ${theme.fg("accent", "Preview")}`, innerWidth);
						for (let i = 0; i < rows; i++) {
							const left = padAnsi(leftLines[i] ?? "", leftWidth);
							const right = padAnsi(rightLines[i] ?? "", rightWidth);
							addBoxLine(lines, `${left} ${theme.fg("muted", "│")} ${right}`, innerWidth);
						}
					}

					function renderStandardLayout(lines: string[], question: AskUserQuestionQuestion, innerWidth: number) {
						for (const line of optionLines(question, innerWidth)) {
							addBoxLine(lines, line, innerWidth);
						}
					}

					function renderSubmitPickerRow(index: number, label: string): string {
						const focused = submitPickerIndex === index;
						const prefix = focused ? theme.fg("accent", "› ") : "  ";
						const row = `${prefix}${index + 1}. ${label}`;
						return focused ? theme.bg("selectedBg", theme.fg("text", row)) : theme.fg(index === 0 ? "success" : "muted", row);
					}

					function renderSubmitTab(lines: string[], innerWidth: number) {
						addBoxLine(lines, theme.fg("accent", theme.bold("Review your answers")), innerWidth);
						addBoxLine(lines, "", innerWidth);

						for (const question of questions) {
							if (!Object.hasOwn(answers, question.question)) continue;
							const answer = answerDisplayText(answers[question.question] ?? "");
							addBoxLine(lines, `${theme.fg("muted", "• ")}${theme.fg("accent", question.header)}`, innerWidth);
							for (const answerLine of wrapTextWithAnsi(`→ ${answer}`, Math.max(1, innerWidth - 2))) {
								addBoxLine(lines, `  ${theme.fg("text", answerLine)}`, innerWidth);
							}
						}

						const missing = missingQuestionHeaders(questions, answers);
						if (missing.length > 0) {
							addBoxLine(lines, "", innerWidth);
							addBoxLine(lines, theme.fg("warning", `⚠ Answer remaining questions before submitting: ${missing.join(", ")}`), innerWidth);
						}

						addBoxLine(lines, "", innerWidth);
						addBoxLine(lines, renderSubmitPickerRow(0, "Submit answers"), innerWidth);
						addBoxLine(lines, renderSubmitPickerRow(1, "Cancel / return to chat"), innerWidth);
					}

					function render(width: number): string[] {
						if (cachedLines) return cachedLines;
						const safeWidth = Math.max(40, width);
						const innerWidth = safeWidth - 4;
						const lines: string[] = [];
						const question = currentQuestion();
						const title = onSubmitTab() ? " Review answers " : ` Question ${currentQuestionIndex() + 1}/${questions.length} `;
						const topFill = Math.max(0, safeWidth - visibleWidth(title) - 3);

						lines.push(theme.fg("accent", `╭─${title}${"─".repeat(topFill)}╮`));
						for (const chipLine of chipBarLines(innerWidth)) {
							addBoxLine(lines, chipLine, innerWidth);
						}
						addBoxLine(lines, "", innerWidth);

						if (!onSubmitTab()) {
							for (const qLine of wrapTextWithAnsi(question.question, innerWidth)) {
								addBoxLine(lines, theme.fg("text", qLine), innerWidth);
							}
							addBoxLine(lines, "", innerWidth);
						}

						if (onSubmitTab()) {
							renderSubmitTab(lines, innerWidth);
						} else if (showHelp) {
							const helpLines = [
								"↑/↓ or j/k: move focus",
								"space: toggle a multi-select option",
								"enter: confirm this question",
								"o or Other...: type a custom answer",
								"n: add notes for the focused option",
								"tab / shift+tab: jump between questions",
								"esc then esc: dismiss and return to chat",
								"?: close this help",
							];
							for (const line of helpLines) addBoxLine(lines, theme.fg("muted", line), innerWidth);
						} else if (inputMode) {
							addBoxLine(lines, theme.fg("accent", inputMode === "other" ? "Custom answer:" : "Notes:"), innerWidth);
							for (const editorLine of editor.render(innerWidth)) {
								addBoxLine(lines, editorLine, innerWidth);
							}
						} else if (optionHasPreview(question)) {
							renderPreviewLayout(lines, question, innerWidth);
						} else {
							renderStandardLayout(lines, question, innerWidth);
						}

						addBoxLine(lines, "", innerWidth);
						if (statusMessage) {
							addBoxLine(lines, theme.fg("warning", statusMessage), innerWidth);
						}
						const controls = inputMode
							? "Enter submit • Esc back"
							: onSubmitTab()
								? "↑↓/jk move • Enter confirm • Tab questions • Esc Esc return to chat"
								: question.multiSelect
									? "↑↓/jk move • Space toggle • Enter confirm • o Other • n notes • ? help"
									: "↑↓/jk move • Enter select • o Other • n notes • Tab questions • ? help";
						addBoxLine(lines, theme.fg("dim", controls), innerWidth);
						lines.push(theme.fg("accent", `╰${"─".repeat(safeWidth - 2)}╯`));

						cachedLines = lines.map((line) => truncateToWidth(line, safeWidth));
						return cachedLines;
					}

					return {
						render,
						invalidate: () => {
							cachedLines = undefined;
						},
						handleInput,
					};
				})) ?? createCancelledResult();
			} finally {
				ctx.ui.setWorkingVisible(true);
			}

			return {
				content: [{ type: "text", text: stringifyResult(result) }],
				details: result,
				...(shouldTerminateAfterDialog ? { terminate: true } : {}),
			};
		},

		renderCall(args, theme, _context) {
			const params = args as Partial<AskUserQuestionParams>;
			const count = params.questions?.length ?? 0;
			const headers = params.questions?.map((question) => question.header).join(", ") ?? "";
			let text = theme.fg("toolTitle", theme.bold("AskUserQuestion "));
			text += theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`);
			if (headers) text += theme.fg("dim", ` (${headers})`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as AskUserQuestionResult | undefined;
			if (!details) {
				const firstContent = result.content[0];
				return new Text(firstContent?.type === "text" ? firstContent.text : "", 0, 0);
			}
			if (details.cancelled) {
				return new Text(theme.fg("warning", "AskUserQuestion cancelled"), 0, 0);
			}

			const lines = Object.entries(details.answers ?? {}).map(
				([question, answer]) => `${theme.fg("success", "✓ ")}${theme.fg("accent", question)} ${theme.fg("muted", "→")} ${answer}`,
			);
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
