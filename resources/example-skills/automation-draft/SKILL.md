---
name: automation-draft
description: Turn a completed Eigent task into a reusable automation draft when the user asks to repeat or schedule that work.
---

# Draft an automation from a task

Use the selected task's original request, later user corrections, and final result to identify the repeatable job. Keep one-time examples, dates, output paths, and completed results out of the reusable prompt unless the user explicitly wants them repeated.

Ask for missing cadence or timezone only when needed to produce a schedule. Never infer a daily schedule from an unspecific request. Name required files, connections, credentials, and destinations as requirements; do not claim that they are installed or available.

Return a short explanation followed by exactly one fenced `automation-draft` JSON object with this shape:

```automation-draft
{
  "version": 1,
  "kind": "automation-draft",
  "name": "Weekly research summary",
  "description": "Summarise new research for the team.",
  "taskPrompt": "Find research published since the previous run, summarise the key findings, and cite the sources.",
  "schedule": null,
  "requiredInputs": [{"name": "Research sources", "description": "Sources the user wants monitored"}],
  "unresolved": ["Choose a recurrence and timezone"]
}
```

When the user supplied a recurrence, `schedule` may contain `text` and optional `timezone`. Keep its wording faithful; the application verifies whether it can map to a supported schedule. Do not emit a cron expression unless the user supplied one. Keep the draft concise and valid JSON. Never create, enable, or run the automation from this skill; the user reviews it in Eigent's Automation editor.

Check [the draft contract](references/draft-contract.md) before returning the block. Use [the examples](examples/drafts.md) to distinguish a specified recurrence from an unresolved one.
