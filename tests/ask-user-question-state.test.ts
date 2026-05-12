import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import askUserQuestion, {
	answerDisplayText,
	formatOptionDescriptionText,
	formatOptionLabelLine,
	hasSubmitTab,
	isSubmitTab,
	missingQuestionHeaders,
	nextQuestionOrSubmitTab,
	optionMarker,
	promptGuidance,
	promptSnippet,
	submitTabIndex,
	validateParams,
	wrapInlineItems,
} from "../extensions/index.ts";

const questions = [
	{
		question: "Which scope should we use?",
		header: "Scope",
		multiSelect: false,
		options: [
			{ label: "Small", description: "Minimal change." },
			{ label: "Large", description: "Broader change." },
		],
	},
	{
		question: "Which color should we use?",
		header: "Color",
		multiSelect: false,
		options: [
			{ label: "Teal", description: "Balanced accent." },
			{ label: "Orange", description: "Warmer accent." },
		],
	},
];

const longHeaderQuestions = [
	"Tech spec",
	"Design spec",
	"Reviews",
	"Commit rule",
	"Issue export",
	"Startup",
].map((header) => ({
	question: `Which ${header} option should we use?`,
	header,
	multiSelect: false,
	options: [
		{ label: "First", description: "First option." },
		{ label: "Second", description: "Second option." },
	],
}));

const passthroughTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function registerAskUserQuestionTool() {
	let registeredTool: any;
	askUserQuestion({
		registerTool(tool: any) {
			registeredTool = tool;
		},
	} as any);
	return registeredTool;
}

async function withInteractiveTty<T>(fn: () => Promise<T>): Promise<T> {
	const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
	const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
	Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
	Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
	try {
		return await fn();
	} finally {
		if (stdinDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
		else delete (process.stdin as { isTTY?: boolean }).isTTY;
		if (stdoutDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
		else delete (process.stdout as { isTTY?: boolean }).isTTY;
	}
}

describe("AskUserQuestion validation", () => {
	it("accepts a valid multi-question payload", () => {
		assert.equal(validateParams({ questions }), undefined);
	});

	it("rejects duplicate question text", () => {
		assert.equal(validateParams({ questions: [questions[0]!, questions[0]!] }), "duplicate question text; result keying would collide");
	});

	it("rejects previews on multi-select questions", () => {
		const invalid = {
			questions: [
				{
					question: "Which layers should we test?",
					header: "Testing",
					multiSelect: true,
					options: [
						{ label: "Unit", description: "Unit tests.", preview: "not allowed" },
						{ label: "E2E", description: "End-to-end tests." },
					],
				},
			],
		};
		assert.equal(validateParams(invalid), "preview is only supported on single-select questions");
	});
});

describe("AskUserQuestion prompt guidance", () => {
	it("makes batching related questions explicit without requiring it", () => {
		assert.equal(promptSnippet, "Ask the user one or more structured questions, batching up to 8 related questions when useful.");
		assert.match(promptGuidance, /can ask one question or a batch of related questions/i);
		assert.match(promptGuidance, /Use multiple questions when several independent decisions are needed/i);
		assert.match(promptGuidance, /Use a single question when only one decision is blocking progress/i);
	});
});

describe("AskUserQuestion submit tab helpers", () => {
	it("only adds a submit tab for multi-question calls", () => {
		assert.equal(hasSubmitTab(1), false);
		assert.equal(hasSubmitTab(2), true);
		assert.equal(submitTabIndex(1), undefined);
		assert.equal(submitTabIndex(2), 2);
		assert.equal(isSubmitTab(2, 2), true);
		assert.equal(isSubmitTab(1, 2), false);
	});

	it("reports missing question headers", () => {
		assert.deepEqual(missingQuestionHeaders(questions, { [questions[0]!.question]: "Small" }), ["Color"]);
	});

	it("moves to the next unanswered question before the submit tab", () => {
		assert.equal(nextQuestionOrSubmitTab(0, questions, { [questions[0]!.question]: "Small" }), 1);
	});

	it("moves to the submit tab when all multi-question answers are present", () => {
		assert.equal(
			nextQuestionOrSubmitTab(1, questions, {
				[questions[0]!.question]: "Small",
				[questions[1]!.question]: "Teal",
			}),
			"submit",
		);
	});

	it("keeps empty multi-select answers visible in review", () => {
		assert.equal(answerDisplayText(""), "(empty answer)");
		assert.equal(answerDisplayText("Unit tests"), "Unit tests");
	});
});

describe("AskUserQuestion wrapping", () => {
	it("wraps inline chip lists instead of truncating the tail", () => {
		const lines = wrapInlineItems(["[✓ Tech]", "[✓ Design]", "[✓ Reviews]", "[✓ Commit]"], 22);
		assert.deepEqual(lines, ["[✓ Tech] [✓ Design]", "[✓ Reviews] [✓ Commit]"]);
	});

	it("truncates only an individual chip that cannot fit on one line", () => {
		const [line] = wrapInlineItems(["[✓ ExtremelyLongHeader]"], 10);
		assert.ok(line);
		assert.equal(visibleWidth(line), 10);
		assert.match(line, /\.\.\./);
	});

	it("keeps all headers visible in the tool call summary", () => {
		const tool = registerAskUserQuestionTool();
		const component = tool.renderCall({ questions: longHeaderQuestions }, passthroughTheme, {});
		const text = component.render(64).join("\n");
		assert.match(text, /Tech spec/);
		assert.match(text, /Startup/);
	});

	it("keeps all tab chips visible in the custom dialog on narrow terminals", async () => {
		const tool = registerAskUserQuestionTool();
		let renderedText = "";

		await withInteractiveTty(async () => {
			await tool.execute("tool-call-id", { questions: longHeaderQuestions }, undefined, undefined, {
				hasUI: true,
				ui: {
					custom: async (factory: any) => {
						const component = factory({ requestRender() {} }, passthroughTheme, undefined, () => {});
						renderedText = component.render(60).join("\n");
						return { cancelled: true };
					},
					setWorkingVisible() {},
				},
			});
		});

		assert.match(renderedText, /Tech spec/);
		assert.match(renderedText, /Startup/);
	});

	it("keeps the dialog top border within the requested width", async () => {
		const tool = registerAskUserQuestionTool();
		let topBorder = "";

		await withInteractiveTty(async () => {
			await tool.execute("tool-call-id", { questions: [questions[0]!] }, undefined, undefined, {
				hasUI: true,
				ui: {
					custom: async (factory: any) => {
						const component = factory({ requestRender() {} }, passthroughTheme, undefined, () => {});
						topBorder = component.render(60)[0] ?? "";
						return { cancelled: true };
					},
					setWorkingVisible() {},
				},
			});
		});

		assert.equal(visibleWidth(topBorder), 60);
		assert.match(topBorder, /╮$/);
		assert.doesNotMatch(topBorder, /\.\.\.$/);
	});
});

describe("AskUserQuestion working indicator", () => {
	it("hides Pi's working row while the dialog is open and restores it afterwards", async () => {
		const tool = registerAskUserQuestionTool();
		const visibleCalls: boolean[] = [];

		await withInteractiveTty(async () => {
			await tool.execute("tool-call-id", { questions }, undefined, undefined, {
				hasUI: true,
				ui: {
					custom: async () => ({ cancelled: true }),
					setWorkingVisible: (visible: boolean) => visibleCalls.push(visible),
				},
			});
		});

		assert.deepEqual(visibleCalls, [false, true]);
	});
});

describe("AskUserQuestion option rendering", () => {
	const styles = {
		accent: (text: string) => `<accent>${text}</accent>`,
		selected: (text: string) => `<selected>${text}</selected>`,
		text: (text: string) => `<text>${text}</text>`,
	};

	it("colors the focused marker and label with the accent style when not selected", () => {
		assert.equal(
			formatOptionLabelLine(true, false, "●", "VPN only (Recommended)", styles),
			"<accent>› </accent><accent>● VPN only (Recommended)</accent>",
		);
	});

	it("colors selected marker and label with the selected style even when focused", () => {
		assert.equal(
			formatOptionLabelLine(true, true, "✓", "VPN only (Recommended)", styles),
			"<accent>› </accent><selected>✓ VPN only (Recommended)</selected>",
		);
	});

	it("keeps unfocused unselected marker and label in the text style", () => {
		assert.equal(
			formatOptionLabelLine(false, false, "○", "Cloudflare Access", styles),
			"  <text>○ Cloudflare Access</text>",
		);
	});

	it("uses a check mark for selected single-select answers", () => {
		assert.equal(optionMarker(false, false, true), "✓");
		assert.equal(optionMarker(false, true, true), "✓");
	});

	it("uses a capital X for selected multi-select answers", () => {
		assert.equal(optionMarker(true, false, true), "[X]");
		assert.equal(optionMarker(true, true, true), "[X]");
	});

	it("replaces the selected Other description with the custom answer", () => {
		assert.equal(formatOptionDescriptionText("Type a custom answer.", true, true, "Use SQLite"), "Use SQLite");
		assert.equal(formatOptionDescriptionText("Type a custom answer.", true, false, "Use SQLite"), "Type a custom answer.");
		assert.equal(formatOptionDescriptionText("Minimal change.", false, true, "Use SQLite"), "Minimal change.");
	});
});
