# Eigent Documentation Style Guide

Use this guide when writing or reviewing pages in `docs/`.

## Documentation types

Organize content around the reader's goal:

- **Tutorial:** Helps a new user complete a guided learning experience.
- **How-to guide:** Provides the shortest reliable procedure for a specific goal.
- **Reference:** Describes available options, fields, statuses, or providers.
- **Explanation:** Clarifies concepts, architecture, or design decisions.

Most product pages can combine a short explanation with one or more focused how-to procedures and a compact reference section.

## Standard page structure

Use the following order when it fits the topic:

1. Frontmatter with `title` and `description`
2. One-paragraph overview
3. Prerequisites or **Before you begin**
4. Primary task procedure
5. Feature or option reference
6. Security, privacy, or limitations
7. Troubleshooting
8. Related guides or next steps

Avoid adding sections that do not help the reader complete or understand the task.

## Procedures

- Use numbered steps for multi-step tasks.
- Start each step with an imperative verb.
- State where the action happens before the action.
- Keep one primary action in each step.
- Explain the result after the action when it helps the reader continue.
- Document the shortest accessible path.
- Link to repeated procedures instead of copying them.

## Headings

- Use sentence case.
- Make headings describe the section's content or task.
- Keep headings short.
- Do not skip heading levels.
- Avoid identical headings on the same page.

## Product language

- Match current interface labels.
- Use **Space**, **Project**, **Session**, **Run**, **Context**, **Single Agent**, and **Workforce** consistently.
- Use second person for instructions.
- Prefer present tense and active voice.
- Avoid claims such as “always,” “never,” “best,” or “secure” unless the product guarantees them.
- Mark unavailable features as **Coming soon** and do not provide procedures for them.

## Screenshots

Use a screenshot only when it clarifies a visual UI or a control that is difficult to locate.

When the asset is not ready, leave this visible note:

```md
> **Screenshot placeholder:** Add a screenshot of the relevant UI. Hide credentials and personal data.
```

When adding the final screenshot:

- Crop it to the relevant UI.
- Use consistent operating-system and theme settings.
- Remove personal information with an opaque overlay.
- Add concise, contextual alt text.
- Describe complex information in the surrounding text.
- Do not use a screenshot for code, commands, or terminal output.

## Videos

Prefer MP4 over animated GIF for product walkthroughs.

When the asset is not ready, leave this visible note:

```md
> **Video placeholder:** Add a short MP4 walkthrough. Include captions.
```

When adding the final video:

- Keep it focused on one workflow.
- Include captions.
- Provide a transcript for longer or instructional videos.
- Avoid unnecessary cursor movement and waiting time.
- Use test data and accounts.

## Security and privacy

- Never publish API keys, tokens, cookies, private endpoints, or webhook secrets.
- Use sample data in screenshots and videos.
- State when an action sends data to an external provider.
- Include least-privilege and credential-revocation guidance where relevant.

## Open-source documentation

Keep product docs connected to repository onboarding:

- Explain what the project does and why it is useful.
- Provide a clear setup path.
- Link to support and troubleshooting.
- Document how to run tests and contribute.
- Keep license, README, contributing guidance, and code-of-conduct information discoverable.

## Research references

- [Diátaxis documentation framework](https://diataxis.fr/)
- [Google developer documentation: Procedures](https://developers.google.com/style/procedures)
- [Google developer documentation: Images](https://developers.google.com/style/images)
- [Open Source Guides: Starting an Open Source Project](https://opensource.guide/starting-a-project/)
