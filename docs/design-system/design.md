# Eigent Design System

> **Status: adopted and applied.** This is the active design guideline for
> people and agents generating or changing Eigent product UI. It describes the
> public contract to use in new work. The implementation in `src/style/tokens`,
> `src/style/generated`, and `src/components/ui` is the executable source of
> truth.

Visual references:

- [Applied design-system viewer](index.html)

## 1. Instructions for UI agents

Before changing a surface, inspect these sources in order:

1. This file for the product-wide design contract.
2. The nearest existing product surface for interaction and layout context.
3. `src/components/ui` for an existing primitive or recipe.
4. `src/style/tokens` for semantic roles and supported values.
5. `src/style/tokens/exception.registry.json` before using runtime-coupled or
   platform-specific geometry.

When guidance conflicts, use this priority:

1. Accessibility and product behavior.
2. Existing shared primitive API.
3. Semantic or component token.
4. This document's visual rules.
5. A registered exception.

Do not solve a missing recipe by hiding a new design decision in a long
`className`. Reuse a primitive, extend a named recipe, or register a narrowly
scoped exception with an owner and reason.

## 2. Product character

Eigent UI is calm, compact, and operational. It should feel precise without
becoming sterile:

- Use warm neutral surfaces and Ink hierarchy for most of the interface.
- Reserve strong Accent for the main action or persistent selection in a
  decision context.
- Prefer clear grouping and spacing over extra borders, cards, or shadows.
- Use pill or circular geometry for actions; use bounded radii for fields,
  cards, panels, menus, media, and dialogs.
- Keep dense working surfaces legible. Compact does not mean tiny or crowded.
- Use depth only to explain layering, interaction, or temporary elevation.
- Keep motion brief, physical, and interruptible. State must remain clear when
  reduced motion is enabled.

## 3. System architecture

The system has four active layers plus an exception registry.

| Layer            | Responsibility                                                  | Active source                                          |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| Reference        | Raw dimensions, type seeds, and theme anchors                   | `src/style/tokens/reference.*.json`, `base.color.json` |
| Semantic         | Product intent independent of a component                       | `semantic.*.json`, `tone.assignment.json`              |
| Component recipe | Complete geometry and chrome for primitives                     | `component.recipe.json`, `src/components/ui`           |
| Pattern          | Repeated product compositions                                   | feature/shared components such as `ContentHeader`      |
| Exception        | Runtime, platform, or measured values that cannot be normalized | `exception.registry.json`                              |

Generated files in `src/style/generated` are deterministic outputs. Never edit
them by hand. If a token source changes, regenerate with:

```bash
npm run generate:design-tokens
```

Feature code should normally consume shared primitives and public semantic
utilities. It should not read reference values directly.

## 4. UI generation workflow

For every generated surface:

1. Define the semantic structure and interaction model first.
2. Reuse an existing pattern or primitive.
3. Choose supported component axes: size, variant, tone, emphasis, and state.
4. Choose a typography role; never choose a raw font size.
5. Compose layout with semantic spacing and pattern-owned geometry.
6. Render default, hover, disabled, and selected where applicable.
7. Add focus-visible, loading, empty, error, long-content, and overflow states.
8. Verify light and dark modes, keyboard use, localization, 200% zoom, narrow
   and short windows, and reduced motion.
9. Run the validation gates in §15.

## 5. Color

### 5.1 Public foundation

The public foundation has four groups:

| Group    | Use                                                      |
| -------- | -------------------------------------------------------- |
| Accent   | Brand identity, primary actions, accent selection        |
| Neutral  | Canvas, panels, cards, fields, neutral interaction fills |
| Ink      | Text and icon hierarchy                                  |
| Hairline | Borders, dividers, and reinforcing selection boundaries  |

Each group uses `subtle`, `muted`, `default`, and `strong`. Interactive roles
may use `default`, `hover`, `disabled`, and `selected`.

Common Tailwind utilities:

```text
bg-ds-neutral-subtle-default
bg-ds-accent-strong-default
text-ds-ink-default-default
text-ds-ink-muted-default
border-ds-hairline-default-default
ring-ds-ring-focus
```

Rules:

- Focus is a separate ring treatment, not a fifth public color state.
- Pressed feedback uses motion or elevation. Do not publish an `active` color
  state in new component APIs.
- `inverse` is not an emphasis. Filled controls use the foreground paired with
  their rendered fill.
- A strong Accent fill uses `text-ds-ink-inverse`; do not hard-code white or
  black. The correct foreground flips by theme.
- Compatibility axes and aliases may still exist in implementation. Do not use
  them to design new UI.

### 5.2 Feedback, status, and category color

Use feedback only when the color communicates meaning:

- `success`: completed or confirmed outcome.
- `error`: destructive, failed, blocked, or invalid outcome.
- `warning`: caution that is genuinely amber/warning semantics.
- `information`: neutral informational emphasis.

Use strong feedback fills with their paired foreground, for example:

```text
bg-ds-bg-error-strong-default + text-ds-error-on-strong
bg-ds-bg-success-strong-default + text-ds-success-on-strong
```

Do not use feedback color merely to create visual variety. Status and category
colors are fixed identity roles. Categorical palettes are for differentiation,
not validation or action hierarchy.

## 6. Typography

Use semantic HTML for meaning and a generated role for visual hierarchy. The
two decisions are independent.

Prefer `DsText` from `src/components/ui/ds-text.tsx`:

```tsx
<DsText as="h1" role="page" weight="semibold">
  Workspace
</DsText>
<DsText as="p" role="base">
  Review the latest activity from this run.
</DsText>
```

Text roles at the default 13px base:

| Role         | Size/line | Typical use                       |
| ------------ | --------: | --------------------------------- |
| `meta`       |   11/16px | Timestamp, supporting detail      |
| `base`       |   13/20px | Default product text and controls |
| `body-large` |   15/22px | Comfortable reading, row title    |
| `title`      |   18/24px | Card or dialog title              |
| `section`    |   20/28px | Section heading                   |
| `page`       |   28/36px | Primary view heading              |
| `display`    |   44/52px | Rare high-emphasis moment         |

Code roles are `small` (12/18px), `base` (13/20px), and `large` (15/22px).
Use `channel="code"` for code, terminals, diffs, and fixed-width values.

Rules:

- Use one meaningful `h1` when a view has a primary title.
- Follow heading order; do not choose heading elements for visual size.
- Use `button` for actions and `a` for navigation.
- Do not add unscoped global margins to headings or paragraphs.
- Descriptions and supporting paragraphs inherit the available inline size from
  their owning layout. Feature code must not add a local `max-w-*` constraint
  merely to shorten the copy.
- A constrained reading measure is valid only when it belongs to a shared
  prose or document recipe. The recipe, not an individual paragraph, owns the
  constraint and must support narrow layouts, 200% zoom, and longer localized
  content.
- Weight may change emphasis but never size, icon size, component height, or
  layout geometry.
- Truncated text must expose the full accessible label or an accessible
  tooltip.

## 7. Icons

Use Lucide through `DsIcon` from `src/components/ui/ds-icon.tsx` when the icon
is not already owned by a primitive.

| Recipe         | Size | Stroke | Use                                        |
| -------------- | ---: | -----: | ------------------------------------------ |
| `main-compact` | 12px | 1.25px | Intentionally dense metadata/action        |
| `main`         | 16px | 1.25px | Default controls, rows, fields, navigation |
| `detailed`     | 24px |  1.5px | Roomy feature or empty-state moment        |

```tsx
<DsIcon icon={Search} recipe="main" />
```

Rules:

- Use `currentColor`; the parent primitive owns semantic color.
- Decorative icons are hidden from assistive technology.
- Icon-only controls require an accessible name.
- Do not repair icon sizing with local `w-*`, `h-*`, stroke, margin, or
  translate overrides.
- Icon size never defines the interaction target.
- Use morphing icons only for one persistent control whose state changes in
  place. Update its accessible state and respect reduced motion.

## 8. Spacing and sizing

Use the `ds` spacing scale: 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48,
and 64 nominal pixels. Prefer semantic aliases where the relationship repeats:

```text
gap-ds-control-gap
p-ds-card-inset
p-ds-panel-inset
gap-ds-stack-related
gap-ds-stack-section
px-ds-page-gutter
```

Standard control heights:

| Token/size | Height | Use                                |
| ---------- | -----: | ---------------------------------- |
| `2xs`      |   20px | Exceptional dense metadata control |
| `xs`       |   24px | Compact desktop control            |
| `sm`       |   28px | Header or tab control              |
| `md`       |   32px | Default desktop control            |
| `lg`       |   36px | Prominent desktop control or row   |
| `xl`       |   40px | Form field or comfortable control  |

Do not use control-height tokens for layout rows merely because the numeric
value matches. Canonical headers are separate 40px and 48px pattern recipes.

## 9. Shape, borders, focus, and elevation

### Shape

| Role                          |           Radius |
| ----------------------------- | ---------------: |
| compact control               |              8px |
| field, menu row, media        |             12px |
| card, panel, popover, message |             16px |
| dialog                        |             24px |
| primary/icon action           | full pill/circle |

Full radius is only for a pill or circle. Cards, panels, dialogs, multiline
fields, and media use bounded semantic radii. Directional and connected shapes
belong to their pattern recipe.

### Borders and focus

- Hairline: 0.5px for approved dense desktop separators.
- Thin: 1px default boundary.
- Strong: 2px selected, drop-target, or switch boundary.
- Accent: 4px semantic callout only.
- Default keyboard focus is a 2px semantic ring with a 2px offset.
- Focus must compose with selection and validation and must not be clipped.
- A border-color change alone is not a sufficient focus indicator.

Use `DS_FOCUS_RING` from `src/components/ui/semanticProps.ts` when authoring a
shared interactive primitive.

### Elevation

Use semantic elevation utilities only:

```text
shadow-ds-elevation-control
shadow-ds-elevation-control-hover
shadow-ds-elevation-control-pressed
shadow-ds-elevation-card
shadow-ds-elevation-floating
shadow-ds-elevation-popover
shadow-ds-elevation-dialog
shadow-ds-elevation-drag
```

Rows and inset regions default to no elevation. Do not introduce stock
Tailwind shadows or arbitrary `box-shadow` values into product components.

## 10. Components

Prefer primitives in `src/components/ui` over custom controls. A primitive
owns typography, icon sizing, spacing, shape, boundary, elevation, state, and
motion. Feature code chooses only supported axes.

### Button

Use `Button` with independent semantic axes:

- `variant`: `primary`, `secondary`, `outline`, `ghost`, or `text`.
- `tone`: `neutral`, `success`, `error`, `warning`, or `information`.
- `emphasis`: `subtle`, `muted`, `default`, or `strong`.
- `size`: `xs`, `sm`, `md`, `lg`, or `xl`.
- `buttonContent`: `text` or `icon-only`.

```tsx
<Button variant="primary" tone="neutral" size="md">
  Create task
</Button>

<Button
  variant="ghost"
  size="sm"
  buttonContent="icon-only"
  aria-label="Open settings"
>
  <Settings aria-hidden />
</Button>
```

Use one primary action per decision context. Destructive meaning is
`tone="error"`; do not create different destructive geometry. Deprecated
one-word variants and `inverse` emphasis are compatibility only.

### Forms

Use `Input`, `Textarea`, `Select`, or `InputSelect`. Their shared field recipes
are:

- `sm`: 32px single-line / 64px minimum textarea.
- `default`: 40px single-line / 80px minimum textarea.

`Select` also supports `size="xs"` at 28px for toolbar filters beside
`Button size="sm"`. Regular form selects retain the `sm` and `default` sizes.

The primitive owns label, placeholder, validation, disabled, focus, radius,
and inset behavior. Validation tone is independent from interaction state.

### Tags, badges, rows, menus, and overlays

- Tags and badges are pills using `text.meta`; tone conveys meaning.
- Default menu and product rows are at least 36px; compact rows are 28px.
- Cards use `radius-card` and either a boundary or elevation according to
  hierarchy, not both by habit.
- Popovers and menus use `radius-popover` with popover elevation.
- Dialogs use `DialogContent`, `radius-dialog`, semantic scrim, and dialog
  elevation. Preserve Radix ownership with `asChild` when motion wraps content.

## 11. Repeated patterns

### Canonical content header

Use `ContentHeader` from `src/components/Layout/ContentHeader.tsx`.

- Routine header: 40px row with `Button size="sm"` actions at 28px.
- Prominent header: 48px row with `Button size="md"` actions at 32px.
- Title: `text.body-large`, semibold.
- Keep focus overflow visible.
- Do not create a 44px header variant.
- The title is wrapped in a `span`. When the header must carry a real page
  heading, pass `titleAsChild` and apply `CONTENT_HEADER_TITLE_CLASS` to your
  own element — never nest a heading inside the default wrapper.

### Markdown

Markdown is scoped. Use the existing profile in `src/style/markdown-styles.css`
and `src/components/ChatBox/MessageItem/MarkDown.tsx`; never style global
`p`, headings, lists, tables, or code to change one Markdown surface.

### App shell and working surfaces

Preserve ownership of navigation, split panes, chat scroll anchors, browser
guest bounds, terminals, and preview geometry. These patterns may use
registered exceptions because their values are coupled to runtime measurement
or platform behavior.

### Scroll areas

Product-owned overflow regions use the shared scrollbar recipes from
`src/style/index.css`; do not expose unstyled browser-default scrollbar chrome.

- Use `scrollbar-always-visible` on persistent working surfaces together with
  `overflow-y-auto`. The thumb appears only when content overflows, while the
  stable gutter prevents horizontal layout shift.
- Apply the scrollbar recipe to the element that owns `overflow`, not to an
  outer layout wrapper.
- Use `scrollbar-overlay` only when the scrollbar must sit over transient panel
  content. Use `scrollbar-hide` only when scrolling has another visible control
  or affordance.
- Feature code chooses an approved recipe and must not restyle scrollbar
  pseudo-elements locally. Scrollbar track geometry remains owned by the
  registered `scrollbar-geometry` exception.

## 12. Motion

- Use motion to explain entry, exit, hierarchy, state, or spatial continuity.
- Standard control feedback is approximately 160ms with a restrained ease-out.
- Dialog entry is approximately 200ms; preserve the existing centered Radix +
  Framer Motion implementation.
- Pressed controls may scale to 0.97 and use pressed elevation; do not add a
  public pressed color state.
- Avoid decorative motion in repeated rows or high-frequency work surfaces.
- Honor `prefers-reduced-motion` or `useReducedMotion`; meaning must survive an
  immediate state change.

## 13. Accessibility contract

Every generated UI must satisfy these requirements:

- Normal text and meaningful icons meet WCAG AA contrast in every state.
- Strong fills use their generated foreground pair.
- Keyboard focus is visible, unclipped, and not conveyed by color alone.
- Selected, validation, status, and disabled meaning is not color-only.
- DOM order matches reading and keyboard order.
- Icon-only actions have accessible names.
- Controls remain identifiable when disabled.
- Content survives 200% zoom, longer localization, and dynamic user content.
- Desktop compact targets are at least 24 × 24px. Coarse-pointer targets are at
  least 44 × 44px through the control or a safe hit area.
- Forced colors retain boundaries, focus, selection, and validation meaning.
- Use semantic elements before adding ARIA repairs.

## 14. Exceptions and prohibited shortcuts

Approved exception categories are recorded in
`src/style/tokens/exception.registry.json`. They include AppShell measurement,
chat scroll anchors, Electron guest bounds, split panes, Radix collision data,
third-party viewports, window chrome, scrollbars, media frames, measured
animation values, and sanitized Markdown.

An exception is not permission to repeat an arbitrary value elsewhere.

New UI must not introduce:

- Raw hex, RGB, HSL, or OKLCH colors in feature code.
- Stock palette utilities when a semantic role exists.
- Arbitrary standard-control heights, radii, borders, or shadows.
- New unprefixed CSS variables or compatibility aliases.
- Public `active`, `focus`, or `inverse` emphasis/state axes.
- Local icon sizing that fights a primitive recipe.
- Feature-level `max-w-*` constraints on descriptions or supporting paragraphs
  outside an approved prose or document recipe.
- Global element styles to fix a scoped surface.
- A new primitive when an existing primitive supports the behavior.
- A new component color namespace; components consume foundation color roles.

## 15. Validation and handoff

Run checks in proportion to the change:

```bash
npm run check:design-tokens
npm run type-check
npx vitest run <focused-test-file>
git diff --check
```

Also run `npm run generate:design-tokens` after editing any token source. Run
focused lint or the full `npm run lint` when component code changes.

Before handing off generated UI, report:

1. Which existing primitive or pattern was reused.
2. Which semantic tokens or component axes were selected.
3. Which states and themes were verified.
4. Whether any exception was used or added.
5. Which checks passed and which were not run.

## 16. Historical process material

Historical proposals, migration plans, usage reports, reviews, and viewer build
sources are not shipped as part of the active design-system documentation. The
retained [applied design-system viewer](index.html) is a static visual snapshot;
this guideline and the executable sources named above remain authoritative.
