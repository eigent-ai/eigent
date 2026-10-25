# Human reply styling verification

Final-state screenshots captured on 25 October 2026 from the actual
`HumanDecisionCard` and `Inputbox` components in an isolated Vite preview
with the runtime Eigent theme contract applied:

- [Light: highlighted question and neutral disabled composer](light-borders.png)
- [Dark: highlighted question and neutral disabled composer](dark-borders.png)

The human-toolkit question uses `border-ds-border-information-default-default`.
The disabled BottomBox input keeps `border-ds-hairline-default-default`, even
with a saved draft. Resolving the question preserves the draft and restores
the enabled composer's normal information-border treatment.

Both surfaces use the existing composer `rounded-3xl` pattern (24px in the
preview). The question has no shadow. Its answer placeholder uses
`ink.subtle.disabled`, matching `RichChatInput`, and hides on focus/returns on
blur. The zero-padding plain textarea has square inner corners to avoid caret
clipping. Return inherits its button foreground.

Reused primitives: `Textarea` (`plain`, `sm`), `Button` (`primary`, `sm`),
`ShortcutKeycap` (`button`) and `Separator`. Both outer surfaces keep
`bg-ds-neutral-subtle-default`. No token sources, generated files or registered
geometry exceptions changed. The question-only ring suppression and composer
corner pattern are the product owner's requested surface overrides.

Latest validation: 35 focused tests across InputBox, HumanDecisionCard,
ControlInput and BottomBox; type checking; design-token checks; focused
ESLint; Prettier; and `git diff --check` passed. Browser checks cover light/dark,
the focused answer, a retained disabled draft and resolution back to enabled.
Earlier screenshots in this folder record intermediate styling revisions.

These are component previews. Live Electron/backend submission, alternate
palettes, localization, 200% zoom and the full responsive matrix were not run.
Human review is pending. The HTML design viewer still labels itself a proposed
plan on this base; the active Markdown guideline and executable tokens were
authoritative.
