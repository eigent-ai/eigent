---
title: Eigent Design System - Current State
document_kind: observed-implementation-audit
status: draft-for-review
normative: false
observed_at_utc: 2026-08-21T09:26:58Z
branch: design-system-enhancement
commit: 88f53035
scope: frontend application under src, shared UI primitives, Tailwind configuration, and runtime theme tokens
---

# Eigent Current Token and CSS Baseline

This document records what the application implements today. It is not the
proposed design system and it is not permission to copy every value into new
UI. Accidental fallbacks, incomplete tokens, legacy aliases, and one-off
exceptions are kept visible because the purpose of this baseline is review.

The repository worktree was clean immediately before this document was added.
Static measurements exclude tests and Storybook stories unless stated
otherwise.

## Status legend

- **Implemented**: a live shared definition or component recipe.
- **Partially centralized**: reused in some areas while parallel patterns remain.
- **Exception**: a deliberate specialist surface such as terminal or rendered
  external HTML.
- **Debt**: drift, an undefined reference, conflicting recipes, or an accidental
  browser fallback observed in current source.
- **Unknown intent**: implementation is measurable, but the intended future
  behavior cannot be inferred safely.

## Executive snapshot

The strongest current foundation is the runtime semantic color engine. It
generates theme-aware CSS variables from tone, emphasis, state, and element
axes and applies them for light, dark, and custom themes. Typography, spacing,
radius, border width, and shadow do not have an equivalent single source of
truth.

The current UI is a mixture of:

1. generated `ds-*` semantic colors;
2. legacy/component alias variables;
3. Tailwind core utilities;
4. a small set of custom spacing, radius, type, and shadow extensions;
5. component-local CVA recipes;
6. arbitrary pixel values and global CSS rules;
7. specialist Markdown, terminal, and HTML-preview styles.

Measured high-level debt:

| Area                                      |          Observed source signal |
| ----------------------------------------- | ------------------------------: |
| Valid semantic typography utilities       |                 799 occurrences |
| Raw typography size utilities             |                 243 occurrences |
| Typography utilities that generate no CSS |                  23 occurrences |
| Important type/weight overrides           |                 167 occurrences |
| Custom spacing aliases                    |                  86 occurrences |
| Numeric core spacing utilities            |               2,566 occurrences |
| Arbitrary dimension utilities             |                 300 occurrences |
| Radius utilities                          | 657 occurrences across 10 forms |
| Shadow utilities                          |  85 occurrences across 11 forms |
| Standard one-pixel `border` utilities     |                 227 occurrences |
| Half-pixel border utilities               |                  15 occurrences |

These are source-token counts, not unique rendered elements.

## Source map

| Concern                                               | Current source                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Runtime color axes and transforms                     | [`semantic.color.json`](../../../src/style/tokens/semantic.color.json)       |
| Theme seeds                                           | [`base.color.json`](../../../src/style/tokens/base.color.json)               |
| Generated token manifest                              | [`manifest.json`](../../../src/style/tokens/manifest.json)                   |
| Default theme contract                                | [`default.base.json`](../../../src/style/tokens/contracts/default.base.json) |
| Runtime theme application                             | [`ThemeProvider.tsx`](../../../src/components/Layout/ThemeProvider.tsx)      |
| Tailwind mappings and non-color foundations           | [`tailwind.config.js`](../../../tailwind.config.js)                          |
| Legacy colors and current shadow variables            | [`token.css`](../../../src/style/token.css)                                  |
| Global CSS, font faces, type/spacing/radius variables | [`index.css`](../../../src/style/index.css)                                  |
| Main Markdown document styles                         | [`markdown-styles.css`](../../../src/style/markdown-styles.css)              |
| Shared component color aliases                        | [`ui/tokenAliases.ts`](../../../src/components/ui/tokenAliases.ts)           |
| Shared layout aliases                                 | [`Layout/tokenAliases.ts`](../../../src/components/Layout/tokenAliases.ts)   |

## Foundations

### Color

#### Runtime semantic model - Implemented

The V2 engine defines these axes in
[`semantic.color.json`](../../../src/style/tokens/semantic.color.json#L3):

| Axis     | Current values                                                                       |
| -------- | ------------------------------------------------------------------------------------ |
| Element  | `bg`, `text`, `border`, `icon`, `ring`                                               |
| Tone     | 27 tones: neutral, brand, statuses, session modes, tool surfaces, and feedback tones |
| Emphasis | `subtle`, `muted`, `default`, `strong`, `inverse`, `transparent`                     |
| State    | `default`, `hover`, `active`, `selected`, `focus`, `disabled`                        |

The full semantic axis product is 4,860 possible cells. This is an address
space, not proof that every cell is visually distinct or used.

Current state transforms are:

| State    | Lightness delta | Chroma delta |     Alpha |
| -------- | --------------: | -----------: | --------: |
| default  |               0 |            0 | unchanged |
| hover    |           -0.03 |        +0.01 | unchanged |
| active   |           -0.06 |       +0.015 | unchanged |
| selected |           -0.08 |       +0.015 | unchanged |
| focus    |           -0.05 |        +0.03 | unchanged |
| disabled |           +0.08 |        -0.03 |       0.5 |

Neutral is derived from background plus a separate ink source for text and
icons. Brand derives from the accent seed. Status, session, tool, and feedback
tones are fixed. Declared contrast pairs include 4.5:1 normal-text targets and
a 3:1 large inverse brand-text target.

The default contract is version 2, theme id `eigent`, contrast `43`, and has no
tone, emphasis, state, or cell overrides. Light and dark contracts currently
only extend the base contract and identify the mode.

[`ThemeProvider.tsx`](../../../src/components/Layout/ThemeProvider.tsx#L87)
sets `data-theme`, `data-theme-mode`, `data-color-theme`, the CSS color scheme,
and runtime contrast before applying the generated contract to the root.

#### Tailwind exposure - Partially centralized

Tailwind builds color utilities from
[`manifest.json`](../../../src/style/tokens/manifest.json). The manifest lists
five emphases and omits `transparent`, while the semantic engine lists six.
No production `ds-*-transparent-*` utility use was found. Whether the mismatch
is deliberate is **unknown intent**.

The manifest also exposes 16 category colors across 12 roles, a 192-cell
category address space.

#### Alias layers - Debt

Component and layout aliases such as `--text-heading`, `--border-secondary`,
`--button-primary-fill-default`, and `--dropdown-bg` map older names onto
`ds-*` values. They provide migration compatibility but create two naming
languages for the same semantic colors.

The current hard-coded-color checker scans JavaScript and TypeScript UI source,
not CSS. Global CSS, Markdown CSS, token source files, and specialist terminal
themes therefore contain intentional and legacy concrete colors outside that
guardrail.

### Typography

#### Font families

| Role                       | Current implementation                                                             | Status                |
| -------------------------- | ---------------------------------------------------------------------------------- | --------------------- |
| UI sans                    | Inter, weights 400, 500, 600, 700, 800                                             | Implemented           |
| Display                    | Palatino LT with light, roman, medium, bold, black and italic files                | Exception             |
| Tailwind mono              | SFMono-Regular, Menlo, monospace                                                   | Partially centralized |
| Markdown/new terminal mono | ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace | Partially centralized |
| Legacy terminal            | Courier New, Courier, monospace                                                    | Exception/debt        |
| Rendered external HTML     | system UI sans and system mono stacks injected into the rendered document          | Exception             |

Inter is assigned through `:root`, `html/body`, and also a universal
`* { font-family: 'Inter' }` rule in
[`index.css`](../../../src/style/index.css#L86). The universal rule has already
required a terminal-specific repair because it repainted xterm glyph spans in
proportional Inter. The repair is documented in
[`previewTerminal.css`](../../../src/components/Session/PreviewPanel/tabs/terminal/previewTerminal.css#L15).

One dialog subtitle requests `font-extralight`/200, but weight 200 is not
loaded and `font-synthesis: none` is active. The current browser therefore
selects a nearest available face rather than the requested loaded weight.

The app has Arabic, CJK, Cyrillic, and Latin locales. There is no explicit
locale-aware UI fallback stack; missing glyphs rely on browser/platform
fallback.

#### Atomic size scale

| Token | Size |
| ----- | ---: |
| xs    | 10px |
| sm    | 13px |
| base  | 15px |
| md    | 16px |
| lg    | 18px |
| xl    | 20px |
| 2xl   | 24px |
| 3xl   | 28px |
| 4xl   | 36px |
| 5xl   | 44px |

The root does not set a base font size, so unstyled text falls back to the
browser default rather than `--fontSize-base`.

#### Semantic type recipes

| Recipe       | Size | Line height |
| ------------ | ---: | ----------: |
| label-xs     | 10px |        16px |
| label-sm     | 13px |        20px |
| label-md     | 15px |        20px |
| label-lg     | 18px |        24px |
| body-xs      | 10px |        16px |
| body-sm      | 13px |        20px |
| body-md      | 15px |        22px |
| body-lg      | 20px |        30px |
| heading-sm   | 24px |        32px |
| heading-base | 28px |        36px |
| heading-lg   | 36px |        46px |
| heading-xl   | 44px |        58px |

Weights are separate utilities: regular 400, medium 500, semibold 600, and
bold 700. Tracking is not part of a semantic recipe.

`label-xs` and `body-xs` are visually identical. `label-sm` and `body-sm` are
also visually identical. The semantic names therefore do not define distinct
computed styles at those sizes.

The raw Tailwind sizes are overridden to the custom atomic scale but do not
pair size with a semantic line height. For example, `text-sm` is 13px but may
inherit a different line height from `text-body-sm` at 13/20.

#### Undefined type references - Debt

A fresh Tailwind build confirmed that these current source classes generate no
CSS:

| Missing utility    | Occurrences |
| ------------------ | ----------: |
| `text-body-base`   |          16 |
| `text-heading-xs`  |           2 |
| `text-heading-2xl` |           4 |
| `text-caption`     |           1 |

All four `text-heading-2xl` uses are h1 elements. They currently fall through
to the global legacy `h1 { font-size: 3.2em; line-height: 1.1 }` rule in
[`index.css`](../../../src/style/index.css#L281).

#### Static usage profile

| Pattern                                                             | Occurrences |
| ------------------------------------------------------------------- | ----------: |
| Valid `text-label-*`, `text-body-*`, `text-heading-*` recipes       |         799 |
| Raw `text-xs` through `text-xl` sizes                               |         243 |
| Important `!text-*` recipe overrides                                |         123 |
| Important `!font-*` weight overrides                                |          44 |
| Semantic recipes followed by an explicit local line-height override | 16 elements |
| Named 10px utilities (`label-xs`, `body-xs`, `text-xs`)             |         382 |
| Arbitrary `text-[10px]`                                             |           7 |

### Spacing

#### Named extension

| Token | Value |
| ----- | ----: |
| xs    |   4px |
| sm    |   8px |
| md    |  16px |
| lg    |  32px |
| xl    |  64px |

The scale doubles at every step. It omits commonly used intermediate values
such as 6, 12, 20, and 24px, so numeric Tailwind spacing remains the dominant
language.

Observed static usage:

| Pattern                                                    | Occurrences |
| ---------------------------------------------------------- | ----------: |
| Named spacing aliases such as `gap-sm` or `p-md`           |          86 |
| Numeric Tailwind margin, padding, gap, and space utilities |       2,566 |
| Arbitrary dimension utilities across spacing and sizing    |         300 |

The unused `spacing-multi-value: 8 64` token has no units and is not a valid
single Tailwind spacing length. It appears to be legacy generated residue.

#### Repeated fixed geometry

Current shared and repeated heights include:

| Surface/control               |     Height |
| ----------------------------- | ---------: |
| Button xxs                    |       20px |
| Button xs                     |       24px |
| Button sm                     |       28px |
| Button md                     |       32px |
| Button lg                     |       36px |
| Form field sm                 |       32px |
| Form field default            |       40px |
| Toggle sm/default/lg          | 32/36/40px |
| Content and preview headers   |       44px |
| Workspace agent list          |       46px |
| Enhanced textarea min heights |    40/60px |
| Rich chat input min/max       |   40/200px |

Some are centralized; others repeat as arbitrary `h-[...]` and `min-h-[...]`
utilities at call sites.

### Corner radius

#### Named extension plus Tailwind core

| Utility                     | Current computed value | Source                       |
| --------------------------- | ---------------------: | ---------------------------- |
| `rounded`, `rounded-sm`     |                    4px | core + custom alias          |
| `rounded-md`                |                    6px | Tailwind core                |
| `rounded-lg`                |                    8px | custom alias                 |
| `rounded-[12px]`            |                   12px | arbitrary, two uses          |
| `rounded-xl`, `rounded-2xl` |                   16px | custom alias + Tailwind core |
| `rounded-3xl`               |                   24px | Tailwind core                |
| `rounded-full`              |                 9999px | Tailwind core                |

`rounded` and `rounded-sm` are visual duplicates. `rounded-xl` and
`rounded-2xl` are also visual duplicates. The unused
`borderRadius-multi-value: 4 8` token has no units and no production use.

Observed radius usage:

| Utility          | Occurrences |
| ---------------- | ----------: |
| `rounded-xl`     |         220 |
| `rounded-lg`     |         143 |
| `rounded-full`   |         131 |
| `rounded-md`     |          61 |
| `rounded-2xl`    |          60 |
| `rounded`        |          20 |
| `rounded-sm`     |          10 |
| `rounded-3xl`    |           6 |
| `rounded-none`   |           4 |
| `rounded-[12px]` |           2 |

The current implementation does not have one dominant “full-rounded” rule.
Pills/circles, 8px controls, and 16px surfaces coexist extensively.

### Borders and focus rings

Border and ring colors participate in the semantic color matrix. Border width,
style, placement, and focus-ring geometry do not have a shared token source.

Observed widths:

| Pattern                                     | Occurrences |
| ------------------------------------------- | ----------: |
| Standard one-pixel `border`                 |         227 |
| `border-2`                                  |           6 |
| Half-pixel border variants                  |          15 |
| Four-pixel left borders, mainly blockquotes |           2 |

Zero-width directional overrides are common because many components build a
single separator using `border`, then turn off three sides. Hairlines use
arbitrary `0.5px` values across dialogs, notifications, settings lists,
history, and side-panel primitives.

Focus treatment varies between one-, two-, and three-pixel rings, ring offsets,
border changes, and legacy color aliases. The shared Button base uses a
semantic brand border/ring, while a second shared `FOCUS_RING` recipe still
uses `ring-gray-4`.

### Shadows

#### Named shadows

| Name                     | Current definition                                                                  | Status             |
| ------------------------ | ----------------------------------------------------------------------------------- | ------------------ |
| soft                     | Six-layer large ambient shadow                                                      | Implemented        |
| perfect                  | Alias of `soft`                                                                     | Duplicate          |
| button-shadow            | Inset highlight, drop shadow, and one-pixel outline using concrete hex alpha colors | Implemented        |
| workspace-project-picker | Inset semantic edge plus 4px semantic glow                                          | Component-specific |
| history-item             | Hard-coded `0 3px 4px -1px rgba(0,0,0,.10)`                                         | Component-specific |
| blur-effect              | Refers to undefined `--shadow-blur-effect`                                          | Debt               |

Global `#root`, `.blur`, `.blur-bg`, and `.blur-effect` rules add additional
hard-coded inset shadows and backdrop filters outside the named shadow scale.

Observed utility usage:

| Utility                           | Occurrences |
| --------------------------------- | ----------: |
| `shadow-button-shadow`            |          21 |
| `shadow-sm`                       |          18 |
| `shadow-none`                     |          16 |
| `shadow-lg`                       |          10 |
| `shadow-md`                       |           6 |
| `shadow-perfect`                  |           5 |
| default `shadow`                  |           5 |
| `shadow-xl`                       |           1 |
| `shadow-workspace-project-picker` |           1 |
| arbitrary shadow utilities        |           3 |

Tailwind core `sm`, default, `md`, `lg`, and `xl` shadows coexist with custom
semantic names. They are not derived from the active light/dark theme.

## Shared component recipes

### Button

[`button.tsx`](../../../src/components/ui/button.tsx) has the most complete
current component recipe. It separates variant, tone, size, text/icon layout,
weight override, and radius override.

| Size | Min height | Label recipe | Text padding    | Default text weight | Default icon |
| ---- | ---------: | ------------ | --------------- | ------------------- | -----------: |
| xxs  |       20px | label-xs     | 4px horizontal  | bold                |         14px |
| xs   |       24px | label-xs     | 6px horizontal  | bold                |         14px |
| sm   |       28px | label-sm     | 8px horizontal  | medium              |         16px |
| md   |       32px | label-md     | 16px horizontal | medium              |         24px |
| lg   |       36px | label-lg     | 16px horizontal | bold                |         24px |

Icon-only variants are square at the same five heights and use 12, 14, 16,
20, and 24px icons. The default size recipe applies `rounded-md`/6px. Optional
`buttonRadius` can force `rounded-lg`/8px or `rounded-full`.

The `textWeight` override also changes icon size and uses important utilities:
normal/14, medium/15, semibold/16, and bold/18px.

### Form controls

[`formFieldSurface.ts`](../../../src/components/ui/formFieldSurface.ts)
centralizes height and type for Input, Textarea, SelectTrigger, and InputSelect:

| Control           | Default               | Small                 |
| ----------------- | --------------------- | --------------------- |
| Input             | 40px, body-sm         | 32px, body-sm         |
| SelectTrigger     | 40px, body-sm         | 32px, body-sm         |
| InputSelect       | 40px, body-sm         | 32px, body-sm         |
| Enhanced Textarea | 60px minimum, body-sm | 40px minimum, body-sm |

At the `md` breakpoint, Input and Textarea redundantly add raw `text-sm`; it is
currently the same 13px size as body-sm but does not define the same role.

Visible field titles are rendered as styled div/span content rather than
associated labels in the shared Input, Textarea, SelectTrigger, and InputSelect
implementations. Static call-site counts found 77 uses of these visual title
props. Input and Textarea consume `required` for the visual asterisk instead of
forwarding the native attribute.

### Tag and Badge

Tag has five sizes and uses a full radius at every size:

| Size | Type              | Padding                       | Icon |
| ---- | ----------------- | ----------------------------- | ---: |
| xxs  | label-xs medium   | 6px horizontal, 1px vertical  | 12px |
| xs   | label-xs medium   | 8px horizontal, 2px vertical  | 14px |
| sm   | label-sm medium   | 8px horizontal, 4px vertical  | 16px |
| md   | label-md medium   | 10px horizontal, 4px vertical | 18px |
| lg   | label-md semibold | 12px horizontal, 6px vertical | 20px |

Badge has three named sizes but only two distinct label recipes. It defaults to
`rounded-md` rather than the Tag pill rule.

### MenuButton and Toggle

MenuButton mixes content-driven sizes with fixed 32 and 40px squares. It uses
8px radius for xs, sm, and icon-xs and 16px radius for md. Selected states add
the custom button shadow.

Toggle uses raw `text-sm`, 8px radius, and fixed 32, 36, or 40px heights. Its
outline variant uses Tailwind `shadow-sm`, not the custom button shadow.

### Headers, cards, and dialogs

- `ContentHeader` centralizes a 44px row and 8px horizontal padding.
- `SettingsHeader` renders its title as a focusable h1 with a compact body-md
  visual recipe.
- `ContentHeader`'s direct `title` prop renders as a span.
- `CardTitle` renders as a div with semibold, tight tracking, and no line height.
- `DialogHeader` uses Radix Title/Description with `asChild` spans. This keeps
  dialog labelling hooks but removes native heading/paragraph elements.
- Legacy `DialogTitle` and `DialogDescription` remain exported with body-sm and
  label-sm recipes.

## Semantic DOM audit

Literal production JSX elements:

| Element | Count | Files |
| ------- | ----: | ----: |
| div     | 1,641 |   217 |
| span    |   754 |   151 |
| p       |   149 |    27 |
| h1      |    12 |    10 |
| h2      |     3 |     3 |
| h3      |     8 |     5 |
| h5      |     1 |     1 |

Approximate leaf text-bearing elements are 635 spans, 217 divs, 140
paragraphs, and 22 h1-h3 headings. No `role="heading"` or `aria-level`
alternatives were found.

Tailwind preflight is disabled. The global stylesheet does not reset paragraph
or heading margins. Of 149 paragraphs, only 10 explicitly use `m-0`; 83 have
no margin utility. Replacing a div/span with a semantic element can therefore
change layout through browser defaults even if its type classes are unchanged.

Observed hierarchy inconsistencies include:

- Login and Sign-up screen titles use visually styled divs.
- Spaces Hub uses a div title in its empty state and an h1 in its populated
  state.
- Four h1 elements request the undefined `text-heading-2xl` class.
- `CardTitle` is used 19 times but renders a div.
- Markdown renderers produce semantic h1-h3 elements inside document content,
  while application chrome often uses div/span titles.

## Markdown and rich-content profiles

### Main chat/document Markdown - Active

[`ChatBox/MessageItem/MarkDown.tsx`](../../../src/components/ChatBox/MessageItem/MarkDown.tsx)
uses `marked`, DOMPurify, and the global `.markdown-body` stylesheet. It imports
GitHub Markdown CSS, then overrides it for the application.

Observed type behavior:

- container base: 14px with unitless 1.6 line height;
- paragraphs and lists: 13/20;
- h1: 1.5em/700;
- h2: 1.25em/600;
- h3: 1.1em/600;
- code block: 13px/1.45;
- inline code: 85% of surrounding size;
- compact BottomBox questions: 13/20 with collapsed first/last margins.

Colors, borders, table surfaces, code surfaces, and links include concrete
light/dark GitHub values alongside semantic application tokens.

### Workflow/work-log Markdown - Active

[`WorkFlow/MarkDown.tsx`](../../../src/components/WorkFlow/MarkDown.tsx) uses
ReactMarkdown and a separate component map.

- h1, h2, and h3 are all label-sm/13/20; weight is the main hierarchy signal.
- paragraphs default to label-xs/10/16 with an additional configurable class.
- lists default to label-xs.
- table cells use arbitrary 10px type.
- the wrapper uses `prose prose-sm`, but the Tailwind typography plugin is not
  configured, so those classes generate no CSS.
- global `.markdown-container ol` separately forces 12px, with a stale comment
  calling that value `text-sm` even though current text-sm is 13px.

### Summary Markdown - Apparently inactive

`ChatBox/MessageItem/SummaryMarkDown.tsx` defines a third ReactMarkdown map
using raw `text-xl`, `text-lg`, `text-base`, and `text-sm` styles. No production
import or render use was found in the current scan. This is **apparently
inactive**, not confirmed safe to delete.

## Specialist exceptions

### Display typography

Palatino LT is intentionally limited to welcome/display treatments through
`.history-welcome-headline` and `.font-display`. It should be presented as an
exception in the current viewer, not as the default heading family.

### Terminal

The new preview terminal keeps a fixed dark palette and synchronizes xterm's
measured font with CSS-rendered glyphs through one ui-monospace stack. The
legacy terminal uses Courier New and injects a global `.xterm span`
letter-spacing rule; the new preview explicitly neutralizes that rule.

### External HTML and file previews

Rendered full HTML documents receive an injected system sans/mono stylesheet
inside their iframe. HTML fragments receive the same stack under a scoped
`.eigent-file-content` wrapper. This isolation is intentional and should not be
audited as application UI typography.

### Browser and code surfaces

Terminal, browser preview, raw HTML, Monaco/editor surfaces, and Markdown code
need specialist tests because monospace metrics and third-party DOM can break
under global UI rules.

## Measured debt register

| ID   | Area       | Observation                                                            | Current consequence                                    |
| ---- | ---------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| C-01 | Color      | Semantic engine has `transparent` emphasis; Tailwind manifest does not | Axis exposure differs by consumer                      |
| C-02 | Color      | Legacy aliases coexist with `ds-*` names                               | New UI can choose two naming systems                   |
| C-03 | Color      | Hard-coded color guard excludes CSS                                    | Markdown/global/specialist CSS can drift unnoticed     |
| T-01 | Typography | 23 undefined type utilities                                            | Browser/global fallback rather than requested recipe   |
| T-02 | Typography | Label/body xs and sm are identical                                     | Semantic names do not create distinct roles            |
| T-03 | Typography | 243 raw sizes and 167 important overrides                              | Type composition remains call-site driven              |
| T-04 | Typography | Universal Inter rule                                                   | Third-party/specialist glyph metrics require overrides |
| T-05 | Typography | 200 weight requested but not loaded                                    | Nearest-face fallback                                  |
| T-06 | Typography | No locale-aware fallback stack                                         | CJK/Arabic metrics depend on platform fallback         |
| S-01 | Spacing    | Five-step doubling scale vs 2,566 numeric utilities                    | Named scale does not cover actual layout needs         |
| S-02 | Spacing    | 300 arbitrary dimension utilities                                      | Fixed geometry is frequently local                     |
| S-03 | Spacing    | Repeated 28/32/36/40/44/46px heights                                   | Similar controls use parallel sizing contracts         |
| R-01 | Radius     | `rounded`=`sm`; `xl`=`2xl`                                             | Two names can produce the same shape                   |
| R-02 | Radius     | 657 uses across 10 forms                                               | Shape language is broad rather than role-based         |
| B-01 | Border     | 15 arbitrary half-pixel borders                                        | Hairline behavior varies by device scale               |
| B-02 | Focus      | Ring width, offset, and color recipes vary                             | Keyboard focus treatment is not uniform                |
| H-01 | Shadow     | `perfect` aliases `soft`                                               | Duplicate names with no visual distinction             |
| H-02 | Shadow     | `blur-effect` references an undefined variable                         | Utility has no complete definition                     |
| H-03 | Shadow     | Core and custom shadows coexist                                        | Elevation is not semantic or theme-derived             |
| D-01 | DOM        | Visual titles often render as div/span                                 | Heading navigation is inconsistent                     |
| D-02 | DOM        | Shared form titles are not associated labels                           | Visible and programmatic labels can diverge            |
| D-03 | DOM        | Preflight off and margins not reset                                    | Semantic-tag migration can alter layout unexpectedly   |
| M-01 | Markdown   | Two active style systems plus a third inactive map                     | Content hierarchy changes by surface                   |
| M-02 | Markdown   | `prose` classes exist without the plugin                               | Classes imply styling that is not emitted              |

## Requirements for the current-state viewer

The viewer generated from this document should preserve observed behavior and
make debt visible. It should not silently repair the baseline.

It should show:

1. light and dark runtime color themes;
2. default, hover, active, selected, focus, and disabled states;
3. semantic color coordinates and their generated CSS variable names;
4. all atomic and semantic type styles with computed family, size, line height,
   weight, and tracking;
5. a warning specimen for each undefined typography class;
6. semantic DOM tag and accessible role beside each visual specimen;
7. spacing, fixed-height, radius, border-width, focus-ring, and shadow scales;
8. Button, field, Tag, Badge, MenuButton, Toggle, header, card, and dialog
   recipes;
9. main Markdown, compact question, workflow Markdown, code, table, list,
   blockquote, and task-list fixtures;
10. English, long translated copy, CJK, Arabic/RTL, numbers, and code specimens;
11. specialist display, terminal, and rendered-HTML exceptions;
12. a source link and status label for every specimen.

The improved design system must be documented separately. This current-state
source is intentionally frozen as the comparison baseline once reviewed.

## Unknown intent requiring review

- What values were intended for `body-base`, `heading-xs`, `heading-2xl`, and
  `caption`?
- Is 10px acceptable for interactive and essential information, or only for
  nonessential metadata?
- Should label and body roles remain distinct when their computed styles match?
- Is `transparent` intentionally private to the engine?
- Are 0.5px hairlines an intentional product signature or local visual fixes?
- Are `soft` and `perfect` intended to become different elevations?
- Is the six-layer soft shadow a retained direction or legacy generated output?
- Should the legacy terminal remain visually distinct from the preview
  terminal?
- Is SummaryMarkDown dormant compatibility code or dead code?
- Which controls are intended to be pill/full-rounded by role rather than by
  individual call-site override?

## Audit method

- Read current token JSON, CSS, Tailwind configuration, shared primitives, and
  representative application surfaces.
- Counted static production TS/TSX utility occurrences, excluding tests and
  stories.
- Parsed production TSX to count literal semantic elements and approximate
  leaf text-bearing elements.
- Compiled Tailwind to a temporary file to verify whether questioned utilities
  emit CSS.
- Verified no application source files were changed during the audit that
  produced these measurements.
