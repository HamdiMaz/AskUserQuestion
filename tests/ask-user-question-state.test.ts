import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
