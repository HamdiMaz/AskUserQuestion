import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
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

type DisplayOption = AskUserQuestionOption & { isOther?: boolean };
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

const promptGuidance = `When to use AskUserQuestion:

You face 2-4 reasonable paths and the user's preference materially changes the outcome.
You hit ambiguity that you cannot resolve from context.
You want to surface a recommendation while still letting the user steer.

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

function validateParams(params: AskUserQuestionParams): string | undefined {
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

function optionHasPreview(question: AskUserQuestionQuestion): boolean {
	return !question.multiSelect && question.options.some((option) => option.preview !== undefined);
}

function padAnsi(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
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

function createCancelledResult(): AskUserQuestionResult {
	return { cancelled: true };
}

export default function askUserQuestion(pi: ExtensionAPI) {
	pi.registerTool({
		name: "AskUserQuestion",
		label: "Ask User Question",
		description:
			"Use this tool when you need to ask the user questions during execution. Allows you to gather preferences, clarify ambiguity, get decisions on implementation choices, or offer directional choices. Users always have an Other option to provide custom text. Use multiSelect: true when answers aren't mutually exclusive. If recommending an option, place it first and suffix its label with ' (Recommended)'. Use preview only for visual side-by-side comparisons (mockups, code, diagrams) and only with single-select.",
		promptSnippet: "Ask the user 1-8 structured questions with terminal arrow-key selection and optional custom answers.",
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
			const result =
				(await ctx.ui.custom<AskUserQuestionResult>((tui, theme, _keybindings, done) => {
					let currentQuestionIndex = 0;
					let optionIndex = 0;
					let inputMode: InputMode = null;
					let pendingEscape = false;
					let showHelp = false;
					let statusMessage = "";
					let cachedLines: string[] | undefined;

					const answers: Record<string, string> = {};
					const annotations: Record<string, AskUserQuestionAnnotation> = {};
					const selectedMulti = new Map<number, Set<number>>();
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

					function currentQuestion(): AskUserQuestionQuestion {
						return questions[currentQuestionIndex];
					}

					function currentOptions(): DisplayOption[] {
						return displayOptions(currentQuestion());
					}

					function currentMultiSelection(): Set<number> {
						let selection = selectedMulti.get(currentQuestionIndex);
						if (!selection) {
							selection = new Set<number>();
							selectedMulti.set(currentQuestionIndex, selection);
						}
						return selection;
					}

					function allAnswered(): boolean {
						return questions.every((question) => Object.hasOwn(answers, question.question));
					}

					function moveToNextQuestionOrFinish() {
						if (allAnswered()) {
							const finalAnnotations = Object.keys(annotations).length > 0 ? annotations : undefined;
							done({ cancelled: false, answers, annotations: finalAnnotations });
							return;
						}

						for (let offset = 1; offset <= questions.length; offset++) {
							const candidate = (currentQuestionIndex + offset) % questions.length;
							if (!Object.hasOwn(answers, questions[candidate].question)) {
								currentQuestionIndex = candidate;
								optionIndex = 0;
								statusMessage = "";
								refresh();
								return;
							}
						}
					}

					function saveAnnotation(question: AskUserQuestionQuestion, patch: AskUserQuestionAnnotation) {
						const current = annotations[question.question] ?? {};
						annotations[question.question] = { ...current, ...patch };
					}

					function saveSingleAnswer(option: DisplayOption) {
						const question = currentQuestion();
						answers[question.question] = option.label;
						if (option.preview) {
							saveAnnotation(question, { preview: option.preview });
						}
						moveToNextQuestionOrFinish();
					}

					function saveMultiAnswer() {
						const question = currentQuestion();
						const selection = currentMultiSelection();
						if (selection.size === 0 && !emptySelectionWarnings.has(currentQuestionIndex)) {
							emptySelectionWarnings.add(currentQuestionIndex);
							statusMessage = "No options selected. Press Enter again to confirm an empty answer.";
							refresh();
							return;
						}
						const options = currentOptions();
						const labels = Array.from(selection)
							.sort((a, b) => a - b)
							.map((index) => options[index]?.label)
							.filter((label): label is string => label !== undefined);
						answers[question.question] = labels.join(", ");
						moveToNextQuestionOrFinish();
					}

					function startInput(mode: InputMode) {
						inputMode = mode;
						pendingEscape = false;
						statusMessage = mode === "other" ? "Type a custom answer." : "Add a note for the focused option.";
						editor.setText("");
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
							answers[question.question] = text;
							inputMode = null;
							editor.setText("");
							moveToNextQuestionOrFinish();
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
						emptySelectionWarnings.delete(currentQuestionIndex);
						statusMessage = "";
						refresh();
					}

					function handleInput(data: string) {
						if (matchesKey(data, Key.ctrl("c"))) {
							done(createCancelledResult());
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
								done(createCancelledResult());
								return;
							}
							pendingEscape = true;
							statusMessage = "Press Esc again to cancel.";
							refresh();
							return;
						}
						pendingEscape = false;

						const question = currentQuestion();
						const options = currentOptions();

						if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
							optionIndex = Math.max(0, optionIndex - 1);
							statusMessage = "";
							refresh();
							return;
						}
						if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
							optionIndex = Math.min(options.length - 1, optionIndex + 1);
							statusMessage = "";
							refresh();
							return;
						}
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
							currentQuestionIndex = (currentQuestionIndex + 1) % questions.length;
							optionIndex = Math.min(optionIndex, currentOptions().length - 1);
							statusMessage = "";
							refresh();
							return;
						}
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentQuestionIndex = (currentQuestionIndex - 1 + questions.length) % questions.length;
							optionIndex = Math.min(optionIndex, currentOptions().length - 1);
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

					function chipBar(width: number): string {
						const chips = questions.map((question, index) => {
							const answered = Object.hasOwn(answers, question.question);
							const active = index === currentQuestionIndex;
							const marker = answered ? "✓" : "○";
							const raw = `[${marker} ${question.header}]`;
							if (active) return theme.bg("selectedBg", theme.fg("text", raw));
							return theme.fg(answered ? "success" : "muted", raw);
						});
						return truncateToWidth(chips.join(" "), width);
					}

					function addBoxLine(lines: string[], content: string, innerWidth: number) {
						lines.push(`${theme.fg("accent", "│ ")}${padAnsi(truncateToWidth(content, innerWidth), innerWidth)}${theme.fg("accent", " │")}`);
					}

					function optionLines(question: AskUserQuestionQuestion, width: number): string[] {
						const options = displayOptions(question);
						const multiSelection = currentMultiSelection();
						const lines: string[] = [];

						for (let i = 0; i < options.length; i++) {
							const option = options[i];
							const focused = i === optionIndex;
							const prefix = focused ? theme.fg("accent", "› ") : "  ";
							const marker = question.multiSelect
								? multiSelection.has(i)
									? "[x]"
									: "[ ]"
								: focused
									? "●"
									: "○";
							const label = `${prefix}${marker} ${option.label}`;
							lines.push(focused ? theme.fg("accent", label) : theme.fg("text", label));

							for (const descriptionLine of wrapTextWithAnsi(option.description, Math.max(1, width - 6))) {
								lines.push(`      ${theme.fg("muted", descriptionLine)}`);
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

					function render(width: number): string[] {
						if (cachedLines) return cachedLines;
						const safeWidth = Math.max(40, width);
						const innerWidth = safeWidth - 4;
						const lines: string[] = [];
						const question = currentQuestion();
						const title = ` Question ${currentQuestionIndex + 1}/${questions.length} `;
						const topFill = Math.max(0, safeWidth - visibleWidth(title) - 2);

						lines.push(theme.fg("accent", `╭─${title}${"─".repeat(topFill)}╮`));
						addBoxLine(lines, chipBar(innerWidth), innerWidth);
						addBoxLine(lines, "", innerWidth);

						for (const qLine of wrapTextWithAnsi(question.question, innerWidth)) {
							addBoxLine(lines, theme.fg("text", qLine), innerWidth);
						}
						addBoxLine(lines, "", innerWidth);

						if (showHelp) {
							const helpLines = [
								"↑/↓ or j/k: move focus",
								"space: toggle a multi-select option",
								"enter: confirm this question",
								"o or Other...: type a custom answer",
								"n: add notes for the focused option",
								"tab / shift+tab: jump between questions",
								"esc then esc: cancel the whole prompt",
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

			return {
				content: [{ type: "text", text: stringifyResult(result) }],
				details: result,
			};
		},

		renderCall(args, theme, _context) {
			const params = args as Partial<AskUserQuestionParams>;
			const count = params.questions?.length ?? 0;
			const headers = params.questions?.map((question) => question.header).join(", ") ?? "";
			let text = theme.fg("toolTitle", theme.bold("AskUserQuestion "));
			text += theme.fg("muted", `${count} question${count === 1 ? "" : "s"}`);
			if (headers) text += theme.fg("dim", ` (${truncateToWidth(headers, 50)})`);
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
