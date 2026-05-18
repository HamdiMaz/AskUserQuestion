# Navigation wrapping and multi-select answering design

## Goal

Improve the `AskUserQuestion` dialog keyboard behavior so it feels continuous and preserves useful focus when users revisit answered questions.

## Behaviors

1. Option navigation wraps within the current question:
   - Moving down from the last option focuses the first option.
   - Moving up from the first option focuses the last option.
2. Revisited answered questions restore focus to the chosen answer when possible:
   - Single-select questions focus the selected option, including `Other...` when chosen.
   - Multi-select questions focus the first selected option, or `Other...` if only a custom answer was chosen.
3. Pressing Space on a multi-select option immediately updates that question's stored answer, so the question counts as answered without requiring Enter. Enter remains available to advance/confirm, including the existing empty-answer confirmation flow.

## Design

Add small state helpers in `extensions/index.ts` rather than changing the rendering model:

- A helper resolves the preferred focus index for a question from existing selection state.
- Tab/arrow question navigation calls that helper after changing tabs.
- Up/down option navigation uses modulo arithmetic to wrap around option lists.
- Multi-select toggling updates `answers[question.question]` after every non-Other toggle and clears the answer if the selection becomes empty. Empty answers still require Enter confirmation so accidental blank multi-select answers are not submitted.

## Testing

Add unit tests for the exported pure helpers that cover:

- Wrapping option indexes forward and backward.
- Resolving focus for answered single-select questions.
- Resolving focus for multi-select and Other selections.
- Immediate multi-select answer text updates and clearing after deselection.

Run the existing Node test suite with `npm test`.
