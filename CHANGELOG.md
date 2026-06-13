# Changelog

## Unreleased

- Remove the hard 12-character `header` length limit. The TUI already wraps long headers via `wrapInlineItems`/`truncateToWidth`, so the validation was a false-positive failure source for non-English languages and chip-style long labels. Schema description, prompt guidelines, README, and tests updated accordingly.

## v1.3.7

- Point README screenshot links at the refreshed v1.3.6 image assets.

## v1.3.6

- Default unanswered questions to the first option when switching between questions.
- Refresh AskUserQuestion screenshot assets for the current dialog styling.

## v1.3.5

- Wrap AskUserQuestion option navigation from last to first and first to last.
- Restore focus to the chosen option when revisiting answered questions.
- Count multi-select Space toggles as answered immediately while keeping Enter available for advancing and empty-answer confirmation.

## v1.3.4

- Fix AskUserQuestion dialog top border width so it ends with the corner glyph instead of a truncation ellipsis.

## v1.3.3

- Wrap long `AskUserQuestion` tool-call summaries and dialog question chips instead of truncating later questions.
- Hide Pi's `Working...` row while the `AskUserQuestion` dialog is open.

## v1.3.2

- Replace deprecated pi peer dependencies and imports with `@earendil-works/*` package names.

## v1.3.1

- Add README screenshots for single-select, multi-select, preview, tone, and review/submit states.
- Include screenshot assets in the npm package.

## v1.3.0

- Clarify in the tool prompt that agents can batch 2–8 related questions when useful without making batching mandatory.
- Show previously selected answers with yellow check indicators, display custom `Other...` answers when revisiting questions, and use `[X]` for selected multi-choice options.
- Rename the packaged extension entrypoint to `extensions/index.ts` so Pi's compact startup list shows the package name without `:ask-user-question.ts`.

## v1.2.0

- Highlight the focused answer marker and label in `AskUserQuestion` dialogs with the accent color.

## v1.1.0

- Add a review/submit tab for multi-question `AskUserQuestion` dialogs.
- Improve terminal dialog color hierarchy for focus, answered tabs, warnings, and review actions.
- Change double-Esc dismissal to return control to chat without an immediate model follow-up.

## v1.0.0

- Initial release.
- Adds the `AskUserQuestion` pi extension tool.
- Supports 1–8 structured questions, single-select, multi-select, custom `Other...` answers, notes, preview panels, validation, and cancellation.
