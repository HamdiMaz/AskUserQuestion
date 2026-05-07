# Focused Option Accent Design

## Goal

Make the currently focused `AskUserQuestion` answer easier to see before selection. The focused answer should use the same accent color as the left arrow marker, matching the superpower companion visual style shown in the screenshot.

## Selected approach

Use accent foreground styling on the focused option marker and label only.

- Keep the existing left arrow (`›`) as the focus indicator.
- Style the focused radio/checkbox marker and option label with `theme.fg("accent", ...)`.
- Keep option descriptions muted so the selected label stands out without changing the row density.
- Do not add a full-row background highlight.

## Scope

Change `extensions/ask-user-question.ts` in the option rendering path used by both standard and preview layouts.

The behavior should apply to:

- Single-select radio options.
- Multi-select checkbox options.
- The auto-added `Other...` option.
- Standard option layout.
- Preview split layout.

## Implementation design

The current `optionLines()` function builds a full option row, then applies accent styling to the entire composed row when focused. This can create nested ANSI styling because the focused prefix is already accent-styled. The fix is to build the row from independently styled segments instead:

- Prefix: accent `› ` when focused, two spaces otherwise.
- Marker + label: accent when focused, text color otherwise.
- Description lines: unchanged muted styling.

This keeps the highlighted region limited to the currently focused marker and label, matching the screenshot target.

## Testing

Add focused option row formatting coverage if the rendering helper can be isolated cleanly; otherwise verify through the existing test suite and manual visual inspection in pi. At minimum, run `npm test` after the change.

## Out of scope

- Changing theme tokens.
- Changing tab/chip highlighting.
- Adding a background color to option rows.
- Changing keyboard navigation or answer submission behavior.
