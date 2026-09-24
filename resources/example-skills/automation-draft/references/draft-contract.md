# Automation draft contract

Return exactly one fenced `automation-draft` block in the final answer. The JSON object has `version: 1`, `kind: "automation-draft"`, nonempty `name` and `taskPrompt`, a plain-text `description`, `schedule` set to `null` or `{ "text": string, "timezone"?: string }`, and arrays of `{ "name": string, "description": string }` required inputs and string unresolved questions.

The host treats the block as untrusted display data. It validates the schema, shows it in the Automation editor, and requires the user to review the actual schedule before creation. The draft never contains Space, Session, Run, user, or model IDs; the host binds those from the selected task. Never put credentials or secrets in the block.

Keep the JSON block below 12 KB. Keep the prompt below 8,000 characters. Do not claim that a plain-language schedule has already been converted into the editor's recurrence settings.
