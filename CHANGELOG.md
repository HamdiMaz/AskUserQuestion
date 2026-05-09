# Changelog

## Unreleased

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
