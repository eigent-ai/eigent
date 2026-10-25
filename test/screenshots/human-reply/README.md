# Human reply styling verification

Captured on 25 October 2026 from the actual `HumanDecisionCard` component in
an isolated Vite preview with the runtime Eigent theme contract applied.
The lower sample uses the composer boundary recipe for comparison.
These are component-preview screenshots, not a live Electron task run.

- [Dark, answer focused](dark-typing.png)
- [Light, answer focused](light-typing.png)
- [Light, empty answer focused](light-empty-focused.png)
- [Dark, empty answer focused](dark-empty-focused.png)
- [Light, matching placeholders](light-placeholders.png)
- [Dark, matching placeholders](dark-placeholders.png)

In both themes, the card has no shadow and its border resolves to the same
color as the composer boundary. The question answer has no visible inner
focus ring. Its placeholder hides on focus and returns on blur. The plain
textarea has square corners so the zero-padding text edge does not clip the
caret; the outer card retains its radius. Return inherits the Send feedback text color in both enabled
and blank-answer disabled states. Enter submission was verified in the
browser; Shift+Enter and blank-answer handling are covered by focused tests.

Reused primitives: `Textarea` (`plain`, `sm`), `Button` (`primary`, `sm`),
`ShortcutKeycap` (`button`) and `Separator`. The card keeps `radius-card`
and `bg-ds-neutral-subtle-default` and uses
`border-ds-hairline-default-default`, matching the composer default border.
No token source, generated file or registered geometry exception changed.

The question-only suppression of the textarea ring is the explicitly requested
surface override; the shared plain textarea still retains its standard ring.
The design-system HTML viewer still labels itself a proposed plan on this base;
the active Markdown guideline and executable tokens were authoritative.

Validation: 32 focused Vitest tests; type checking; design-token checks;
focused ESLint; Prettier; and `git diff --check` passed.
Live Electron/backend submission, alternate theme palettes, localization,
200% zoom and the full responsive matrix were not run. Human review is pending.

The placeholder comparison screenshots render the real `RichChatInput` below
the reply card. Both placeholders use `ink.subtle.disabled`: computed colors
match exactly in light and dark modes. The question still hides its placeholder
on focus. The shared Textarea default placeholder color is unchanged.

Placeholder follow-up validation: 12 focused reply/card tests, type checking,
design-token checks, focused ESLint, Prettier and `git diff --check` passed.
