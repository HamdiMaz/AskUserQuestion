# AskUserQuestion for pi

Claude Code-style `AskUserQuestion` tool for the pi coding agent.

This package adds a global LLM-callable tool named `AskUserQuestion`. The tool lets the agent pause mid-task, ask structured questions in your terminal, and continue with your selected answers.

## Features

- Ask 1–8 questions in one tool call
- 2–4 options per question
- Single-select radio choices
- Multi-select checkbox choices
- Auto-added `Other...` custom text input
- Optional per-answer notes with `n`
- Side-by-side preview panel for single-select visual/code comparisons
- Dedicated review/submit tab for multi-question dialogs
- Richer color states for focus, answered tabs, warnings, and review actions
- Arrow-key navigation, plus `j`/`k`
- `Tab` / `Shift+Tab` between questions
- `Esc` then `Esc` dismisses the dialog and returns control to chat
- Input validation before rendering

## Screenshots

These examples show the full multi-question flow rendered by the tool.

### Single-select and custom `Other...` answers

![Single-select question with a custom Other answer](https://raw.githubusercontent.com/HamdiMaz/AskUserQuestion/v1.3.3/screenshots/screenshot-2026-05-09_04-01-35.png)

### Multi-select choices

![Multi-select question with selected choices](https://raw.githubusercontent.com/HamdiMaz/AskUserQuestion/v1.3.3/screenshots/screenshot-2026-05-09_04-02-00.png)

### Side-by-side preview panel

![Single-select question with a side-by-side preview panel](https://raw.githubusercontent.com/HamdiMaz/AskUserQuestion/v1.3.3/screenshots/screenshot-2026-05-09_04-02-26.png)

### Focus and answered-tab states

![Question showing focused answer and completed question tabs](https://raw.githubusercontent.com/HamdiMaz/AskUserQuestion/v1.3.3/screenshots/screenshot-2026-05-09_04-02-47.png)

### Review and submit step

![Review answers screen before submitting](https://raw.githubusercontent.com/HamdiMaz/AskUserQuestion/v1.3.3/screenshots/screenshot-2026-05-09_04-03-04.png)

## Install

From npm:

```bash
pi install npm:@mazli/pi-ask-user-question
```

From GitHub:

```bash
pi install git:github.com/HamdiMaz/AskUserQuestion
```

Pinned to a release tag:

```bash
pi install git:github.com/HamdiMaz/AskUserQuestion@v1.3.3
```

For a one-off test without installing:

```bash
pi -e npm:@mazli/pi-ask-user-question
```

or:

```bash
pi -e git:github.com/HamdiMaz/AskUserQuestion
```

After installing, restart pi or run:

```text
/reload
```

## Tool name

```text
AskUserQuestion
```

## What it returns

Normal result:

```json
{
  "cancelled": false,
  "answers": {
    "Which HTTP client should we use?": "fetch (Recommended)",
    "Which resilience features do you want?": "Retry, Timeout"
  }
}
```

Cancelled or dismissed result:

```json
{
  "cancelled": true
}
```

When the dialog is dismissed with `Esc` then `Esc`, pi returns to the chatbox without an immediate model follow-up so you can steer the conversation.

## Agent usage guidance

Use `AskUserQuestion` when:

- There are 2–4 reasonable paths and the user's preference materially changes the result.
- The task is ambiguous and context is not enough to infer the answer.
- You want to recommend an option while still letting the user steer.

Do not use it for:

- Yes/no confirmation of risky actions. Use pi's permission or confirmation flow instead.
- Plan approval. Use the planning flow instead.
- Questions that can be reasonably inferred from project conventions or prior context.
- More than 8 questions at once. Use sequential calls instead.

Batching guidance:

- `AskUserQuestion` can ask one question or a batch of related questions in the same call.
- Use multiple questions when several independent decisions are needed before continuing.
- Use a single question when only one decision is blocking progress or step-by-step questioning is clearer.
- Batching 2–8 related questions is allowed and often preferred; it is not mandatory.

Authoring rules:

- Ask 1–8 questions per call.
- Provide 2–4 options per question.
- Never include an `Other` option; the tool adds it automatically.
- If recommending an option, place it first and suffix the label with ` (Recommended)`.
- Keep `header` at 12 characters or less.
- End each question with `?`.
- Use previews only for single-select visual/code comparisons.

## Example tool input

```json
{
  "questions": [
    {
      "question": "Which HTTP client should we use?",
      "header": "HTTP",
      "multiSelect": false,
      "options": [
        {
          "label": "fetch (Recommended)",
          "description": "Built-in and dependency-free."
        },
        {
          "label": "axios",
          "description": "Popular ecosystem and interceptor support."
        },
        {
          "label": "got",
          "description": "Node-focused with retry support."
        }
      ]
    },
    {
      "question": "Which resilience features do you want?",
      "header": "Resilience",
      "multiSelect": true,
      "options": [
        {
          "label": "Retry",
          "description": "Retry transient failures."
        },
        {
          "label": "Timeout",
          "description": "Apply a per-request timeout cap."
        },
        {
          "label": "Cache",
          "description": "Cache responses in memory."
        }
      ]
    }
  ],
  "metadata": {
    "source": "clarify"
  }
}
```

## Local development

Clone this repo, then run pi with the extension directly:

```bash
pi -e ./extensions/index.ts
```

Or install the local package:

```bash
pi install /absolute/path/to/AskUserQuestion
```

Then restart pi or run `/reload`.

## Security

Pi extensions run with your local user permissions. Review any extension source code before installing it.

## License

MIT
