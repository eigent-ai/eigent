# Eigent Agent Instructions

## UI work

Before planning, generating, reviewing, or modifying any user-facing UI, read
`docs/design-system/design.md` completely. Treat it as the active product design
contract for all UI work in this repository.

Use `docs/design-system/index.html` as the visual reference. The Markdown
guideline remains authoritative when the two formats differ.

For UI implementation:

1. Inspect the nearest existing product surface for behavior and layout
   context.
2. Reuse primitives from `src/components/ui` before creating a new component.
3. Use the semantic tokens and supported component axes documented in the
   guideline.
4. Treat `src/style/tokens`, `src/style/generated`, and shared UI primitives as
   the executable source of truth. Never edit generated token files by hand.
5. Do not introduce raw colors, arbitrary standard-control geometry, stock
   shadows, new compatibility aliases, or local icon sizing when an approved
   semantic role or recipe exists.
6. When the design guideline and implementation disagree, inspect both and
   report the discrepancy instead of silently inventing a new rule.

Before handing off UI work, report the reused primitives, selected semantic
tokens or component axes, verified states and themes, any registered exception,
and the validation commands that passed or were not run.

## Validation

Run checks in proportion to the UI change. The standard design-system checks
are documented in `docs/design-system/design.md`; at minimum, use focused tests,
type checking, and `git diff --check` when applicable.
