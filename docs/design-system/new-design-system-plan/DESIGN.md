# Eigent Design System Plan

> **Status: implementation in progress.** Seed corrections, generated tokens,
> and primitive recipes are landing on this branch. Values in this file are the
> destination contract; call sites migrate toward it in the same PR.
>
> Inverse text on dark Accent fills is a required AA contract (§2.2.1), not a
> retired emphasis. `caution` merges into `error` (§2.7.1) because the
> registered seed is destructive red, not warning amber.
>
> **Three source defects block Phase 2 and are specified here, not deferred:**
> the registered Eigent light Accent seed is `#000000` where the brand is
> `#1d1d1d`, which collapses the light Accent interaction ladder to ΔEOK
> `0.000` (§2.4.1); the shipping interaction transforms miss this document's
> own perceptual gates by 2× (§2.10.1); and no check verifies that a referenced
> token resolves to a declared one (§14.5). Sections 2.4.1, 2.5.1, 2.7.1,
> 2.9.1, 2.10.1, 2.10.2, 3.2.1, and 5.3.1 were added by that audit.

This document describes a proposed ground-up organization for Eigent's visual
system. It is intended to be the source for the proposed HTML review viewer and,
after approval, the durable guide for people and UI-generation tools creating
new product surfaces.

The proposal is designed around five outcomes:

1. The same intent produces the same visual result everywhere.
2. A theme seed can produce visibly distinct, accessible interaction states.
3. Type, icons, controls, spacing, radius, borders, and elevation scale together.
4. Component recipes carry product decisions so feature code does not rebuild
   them from utilities.
5. Necessary layout, native-window, document, and third-party exceptions remain
   explicit and testable.

## 1. Proposed system architecture

The proposed system has four token layers and one documented exception layer.
Feature code should normally consume layers 3 and 4, not layers 1 and 2
directly.

| Proposed layer        | Responsibility                                                  | Example                                        |
| --------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| 1. Reference          | Raw, context-free values                                        | space 8, radius 16, font size 14               |
| 2. Semantic           | Product intent independent of a component                       | surface canvas, text muted, elevation floating |
| 3. Component recipe   | Complete visual contract for a primitive and size               | button md, field md, dialog surface            |
| 4. Pattern/profile    | Composition rules for repeated experiences                      | app shell, chat message, Markdown standard     |
| 5. Exception registry | Values that must remain coupled to runtime or platform behavior | Electron guest radius, Radix available height  |

### 1.1 Proposed source layout

The paths below are approved implementation targets. The goal is to keep
hand-authored intent separate from generated delivery formats.

```text
src/style/tokens/
  reference.dimension.json
  reference.typography.json
  semantic.color.json
  semantic.dimension.json
  semantic.elevation.json
  component.recipe.json
  manifest.json

src/style/generated/
  tokens.css
  tokens.tailwind.cjs
  tokens.types.ts

docs/design-system/
  current-token-usage/
  new-design-system-plan/
  migration-plan/
  scripts/
```

Proposed source-of-truth rules:

- JSON token sources are hand-authored and code-reviewed.
- CSS variables, Tailwind mappings, TypeScript token names, and viewer data are
  generated from the same sources.
- Generated files are deterministic and committed when needed by the build.
- A component recipe may reference only reference or semantic tokens.
- Feature components use shared primitives or named recipes before using a raw
  token.
- Compatibility aliases may exist during migration, but are labeled deprecated
  and have an owner and removal milestone.
- Unknown token names, missing CSS variables, circular aliases, and unitless
  dimensions fail validation.

### 1.2 Proposed naming model

Proposed CSS token grammar:

```text
--ds-ref-{category}-{step}
--ds-{semantic-category}-{role}-{modifier}
--ds-{component}-{size-or-part}-{property}
```

Proposed examples:

```css
--ds-ref-space-8: 0.5rem;
--ds-radius-panel: var(--ds-ref-radius-16);
--ds-elevation-floating: var(--ds-ref-shadow-3);
--ds-button-md-height: var(--ds-control-height-md);
```

The number in a proposed spacing or radius reference name represents its
nominal pixel size at a 16px root. This avoids the current ambiguity where a
utility such as `p-4` means 16px. The actual stored value should use `rem` where
text-relative scaling is beneficial.

## 2. Proposed color behavior

The proposed public color architecture has four primary groups: **Accent
(brand), Neutral, Ink (text), and Hairline (border)**. Each primary group uses
the same four proposed emphasis names—**subtle, muted, default, and strong**—and
only the four proposed public interaction states—**default, hover, disabled,
and selected**—where interaction is applicable.

Focus is not a color state. It is a separate semantic ring treatment that
composes with the four public states. Pressed feedback may use motion or
elevation, but `active` is not proposed as a fifth public color state.

The proposal keeps the existing OKLCH generation foundation, gamut mapping, and
contrast correction. It reorganizes the public contract so a future component
or UI generator can choose group → emphasis → state without inventing a tint or
adding another state.

### 2.1 Proposed primary color groups

| Proposed primary group | Proposed responsibility                                    | Proposed examples                              |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| Accent (brand)         | Brand identity, key action fills, selected accent surfaces | Primary button, selected indicator, brand icon |
| Neutral                | Canvas, panels, cards, fields, neutral interactive fills   | App background, menu row, input background     |
| Ink (text)             | Text and icon hierarchy on supported surfaces              | Heading, body, muted metadata, disabled icon   |
| Hairline (border)      | Boundaries, separators, reinforcing selected borders       | Field border, card keyline, list divider       |

Proposed public token grammar:

```text
--ds-accent-{emphasis}-{state}
--ds-neutral-{emphasis}-{state}
--ds-ink-{emphasis}-{state}
--ds-hairline-{emphasis}-{state}
```

Element-specific generated aliases such as background, text, icon, and border
may continue to exist internally, but they must resolve to this public group,
emphasis, and state contract. Components should consume component aliases rather
than assembling raw group tokens in feature code.

### 2.2 Proposed emphasis levels

The four emphasis names below are the complete proposed public emphasis scale.
The following descriptions are approved.

| Proposed emphasis | Proposed intent                        | Proposed relative behavior                                  |
| ----------------- | -------------------------------------- | ----------------------------------------------------------- |
| Subtle            | Quietest visible expression of a group | Low separation; never invisible when meaning is required    |
| Muted             | Secondary/supporting expression        | Clearer than subtle, below default hierarchy                |
| Default           | Normal expression for the role         | Primary baseline for most UI                                |
| Strong            | Highest non-inverse expression         | Maximum approved separation without changing semantic group |

`inverse` is not proposed as a fifth emphasis level. It is replaced by an
explicit **foreground-pair token**, generated alongside every fill:

```text
--ds-{group}-on-{emphasis}
```

For each generated fill the generator resolves the paired foreground and
records it. The pair is computed from the fill that is actually rendered after
gamut mapping, so it flips by mode automatically. Worked example for the Eigent
Accent `strong` fill:

| Mode  | Resolved strong fill | Paired foreground | Contrast |
| ----- | -------------------- | ----------------- | -------: |
| Light | `#0b0b0b`            | near-white ink    |  19.68:1 |
| Dark  | `#d3c7c1`            | near-black ink    |  10.85:1 |

This pairing is not optional guidance. A dark-mode Accent `strong` fill is
light, so a hard-coded white foreground yields **1.65:1** and fails every
contrast target. Any recipe that renders content on a group fill consumes
`--ds-{group}-on-{emphasis}`; it does not choose a foreground literal, and it
does not assume the light-mode answer.

The foreground pair is a generated output of the fill, not a fifth public
emphasis level, so the four-name public scale above is unchanged.

#### 2.2.1 Inverse text is required on dark brand fills

Eigent's light-mode Accent is a dark brand (`#1d1d1d`). Primary buttons, selected
accent chips, and other content sitting on that fill cannot use default Ink:
`#1d1d1d` on `#1d1d1d` is 1:1. The shipping product solved this with inverse
text (`--text-inverse-primary` / `emphasis="inverse"`). That behavior stays in
the system. What is retired is inverse as a **fill emphasis**, not inverse as a
**foreground**.

Public inverse-text tokens:

```text
--ds-ink-inverse     /* label/icon color on Accent strong fills */
--ds-icon-inverse    /* same value; use for standalone icons on those fills */
--ds-{group}-on-{emphasis}   /* general pair for any group fill */
```

`--ds-ink-inverse` is an alias of `--ds-accent-on-strong`. It is the named
inverse-text role for primary actions. Feedback confirmation fills use
`--ds-{success|warning|error|information}-on-strong` instead of default Ink.

Rules:

1. Filled primary and confirmation recipes MUST use inverse text (the on-pair).
   Default Ink, muted Ink, or a hard-coded white/black is a contrast defect.
2. The pair is computed from the rendered fill after gamut mapping and must
   meet WCAG AA 4.5:1 for normal text. Light-mode Eigent resolves to near-white
   on the dark brand. Dark-mode Eigent resolves to near-black on the light
   brand. Do not hard-code white.
3. Icons inside those recipes inherit the inverse foreground. A child class
   such as `text-ds-ink-muted-default` on a Lucide icon overrides inheritance
   and fails AA.
4. Inverse text is not a fifth public emphasis and is not used for text sitting
   on the canvas. Canvas text uses the Ink ladder (`subtle` / `muted` /
   `default` / `strong`).

### 2.3 Proposed public interaction states

The four states in this table are the complete proposed public color-state
matrix. Static roles may use only `default`; interactive roles expose the states
that apply, but no component may add a fifth public color state.

| Proposed state | Proposed Accent behavior                                           | Proposed Neutral behavior                                        | Proposed Ink behavior                                                   | Proposed Hairline behavior          |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------- |
| Default        | Preserve the approved brand anchor                                 | Preserve the approved surface anchor                             | Use the approved text/icon hierarchy                                    | Use the approved boundary strength  |
| Hover          | Clearly separate from default; lighter in dark mode where approved | Clearly separate the hovered surface                             | Usually stable; change only when needed for contrast or link affordance | May strengthen to reinforce hover   |
| Disabled       | Reduce emphasis while remaining identifiable                       | Remove interactive prominence                                    | Use the disabled text/icon candidate                                    | Use the disabled boundary candidate |
| Selected       | Persistent, clearly separated accent fill                          | Persistent selected neutral fill where accent is not appropriate | Remain stable unless contrast correction requires change                | Persistently reinforce selection    |

Proposed public state rules:

1. Disabled prevents hover color behavior.
2. Selected persists after pointer hover and keyboard focus leave.
3. Validation/feedback meaning remains orthogonal to the four interaction
   states.
4. Pressed behavior is an implementation detail expressed through approved
   motion/elevation and does not publish another color token state.
5. Static Ink and Hairline roles do not generate meaningless hover or selected
   variants merely to fill the matrix.

### 2.4 Proposed theme catalog

The review displays the six themes registered by the system. Each theme owns an
Accent, background, and Ink seed for both light and dark modes; the semantic
generator expands those seeds into the shared color contract.

| Theme    | Light: Accent / background / Ink  | Dark: Accent / background / Ink   |
| -------- | --------------------------------- | --------------------------------- |
| Eigent   | `#1d1d1d` / `#faf7f6` / `#1d1d1d` | `#ede1db` / `#1f1f1f` / `#ffffff` |
| CAMEL    | `#4c19e8` / `#ffffff` / `#1d1d1d` | `#b5afff` / `#1f1f1f` / `#fafafa` |
| Claw     | `#cc7d5e` / `#f9f9f7` / `#2d2d2b` | `#cc7d5e` / `#2d2d2b` / `#f9f9f7` |
| Starfish | `#0169cc` / `#ffffff` / `#0d0d0d` | `#0169cc` / `#111111` / `#fcfcfc` |
| Whale    | `#4460f6` / `#ffffff` / `#000000` | `#4460f6` / `#ffffff` / `#000000` |
| Custom   | `#429f2d` / `#ffffff` / `#0d0d0d` | `#429f2d` / `#111111` / `#fcfcfc` |

Eigent is the mandatory default for the Eigent Design System review. The
primary color matrices therefore initialize from `theme.eigent` in both modes;
displaying the other five catalog palettes must not silently change that matrix
anchor. The Custom row represents the catalog's seeded user-customizable slot,
not a seventh generated theme.

#### 2.4.1 Seed corrections required before Phase 2

The table above is the **brand-approved** catalog. Two registered seeds do not
currently match it, and both must be reconciled in source before token
generation is built on them.

**Eigent light Accent — `#000000` in source, `#1d1d1d` approved.** The brand
Accent is `#1d1d1d` and is not changing. `base.color.json` currently registers
`#000000`. This is not a cosmetic difference: `#000000` sits at OKLCH
`L = 0.000`, the floor of the lightness axis, so every darkening transform
clamps to itself and the Accent interaction ladder collapses.

| Seed               | `default` | `hover`   | `selected` | ΔEOK hover | ΔEOK selected |
| ------------------ | --------- | --------- | ---------- | ---------: | ------------: |
| `#000000` (source) | `#000000` | `#000000` | `#000000`  |  **0.000** |     **0.000** |
| `#1d1d1d` (brand)  | `#1d1d1d` | `#161616` | `#0b0b0b`  |      0.030 |         0.080 |

With the shipping seed the default light theme's primary action has no hover
and no selected feedback whatsoever. The review viewer already overrides the
seed to `#1d1d1d` in order to render a meaningful matrix, so the viewer and the
application currently disagree. `THEME_PRESETS` in `OnboardingSteps.tsx` also
hard-codes `#1d1d1d` — onboarding shows the brand swatch and the app then
applies `#000000`.

Required: set `light.eigent.accent` to `#1d1d1d` in `base.color.json`, and
derive the onboarding presets from that file instead of maintaining a second
hard-coded seed table.

**Whale dark mode is not dark.** Whale registers an identical seed triple for
both modes — background `#ffffff`, Ink `#000000`. Either it is a light-only
theme, in which case it is declared as such and exempted from dark-mode gates,
or its dark seeds are missing and must be authored. It must not stay in the
catalog as a theme whose dark mode silently renders light.

The `#1d1d1d` Accent and `#1d1d1d` Ink seeds in light mode are **intentionally
identical**. Eigent's brand mark and its text color are the same value; this is
a monochrome identity, not a duplicate to be removed under §14.1. See §2.4.2.

#### 2.4.2 Accent and Ink share an anchor in light mode

Because light Accent and light Ink are both `#1d1d1d`, the two groups start
from the same anchor and diverge only through their own ladders. This is
approved and load-bearing, so it is recorded rather than normalized away:

- `accent.default.default` and `ink.default.default` resolving to the same hex
  in light mode is expected. §14.1's duplicate-value rule does not apply to two
  distinct public groups that share a brand anchor by design.
- The divergence is safe only because Ink stays stable across `default`,
  `hover`, and `selected` (§2.5). If Ink ever gains interaction transforms, it
  will drift against the brand anchor and this justification lapses.
- Dark mode keeps Accent and Ink distinct. The dark Accent is warm
  (`#ede1db`, hue ≈ 48°) while the registered dark Ink is pure `#ffffff`, the
  only fully neutral value in an otherwise warm theme.

Recommended dark Ink revision: `#f2ece8` (14.08:1 on `#1f1f1f`, comfortably
above the AA target) instead of `#ffffff` (16.48:1). It shares the Accent's warm
hue family, which removes the cold-text-on-warm-brand clash and reduces
dark-mode glare. Using the Accent seed `#ede1db` itself as Ink (12.87:1) is
rejected: it collapses Ink into Accent in the mode where Accent-as-fill is most
visible. Light Ink stays `#1d1d1d` (15.81:1 on `#faf7f6`).

### 2.5 Proposed primary-group generation behavior

- The review viewer uses the real Eigent Accent seeds: `#1d1d1d` in light mode
  and `#ede1db` in dark mode. A different production theme substitutes its own
  mode-specific Accent seeds without changing the generation contract.
- Each supplied mode seed remains the exact `accent.default.default` anchor
  after gamut safety. Theme generation must not silently replace either seed.
- Every Accent emphasis and state remains in its mode seed's color family.
  Proposed interaction transforms change lightness and, for disabled,
  chroma/alpha; they do not inject a warm hue or extra chroma into the
  near-neutral Eigent seeds.
- Interaction transforms are seed-aware, and direction is chosen by **available
  gamut headroom, not by mode**. Eigent's light-black and dark-beige Accent
  seeds both darken for hover and selected, preserving visible separation
  without pushing the dark seed into white clipping. This is a consequence of
  the headroom rule below, not an independent convention.

#### 2.5.1 Transform direction is chosen by headroom

A seed near either end of the lightness axis can only move one way. The
generator selects the direction with room and states it, rather than assuming
"dark mode lightens":

| Eigent Accent seed | OKLCH `L` | Darken budget | Lighten budget | Direction |
| ------------------ | --------: | ------------: | -------------: | --------- |
| Light `#1d1d1d`    |     0.231 |         0.231 |          0.769 | Darken    |
| Dark `#ede1db`     |     0.918 |         0.918 |      **0.082** | Darken    |

The dark seed has only `0.082` of lightening headroom — less than one hover
step plus one selected step. Lightening it clips: at `subtle` emphasis the
generated `default`, `hover`, and `selected` cells all resolve to `#fffcf6`,
ΔEOK `0.000`. Darkening is therefore the only viable direction in dark mode for
this seed, and any gate that requires dark hover to be _lighter_ is
unsatisfiable (see §14.2).

The light seed has headroom in both directions. Darkening is chosen for
consistency with dark mode, with one constraint: the compound
`strong` + `selected` cell must not fall below `L = 0.05`. Darken-only lands it
at `L = 0.071`, which is inside budget but has no margin, so `strong` is lifted
away from the floor at its row baseline rather than allowed to accumulate.

- Light and dark intentionally have separate Accent ladders because the theme
  owns a seed for each mode. Each ladder stays internally consistent with its
  own Eigent seed.
- Transform direction must remain seed-aware near gamut boundaries. If a
  candidate clips, reduce chroma before allowing a hue change.
- Accent and Neutral backgrounds carry the primary state change.
- Hairline reinforces persistent selection.
- Ink normally remains stable between default, hover, and selected unless
  contrast correction or an explicit interactive-text affordance requires a
  change.
- The four emphasis levels are calibrated independently enough to preserve a
  legible hierarchy within each primary group.

### 2.6 Proposed focus ring color

Focus is proposed as a separate Ring semantic group in generated/internal
tokens, not as a fifth state in Accent, Neutral, Ink, or Hairline.

Proposed focus rules:

- `focus-visible` adds the approved semantic ring to whichever of default,
  hover, disabled, or selected is currently rendered.
- Disabled controls do not normally receive interactive focus, but disabled
  informational elements must remain identifiable.
- The ring does not replace selected fill, selected Hairline, or feedback
  treatment.
- Ring color and width must pass focus-appearance review on every approved
  surface and theme.
- Focus token names must not include an interaction-state slot.

### 2.7 Proposed Feedback colors

Feedback is a separate fixed semantic family, not a fifth primary group and not
derived from the user's Accent seed in the first migration.

Proposed Feedback roles:

- Success
- Warning
- Error
- Information

The existing fixed feedback/status anchors are proposed to remain unchanged
during the first primary-state redesign. A feedback-colored action uses a
Component color recipe for its four public interaction states; the fixed
feedback scale itself is not globally transformed as though it were Accent.

Runtime status meanings are **not** Feedback roles. Feedback has exactly the
four roles listed above. The eleven `status-*` values are a separate fixed
Status family whose members map onto Feedback semantics for color while keeping
their own identity for labelling. The full assignment is in §2.7.1.

#### 2.7.1 Tone axis assignment

The current `manifest.json` declares 22 tones on a single axis. The new model
distributes them across four families. This table is normative and must be
complete before Phase 4 opens; no tone may remain unassigned.

| Current tone         | New family | Role                | Notes                                                               |
| -------------------- | ---------- | ------------------- | ------------------------------------------------------------------- |
| `neutral`            | Neutral    | —                   | Surfaces, panels, fields, neutral fills                             |
| `brand`              | Accent     | —                   | Anchored on the theme Accent seed                                   |
| `success`            | Feedback   | Success             | Outcome meaning                                                     |
| `warning`            | Feedback   | Warning             | Outcome meaning                                                     |
| `error`              | Feedback   | Error               | Outcome meaning                                                     |
| `information`        | Feedback   | Information         | Outcome meaning                                                     |
| `caution`            | Feedback   | Error               | **Merge.** Historical `cuation`/danger red (`#e7000b`), not Warning |
| `status-running`     | Status     | maps to Information | Fixed anchor, retains own label                                     |
| `status-splitting`   | Status     | maps to Information | Fixed anchor, retains own label                                     |
| `status-pending`     | Status     | maps to Information | Fixed anchor, retains own label                                     |
| `status-reassigning` | Status     | maps to Information | Fixed anchor, retains own label                                     |
| `status-completed`   | Status     | maps to Success     | Fixed anchor, retains own label                                     |
| `status-error`       | Status     | maps to Error       | Fixed anchor, retains own label                                     |
| `status-blocked`     | Status     | maps to Error       | Fixed anchor, retains own label                                     |
| `status-paused`      | Status     | maps to Warning     | Fixed anchor, retains own label                                     |
| `status-skipped`     | Status     | maps to Neutral     | Non-failure terminal state                                          |
| `status-cancelled`   | Status     | maps to Neutral     | Non-failure terminal state                                          |
| `single-agent`       | Category   | Agent identity      | Stable identity, no interaction ladder                              |
| `workforce`          | Category   | Agent identity      | Stable identity, no interaction ladder                              |
| `browser`            | Category   | Tool identity       | Stable identity, no interaction ladder                              |
| `terminal`           | Category   | Tool identity       | Stable identity, no interaction ladder                              |
| `document`           | Category   | Tool identity       | Stable identity, no interaction ladder                              |

Two consequences follow from this table:

- **Status is a fourth fixed family, not a Feedback role list.** It keeps
  eleven distinct anchors so runtime state remains legible, and each one
  declares which Feedback semantic it inherits color behavior from. Collapsing
  the eleven into four would make `paused` and `blocked` indistinguishable.
- **`caution` is retired into `error`.** The registered seed is `#e7000b`
  (same destructive red as the old `--text-cuation` role), next to warning
  amber `#d97706`. Merging it into Warning would turn confirm-delete chrome
  amber. It is the only tone removed rather than reassigned.

`status-warning` is **not** a valid tone and never has been. It is absent from
the 22-tone manifest, so the single call site referencing it generates no CSS
(see §14.5 and the scanner requirement in the migration plan).

Feedback must always pair color with text, iconography, or status wording. A
feedback fill is never the only signal.

### 2.8 Proposed Category colors

Category is a separate fixed family for identity, grouping, agent/tool types,
and data visualization. Category roles are approved, and their
approved anchors are proposed to remain stable during the first interaction
state migration.

Proposed Category rules:

- Category anchors do not inherit Accent hover or selected transforms.
- An interactive category row uses Accent or Neutral component chrome for
  hover/selected while the category swatch or identity mark remains stable.
- Category colors are not used for Feedback meaning.
- Category palettes must preserve distinguishability in both themes and must
  have non-color labels or markers where identity matters.

### 2.9 Legacy component-color migration

Component recipes may **reference** foundation color tokens; they may not
**mint** color token names. There is no public Component color group and no
`component.{recipe}.{part}` color-token namespace, even though layer 3 owns a
`component.recipe.json` source file and a
`--ds-{component}-{size-or-part}-{property}` grammar for geometry. That grammar
covers dimensions, not colors. The old component color aliases are migration
inputs, not a family to rename or reproduce in the new system.

During migration, each legacy declaration and call site is classified by its
actual visual responsibility and replaced inside the owning primitive recipe:

| Legacy responsibility        | Replacement source                 |
| ---------------------------- | ---------------------------------- |
| Interactive or selected fill | Accent or Neutral background token |
| Status-bearing fill          | Feedback background token          |
| Label or icon                | Ink token                          |
| Separator or control outline | Hairline token                     |
| Keyboard focus               | Ring token                         |
| Stable category identity     | Category token                     |

Legacy aliases such as `--bg-page`, `--fill-fill-primary`, `--text-heading`,
and `--border-secondary` must not receive automatic one-to-one replacements. If
one old alias serves different meanings across components, the migration splits
those call sites and assigns the correct new foundation token to each recipe.

`secure` remains a proposed dedicated semantic candidate. It
must not be modeled as another interaction state.

#### 2.9.1 Retired states and emphasis levels

The public matrix drops two states (`active`, `focus`) and two emphasis levels
(`inverse`, `transparent`) relative to the shipping axes. These are live in
production source, so each needs a destination rather than a deletion:

| Retired        | Live uses | Destination                                                                                                      |
| -------------- | --------: | ---------------------------------------------------------------------------------------------------------------- |
| `active` state |  see note | Pressed feedback via `elevation-control-pressed` and approved motion                                             |
| `focus` state  |  see note | The separate Ring treatment (§2.6), composed onto the rendered state                                             |
| `inverse`      |        48 | Inverse **text** via `--ds-ink-inverse` / `--ds-{group}-on-{emphasis}` (§2.2.1). Inverse is not a fill emphasis. |
| `transparent`  |         3 | Component recipe with no fill; `ghost`/`text` Button variants (§5.3)                                             |

`active` and `focus` together account for 120 call sites; `inverse` 48;
`transparent` 3. Regenerate these counts from the usage report at the start of
each phase rather than trusting the numbers here.

Three rules govern the retirement:

1. `active` never becomes a color token again. Pressed feedback is elevation
   and motion, per §2.3 rule 4. A call site currently using an `active` color
   is re-expressed as the pressed recipe, not remapped to `selected`.
2. `focus` composes rather than replaces. A control that is `selected` and
   focused renders the selected fill **and** the ring; the old `focus` color
   state could not express that, which is why it is retired.
3. Inverse **fill emphasis** is retired. Inverse **text** is required on dark
   brand fills and is the AA mechanism for primary-button labels (§2.2.1).
   Removing `inverse` without `--ds-ink-inverse` / the on-pair would ship a
   1:1 label on light-mode Accent and a 1.65:1 white label on dark-mode Accent.
   The inverse-text tokens land in Phase 2, before any `inverse` call site is
   touched in Phase 4.

### 2.10 Proposed perceptual gates

The following are initial calibration candidates, not adopted values:

- Default → hover: ΔEOK at least `0.06` for approved interactive roles.
- Default → selected: ΔEOK at least `0.08` for approved interactive roles.
- Default Accent seed remains visually anchored.
- Hover and selected are visibly separated from default in the direction that
  has gamut headroom for the seed (§2.5.1). Direction is not fixed per mode.
- Subtle, muted, default, and strong remain visibly ordered within each primary
  group.
- Every generated fill has a paired foreground (§2.2) meeting the approved
  contrast target against that fill, verified after gamut mapping.
- No seed may be admitted to the catalog whose ladder collapses under these
  thresholds (§2.10.2).
- Ink/background and focus-ring contrast continue to meet the approved WCAG
  target after state transforms and gamut mapping.
- Feedback and Category anchors remain fixed unless separately approved.
- The review viewer exposes failures instead of silently substituting an
  indistinguishable candidate.

These proposed candidates must be tested across all four primary groups, all
four emphasis levels, the four applicable interaction states, both modes, and
the supported contrast-control range before adoption.

#### 2.10.1 The current production transforms do not meet these gates

The thresholds above are met by the proposed contract in the review viewer,
which is validated at build time. They are **not** met by the transform table
that ships today in `semantic.color.json`:

| Transform  | Shipping `dL` | Resulting ΔEOK on the Eigent seed | Gate   | Result            |
| ---------- | ------------: | --------------------------------: | ------ | ----------------- |
| `hover`    |       `-0.03` |                           `0.030` | `0.06` | **fails by 2×**   |
| `selected` |       `-0.08` |                           `0.080` | `0.08` | passes, no margin |

The Eigent Accent seed is achromatic (`C = 0.000`), so the accompanying
`dC` component contributes nothing and ΔEOK reduces to `|dL|`. Chromatic themes
gain a little from `dC`; the default theme gains none. `selected` sitting
exactly on its threshold means any gamut clamp drops it below.

Retuning to `hover ≈ ±0.07` and `selected ≈ ±0.10` clears both gates with
margin. The contrast pairs in §2.2 must be recomputed after any retune, because
moving a fill moves its paired foreground.

#### 2.10.2 Seed admission gate

Theme seeds are validated before they enter the catalog, not only after the
ladder is generated. A seed is rejected when, after gamut mapping:

- any adjacent emphasis or state cell pair falls below the ΔEOK thresholds
  above, in either mode; or
- any generated fill has no foreground meeting the contrast target; or
- a mode's background and Ink seeds do not differ enough to establish that mode.

This single gate catches all three seed defects found in the current catalog:
`#000000` collapsing the light Accent ladder to ΔEOK `0.000`, the dark `subtle`
row clipping at `#fffcf6`, and Whale's dark mode rendering as a light theme.
Seed validation is a Phase 2 deliverable and runs on every theme, including
user-customized Custom seeds.

## 3. Proposed typography system

Typography has three per-instance decisions:

1. Semantic element: what the content means.
2. Channel: product text or code.
3. Generated role: where the content participates in hierarchy.

Font family and base size are user preferences that seed the whole system. They
are not one-off component choices. Changing a role must not require changing
semantic HTML, and using an `h2` must not introduce layout margins that the
owning stack did not request.

### 3.1 Adjustable typography seeds

The locally installed Codex desktop app uses separate compact numeric controls
for UI and code size, plus separate UI and monospaced family selectors. Eigent
adopts that interaction pattern while deliberately using the requested 13px
default for both channels.

| User setting   | Proposed default                  | Proposed range / behavior                          |
| -------------- | --------------------------------- | -------------------------------------------------- |
| Text font      | Inter with system sans fallback   | Select supported text family or system fallback    |
| Text base size | 13px                              | 11–16px, 1px steps, commit on blur or Enter        |
| Code font      | SF Mono with system mono fallback | Select a monospaced family or system mono fallback |
| Code base size | 13px                              | 8–24px, 1px steps, commit on blur or Enter         |

Proposed setting rules:

- Clamp manually entered values before saving; the HTML `min` and `max`
  attributes are not the validation boundary.
- Text and code settings are independent. Changing text never changes code, and
  changing code never changes product text.
- Base sizes and families are global user preferences. Theme and density
  switches do not silently change them.
- The font menu may enumerate installed fonts when the platform allows it. It
  must always provide System default and a validated custom fallback stack.
- Code choices are monospaced-only. Terminal, diff, code review, inline code,
  and code blocks consume the same code seed.
- The review viewer starts deterministically at 13px / 13px on every reload;
  the future application setting may persist the approved values.
- Browser or window zoom remains a separate accessibility control. It must not
  be encoded as a typography preference.

### 3.2 Connected generated scale

All sizes in a channel derive from its selected base. Feature code selects a
semantic role and never selects a pixel value.

```text
size(role) = max(role floor, round(channel base × size ratio))
line(role) = max(size(role), round(channel base × line ratio))
```

The general text floor is 11px, `text.meta` may reach 10px when the user selects
a smaller base, and the code floor is 8px. Ratios are anchored to the 13px
default so the initial scale remains easy to inspect and compare.

| Text role         | Size ratio | Line ratio | Result at 13px | Typical use                        |
| ----------------- | ---------: | ---------: | -------------: | ---------------------------------- |
| `text.meta`       |      0.846 |      1.231 |        11/16px | Timestamp and supporting detail    |
| `text.base`       |      1.000 |      1.538 |        13/20px | Default product text and controls  |
| `text.body-large` |      1.154 |      1.692 |        15/22px | Comfortable reading and row titles |
| `text.title`      |      1.385 |      1.846 |        18/24px | Dialog and card title              |
| `text.section`    |      1.538 |      2.154 |        20/28px | Section heading                    |
| `text.page`       |      2.154 |      2.769 |        28/36px | Primary page heading               |
| `text.display`    |      3.385 |      4.000 |        44/52px | Approved high-emphasis moment only |

| Code role    | Size ratio | Line ratio | Result at 13px | Typical use                           |
| ------------ | ---------: | ---------: | -------------: | ------------------------------------- |
| `code.small` |      0.923 |      1.385 |        12/18px | Compact diff and terminal metadata    |
| `code.base`  |      1.000 |      1.538 |        13/20px | Default code, diff, and terminal text |
| `code.large` |      1.154 |      1.692 |        15/22px | Prominent code or terminal output     |

Controls reuse a generated size instead of adding label-size tokens. For
example, Button `sm` uses `text.base` at 13px and a component-owned compact
line ratio of 16/13. The compact line is part of the Button recipe; it is not a
second independent font size.

When a user changes a base, every role in that channel is recalculated and
rounded to a whole CSS pixel. If a larger setting no longer fits, the component
or layout grows, wraps, or truncates through an approved accessible pattern; it
must not shrink the user's selected type ad hoc.

#### 3.2.1 Migration map from the shipping type scale

The shipping scale is `text-{body,label,heading}-{xs…2xl}`, spanning roughly
820 call sites. The generated migration diff covers CSS variables only and does
not reach these utilities, so the mapping is declared here. This table must be
complete before Phase 3 step 1 opens.

| Shipping utility | Value | Uses | New role          | Change                   |
| ---------------- | ----- | ---: | ----------------- | ------------------------ |
| `body-sm`        | 13/20 |  363 | `text.base`       | none                     |
| `label-sm`       | 13/20 |   96 | `text.base`       | none                     |
| `label-xs`       | 10/16 |  147 | `text.meta`       | **+1px** size            |
| `body-xs`        | 10/16 |  134 | `text.meta`       | **+1px** size            |
| `body-md`        | 15/22 |   30 | `text.body-large` | none                     |
| `label-md`       | 15/20 |    9 | `text.body-large` | line +2px                |
| `body-lg`        | 20/30 |    5 | `text.section`    | line −2px                |
| `label-lg`       | 18/24 |    2 | `text.title`      | none                     |
| `heading-base`   | 28/36 |    4 | `text.page`       | none                     |
| `heading-sm`     | 24/32 |    2 | `text.page`       | **−4px**; 24px step gone |
| `heading-lg`     | 36/46 |    5 | `text.display`    | **+8px**; 36px step gone |
| `heading-xl`     | 44/58 |    2 | `text.display`    | line −6px                |
| `body-base`      | —     |   16 | `text.base`       | **undefined today**      |
| `heading-xs`     | —     |    2 | `text.meta`       | **undefined today**      |
| `heading-2xl`    | —     |    4 | `text.display`    | **undefined today**      |

Four points need sign-off before this map is applied:

- **The bulk is exact.** 459 of ~820 call sites (`body-sm` and `label-sm`) map
  to `text.base` at identical 13/20px. The migration is mostly a rename.
- **281 call sites gain 1px.** `text.meta` floors at 11px while `label-xs` and
  `body-xs` ship at 10px. §3.2 permits `text.meta` to reach 10px only when the
  user selects a smaller base. Either accept the 10→11px shift on dense
  metadata as a deliberate legibility improvement, or lower the `text.meta`
  floor to 10px at the 13px default. This is a design decision, not a
  mechanical one.
- **The 24px and 36px steps disappear.** The new scale jumps 20 → 28 → 44px.
  Nine call sites currently sit on the removed steps. Accept the reassignment
  above, or add the missing steps to the scale.
- **22 call sites reference utilities that generate no CSS.** `body-base`,
  `heading-xs`, and `heading-2xl` are used in source but absent from
  `tailwind.config.js`. They render at inherited size today, so their "current"
  appearance is not what the class name implies. Verify each visually rather
  than assuming the mapping preserves behavior.

### 3.3 Families and weights

| Proposed token    | Proposed value                  | Proposed use                                    |
| ----------------- | ------------------------------- | ----------------------------------------------- |
| `font.text`       | User-selected text family/stack | Product interface, headings, labels, and prose  |
| `font.code`       | User-selected monospaced stack  | Code, terminal, diffs, and fixed-width values   |
| `weight.regular`  | 400                             | Long-form text and default body                 |
| `weight.medium`   | 500                             | Display text and low-emphasis labels            |
| `weight.semibold` | 600                             | Titles, controls, and important labels          |
| `weight.bold`     | 700                             | Content emphasis, not a layout or hierarchy fix |

Weight never changes font size, icon size, spacing, or component height.
Switching family updates every consumer of that channel without changing role
names. Layouts must tolerate the approved families' real glyph widths and line
metrics; a family switch must not be repaired with per-screen offsets.

### 3.4 Semantic HTML rules

- Use one meaningful `h1` for the primary view title when the view has a title.
- Use `h2`–`h6` in document order; do not choose a heading element for its size.
- Use `p` for prose paragraphs and `li` for list items.
- Use `span` only for inline content and `div` for layout/grouping with no better
  semantic element.
- Use `label` linked to its control, `button` for actions, `a` for navigation,
  `time` for dates/times, and `code`/`pre` for code.
- Headings and paragraphs have no unscoped global margins. A Stack or content
  profile owns rhythm.
- A proposed typography primitive may accept `as`, but its default semantic
  element must match its role and be visible in review tooling.
- Feature code must not imitate a heading with a bold `div` when a heading is
  semantically correct.
- Truncation requires an accessible full label through visible context,
  `aria-label`, or an accessible tooltip.

Proposed example:

```tsx
<Text as="h2" role="section">Project activity</Text>
<Text as="p" role="base">Latest changes from this run.</Text>
```

## 4. Proposed icon system

Lucide is the base icon library. Icons are selected for meaning first, then
rendered through one of two optical recipes. A component must not invent its
own icon size, stroke, alignment, or animation.

### 4.1 Proposed optical sizes

| Proposed token      | Rendered size | Stroke | Proposed use                                                              |
| ------------------- | ------------: | -----: | ------------------------------------------------------------------------- |
| `icon.main`         |          16px | 1.25px | Default controls, rows, navigation, fields, and inline status             |
| `icon.main-compact` |       12–15px | 1.25px | The main icon scaled down where space is intentionally dense              |
| `icon.detailed`     |          24px |  1.5px | Feature moments, roomy navigation, empty states, and larger illustrations |

The 16px version is the default. It is authored and reviewed to remain legible
when scaled down to 12px. The stroke remains 1.25px; parent selectors must not
silently thicken it when the surrounding text weight changes.

The 24px version uses the room for slightly more detail and a 1.5px stroke. It
is not the automatic “large” version of every control icon and must not be
shrunk into a 16px slot. Both recipes use a 24 × 24 Lucide coordinate grid;
rendered size and optical treatment are owned by the icon primitive.

Icon size never defines the interaction target. The surrounding Button,
IconButton, row, or trigger continues to own its approved 28px, 32px, 40px, or
coarse-pointer hit area.

### 4.2 Proposed static icon rules

- Import icons from `lucide-react`; do not mix icon libraries for ordinary
  actions, objects, navigation, or status.
- Decorative icons use `aria-hidden="true"`. An icon that carries meaning
  without visible text receives an accessible label on its owning control.
- Use `currentColor` so the semantic Ink or icon token controls color.
- Do not use filled and outline variants interchangeably to create hierarchy.
  Hierarchy comes from the component recipe and semantic color.
- Avoid local `w-*`, `h-*`, stroke-width, negative-margin, and translate fixes.
  Use the icon primitive's `main`, `main-compact`, or `detailed` recipe.
- If a Lucide glyph is not legible at 12–16px, choose a simpler Lucide glyph or
  register a reviewed optical exception; do not add detail at the call site.

### 4.3 Proposed state-changing icon rules

`morphicons` is installed for a narrow purpose: one persistent control whose
meaning changes in place. The React integration consumes Lucide icon data and
animates when the controlled icon changes.

Approved initial patterns:

| Pattern           | Endpoints                    | State semantics                              |
| ----------------- | ---------------------------- | -------------------------------------------- |
| Playback          | Play ↔ Pause                 | The same playback control toggles state      |
| Action completion | Send ↔ Check                 | A send action visibly reaches completion     |
| Disclosure        | Chevron right ↔ Chevron down | One accordion trigger updates expanded state |

```tsx
import { MorphIcon } from 'morphicons/react';
import { Pause, Play } from 'lucide';

<button aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlayback}>
  <MorphIcon
    icon={playing ? Pause : Play}
    size={16}
    strokeWidth={1.25}
    reducedMotion="user"
  />
</button>;
```

The application state remains outside the icon. The visible label,
`aria-label`, `aria-expanded`, or other stateful semantics update with the icon.
Use `reducedMotion="user"` so the transition becomes an immediate swap when
the user requests reduced motion.

Morphicons is not used for unrelated actions, decorative hover motion, loading
spinners, or icons moving between different buttons. A send button becoming a
cancel button requires a product-state review; animation does not make two
different commands semantically interchangeable.

### 4.4 Proposed icon acceptance gates

- New ordinary icons resolve to Lucide and one approved optical recipe.
- Main icons pass visual review at both 16px and the 12px lower bound.
- Detailed icons pass visual review at 24px and are not used as routine compact
  controls.
- Stateful morph endpoints remain recognizable before, during, and after the
  transition in light and dark themes.
- Keyboard focus, accessible name, expanded/pressed state, and hit area belong
  to the control and remain correct when the icon changes.
- Reduced motion produces an immediate state change without losing meaning.

## 5. Proposed spacing and sizing

Spacing describes relationships. Control height, icon size, layout width, and
media dimensions are separate categories even when they share a numeric value.

### 5.1 Proposed reference spacing scale

| Proposed token | Proposed nominal value | Proposed intent                  |
| -------------- | ---------------------: | -------------------------------- |
| `space-0`      |                    0px | Reset only                       |
| `space-2`      |                    2px | Optical micro-adjustment         |
| `space-4`      |                    4px | Tight inline relationship        |
| `space-6`      |                    6px | Compact icon/label gap           |
| `space-8`      |                    8px | Default inline/compact stack gap |
| `space-10`     |                   10px | Button sm/md inline padding      |
| `space-12`     |                   12px | Default component inset/gap      |
| `space-14`     |                   14px | Button lg inline padding         |
| `space-16`     |                   16px | Comfortable component inset      |
| `space-20`     |                   20px | Small region separation          |
| `space-24`     |                   24px | Card/section inset               |
| `space-32`     |                   32px | Section separation               |
| `space-40`     |                   40px | Large section separation         |
| `space-48`     |                   48px | Page-region separation           |
| `space-64`     |                   64px | Major page rhythm                |

Proposed semantic aliases, include `space-control-gap`,
`space-control-inline`, `space-card-inset`, `space-panel-inset`,
`space-stack-related`, `space-stack-section`, and `space-page-gutter`.

Negative margins and one-off optical translations are allowed only through an
approved component recipe or exception. They are not general spacing tokens.

### 5.2 Proposed control and icon scales

| Proposed token                | Proposed value | Proposed use                                    |
| ----------------------------- | -------------: | ----------------------------------------------- |
| `control-height-2xs`          |           20px | Exceptional dense metadata action               |
| `control-height-xs`           |           24px | Compact desktop action                          |
| `control-height-sm`           |           28px | Header/tab compact action                       |
| `control-height-md`           |           32px | Default desktop action                          |
| `control-height-lg`           |           36px | Prominent desktop action                        |
| `control-height-xl`           |           40px | Form field / comfortable action                 |
| `layout-row-header`           |           40px | Canonical page/panel header, not a control size |
| `layout-row-header-prominent` |           48px | Key page/section header, not a control size     |
| `icon-size-xs`                |           12px | Dense metadata                                  |
| `icon-size-sm`                |           14px | Compact control                                 |
| `icon-size-md`                |           16px | Default control                                 |
| `icon-size-lg`                |           20px | Large control/empty state                       |
| `icon-size-xl`                |           24px | Feature icon, not routine button default        |

Proposed sizing rules:

- Label line height, icon size, gap, padding, and outer height are one recipe.
- Font weight never changes icon size.
- Text and icon-only forms of the same size share an outer height.
- Icon-only controls are square unless their component role explicitly says
  otherwise.
- A child icon's size is controlled through the primitive API or an approved
  icon slot; parent selectors do not silently override arbitrary `h-* w-*`
  classes.
- Standard desktop pointer targets are at least 24 × 24px. Touch/coarse-pointer
  targets are at least 44 × 44px through the visible control or its hit area.
- Layout widths, split-pane minimums, chart dimensions, and media frames do not
  use control or spacing tokens merely because their values happen to match.

### 5.3 Proposed button recipes

The values below are approved by component-matrix review.

| Size | Height | Type role                    | Icon | Gap | Inline padding | Default shape |
| ---- | -----: | ---------------------------- | ---: | --: | -------------: | ------------- |
| `xs` |   24px | `text.meta` / 16px line      | 12px | 4px |            6px | Pill          |
| `sm` |   28px | `text.base` / compact line   | 16px | 6px |           10px | Pill          |
| `md` |   32px | `text.base` / default line   | 16px | 8px |           10px | Pill          |
| `lg` |   36px | `text.base` / default line   | 16px | 8px |           14px | Pill          |
| `xl` |   40px | `text.body-large` / own line | 16px | 8px |           16px | Pill          |

#### 5.3.1 Size-axis migration and the icon change

Heights are unchanged for the three common sizes, but the size _set_ and the
icon contract both move. These are deliberate visual changes, not
behavior-preserving renames, so they are called out rather than folded into the
primitive migration:

| Shipping size | Height | Shipping icon | New size | New icon | Change            |
| ------------- | -----: | ------------: | -------- | -------: | ----------------- |
| `xxs`         |      — |             — | `xs`     |     12px | **retired**       |
| `xs`          |      — |             — | `xs`     |     12px | height formalized |
| `sm`          |   28px |          16px | `sm`     |     16px | unchanged         |
| `md`          |   32px |          24px | `md`     |     16px | icon **−8px**     |
| `lg`          |   36px |          24px | `lg`     |     16px | icon **−8px**     |
| —             |      — |             — | `xl`     |     16px | **new**, 40px     |

- **The icon reduction is the visible change.** Buttons at `md` and `lg` ship
  24px icons today; the optical contract specifies 16px. This is the intended
  correction — 24px is the `icon.detailed` recipe and §4.1 states it must not
  be used as a routine control icon — but it changes every default and
  prominent button in the product. It requires before/after review on real
  surfaces, not a swatch sheet.
- **`xxs` is retired into `xs`.** It has no distinct height contract in the new
  scale. Call sites move to `xs` at 24px.
- **`xl` is new.** It exists to give form-adjacent actions a 40px partner for
  Field `md` (§5.4). Nothing migrates into it automatically.

This section is the exception to §11.2's preserve-then-redesign rule. The rule
still holds everywhere else: elsewhere, migrate to the new token with the
current value, then change the value in a separate reviewable commit. Here the
icon size _is_ the point of the recipe, so the two land together and the phase
carries the visual diff.

The proposed visual chrome axis is independent from size, tone, and whether the
content contains text or an icon:

| Variant     | Resting treatment                      | Interaction treatment                   | Intended hierarchy                    |
| ----------- | -------------------------------------- | --------------------------------------- | ------------------------------------- |
| `text`      | No fill or container, default Ink      | Underline and Ink change                | Inline or low-chrome action           |
| `ghost`     | Transparent pill, default Ink          | Neutral subtle interaction fill         | Toolbar and quiet standalone action   |
| `outline`   | Transparent pill with default Hairline | Neutral subtle fill + stronger Hairline | Bounded alternative action            |
| `secondary` | Borderless Neutral fill + default Ink  | Borderless Neutral state ladder         | Supporting action                     |
| `primary`   | Accent strong fill and inverse Ink     | Accent state ladder                     | One main action in a decision context |

Confirmation buttons reuse one of these variants and add a semantic Feedback
tone. `tone="success"`, `tone="warning"`, and `tone="error"` are allowed only
when the action's outcome carries that meaning. They do not create separate
heights, padding, radius, typography, or shadow recipes. Filled confirmation
buttons use the Feedback `strong` emphasis with paired inverse Ink; the weaker
default fills do not provide sufficient label contrast in every theme.

Proposed button rules:

- Labeled buttons use horizontal padding equal to twice their vertical padding.
  For fixed-height recipes,
  `padding-y = (height - line height - 2px borders) / 2` and
  `padding-x = 2 × padding-y`. Buttons have no arbitrary minimum width; label,
  icon, gap, and the padding ratio determine width.
- Primary, secondary, outline, and standalone ghost actions are pill-first;
  text actions have no visible container at rest.
- Secondary has a pure Neutral fill with no visible border in default, hover,
  or disabled states. A transparent base border may preserve box sizing but
  must not appear as a Hairline.
- Icon-only variants use a circle.
- Connected controls, compact chat actions, menu rows, and segmented controls
  use their pattern radius rather than forcing a pill.
- Loading preserves the label's measured width unless the recipe explicitly
  changes to icon-only.
- A leading/trailing icon uses the size recipe; feature code does not choose a
  second icon size. Standard labeled buttons use the 16px `icon.main` recipe;
  `xs` scales that same optical recipe to 12px; `sm` and above keep it at 16px
  so button icons align with tabs and navigation. The 24px detailed recipe is
  not used inside routine buttons.
- Destructive and validation meaning come from semantic tone, not a different
  geometry.

### 5.4 Proposed field and row recipes

| Proposed recipe | Height/min-height | Type              | Icon | Inline inset | Shape          |
| --------------- | ----------------: | ----------------- | ---: | -----------: | -------------- |
| Field `sm`      |              32px | `text.base`       | 16px |         12px | `radius-field` |
| Field `md`      |              40px | `text.base`       | 16px |         12px | `radius-field` |
| Textarea `sm`   |      64px minimum | `text.base`       | 16px |         12px | `radius-field` |
| Textarea `md`   |      80px minimum | `text.base`       | 16px |         12px | `radius-field` |
| Row compact     |      28px minimum | `text.base`       | 14px |          8px | Pattern-owned  |
| Row default     |      36px minimum | `text.base`       | 16px |         12px | Pattern-owned  |
| Row comfortable |      40px minimum | `text.body-large` | 16px |         12px | Pattern-owned  |

Input, Select, Popover trigger, InputSelect, and single-line editable controls
should render the same proposed size identically. Textarea shares type, inset,
border, focus, and radius rules while retaining a multiline minimum height.

Key header rows use only two approved compound recipes. They are separate from
generic rows and from numerically equal control tokens:

- `layout-row-header` is exactly 40px high for canonical panel and routine page
  headers. It composes Button `sm` at 28px, leaving 6px above and below.
- `layout-row-header-prominent` is exactly 48px high for key page or major
  section headers. It composes Button `md` at 32px, leaving 8px above and below.
- Both use `border-box`, centered alignment, 8px inline inset, 8px internal gap,
  and visible overflow for focus and hit areas.
- Its semantic `h1` or `h2` title uses `text.body-large` (15/22px at the default
  base) with `weight.semibold`.
- The standard 40px recipe uses a 14px icon, 6px icon/label gap, and 10px
  labeled-button inline padding. The prominent 48px recipe uses a 16px icon,
  8px gap, and 10px inline padding.
- A separator is inset or absolutely positioned so it does not consume the
  declared vertical clearance.
- A 2px focus ring with a 2px offset has a 36px footprint and must not be
  clipped by the row or its ancestors.
- Header rows never use 44px. On a coarse pointer, a 28px or 32px action may
  receive a safely overflowing 44px hit area; that accessibility target does
  not change the approved 40px or 48px visual row height.

## 6. Proposed radius and shape system

### 6.1 Proposed reference radii

| Proposed token | Proposed value | Proposed use                    |
| -------------- | -------------: | ------------------------------- |
| `radius-0`     |            0px | Connected edge/reset            |
| `radius-4`     |            4px | Tiny detail and message tail    |
| `radius-8`     |            8px | Compact control/tooltip         |
| `radius-12`    |           12px | Field, menu row, embedded media |
| `radius-16`    |           16px | Card, panel, popover            |
| `radius-24`    |           24px | Large overlay/hero surface      |
| `radius-full`  |         9999px | Pill/circle only                |

Proposed semantic roles:

| Proposed role            | Proposed reference | Proposed application              |
| ------------------------ | ------------------ | --------------------------------- |
| `radius-primary-action`  | `radius-full`      | Key text actions                  |
| `radius-icon-action`     | `radius-full`      | Square icon-only controls         |
| `radius-field`           | `radius-12`        | Input/select/textarea family      |
| `radius-compact-control` | `radius-8`         | Small embedded/chat controls      |
| `radius-menu-row`        | `radius-12`        | Menu and picker rows              |
| `radius-card`            | `radius-16`        | Cards and repeated surfaces       |
| `radius-panel`           | `radius-16`        | App-shell and side-panel surfaces |
| `radius-popover`         | `radius-16`        | Menus, popovers, floating pickers |
| `radius-dialog`          | `radius-24`        | Modal dialog shell                |
| `radius-message`         | `radius-16`        | Chat bubble body                  |
| `radius-message-tail`    | `radius-4`         | Speaker/tail corner override      |
| `radius-media`           | `radius-12`        | Images, browser/document previews |

Ten of the twelve semantic roles resolve to `radius-12` or `radius-16`. This
convergence is intentional and is the justification §14.1 requires: the roles
exist so a surface's radius can be changed by _meaning_ — every menu row, or
every card — without hunting for which of them happened to share a number.
Collapsing them back to two tokens would remove that ability. Reference values
are deduplicated; semantic roles are not.

Proposed shape rules:

- Pill-first means key controls are inviting and easy to identify; it does not
  mean every rectangular surface uses `radius-full`.
- Full radius is valid only when content height makes a pill or when width and
  height make a circle.
- Multiline fields, cards, dialogs, and panels use bounded radii.
- Connected tab strips, split panes, attached headers/footers, and message tails
  retain directional or zero-radius edges through named component recipes.
- Scrollbars, switch tracks, progress bars, avatars, status dots, and color
  handles keep their intrinsic pill/circle geometry.
- The DOM browser-preview radius and native Electron guest radius come from one
  shared, testable contract.

## 7. Proposed border, separator, and focus system

### 7.1 Proposed border widths

| Proposed token    | Proposed value | Proposed intent                               |
| ----------------- | -------------: | --------------------------------------------- |
| `border-hairline` |          0.5px | Approved high-density desktop separators only |
| `border-thin`     |            1px | Default control and surface boundary          |
| `border-strong`   |            2px | Drop target, switch, selected emphasis        |
| `border-accent`   |            4px | Semantic callout/blockquote accent only       |

Proposed rules:

- `solid` is the default boundary style.
- `dashed` is reserved for drop zones, creation placeholders, and other
  affordances where the discontinuous line carries meaning.
- Separators use a named separator recipe rather than four border resets such as
  `border-x-0 border-t-0`.
- Hairlines require visual QA at 1× and 2× display scale; use a 1px fallback if
  the platform renders 0.5px inconsistently.
- Border color comes from the semantic color system and is independent of
  width.

### 7.2 Proposed focus treatment

The proposed default focus-visible treatment, is:

- 2px semantic focus ring.
- 2px offset where the surrounding surface permits it.
- No offset, or an inset ring, only for clipped/connected recipes that have a
  dedicated visual test.
- Focus-visible only for keyboard/non-pointer focus indication; pointer focus
  does not erase keyboard semantics.
- Focus ring composes with selected and validation borders.
- A border color change alone is not sufficient focus indication.
- Parent overflow and radius must not clip the visible focus indicator.
- Forced-colors mode receives a system-color outline fallback.

## 8. Proposed elevation and shadow system

`shadow-plugin` is proposed as the shadow-authoring and calibration tool. It
should generate the physical multi-layer shadow recipes; reviewed output is
stored as deterministic reference tokens. Product components consume semantic
elevation roles and do not call package APIs or paste generated shadows into
feature files.

The exact package integration, generated layer values, and light/dark output
remain proposals pending technical and license review.

### 8.1 Proposed semantic elevations

| Proposed semantic token     | Proposed shadow-plugin output slot    | Proposed intent                                       |
| --------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `elevation-none`            | No generated shadow                   | Canvas, inset regions, flat rows                      |
| `elevation-control`         | Level 1 / lowest generated stack      | Resting raised control                                |
| `elevation-control-hover`   | Level 2 or optically stronger Level 1 | Hovered raised control                                |
| `elevation-control-pressed` | Generated inset/pressed stack         | Pressed depth feedback; color state remains unchanged |
| `elevation-card`            | Level 1                               | Card only when separation needs depth                 |
| `elevation-floating`        | Level 2                               | Floating toolbar, menu, tooltip                       |
| `elevation-popover`         | Level 3                               | Select, picker, popover                               |
| `elevation-dialog`          | Level 4                               | Modal dialog over scrim                               |
| `elevation-drag`            | Level 4 plus approved transform       | Dragged/temporarily lifted object                     |

The `Level 1`–`Level 4` labels above are proposed authoring slots, not assumed
package API names.

### 8.2 Proposed shadow generation contract

- Generate light and dark recipes separately.
- Each recipe records source settings, generated CSS, package version, and
  review screenshot.
- Ambient and directional layers use semantic shadow colors rather than
  hard-coded white/black values where the generator permits substitution.
- A 1px highlight or keyline is modeled as a border/highlight token when it is
  a boundary, not hidden inside every shadow.
- Rest, hover, and pressed shadows have a visible but restrained progression.
- Focus is never represented by elevation alone.
- Repeated rows and scrolling lists default to `elevation-none`; large
  multi-layer stacks require explicit performance review.
- An `overflow-hidden` parent may not clip a required floating shadow or focus
  ring.
- Undefined variables, stock Tailwind shadows, and arbitrary `box-shadow`
  strings fail the proposed migration gate unless registered as exceptions.

## 9. Proposed component recipes

A component recipe is complete: it owns typography, icon sizing, spacing,
shape, boundary, elevation, state behavior, and motion hooks. Feature code may
choose supported axes but should not reconstruct the recipe.

| Proposed component           | Proposed default recipe                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| Button                       | `md`, pill, `text.base`, 16px icon, semantic control elevation          |
| Icon button                  | Matching Button height, circle, recipe-owned icon                       |
| Input/Select/Popover trigger | Field `md`, 40px, `text.base`, radius field, thin border                |
| Textarea                     | Field `md` profile with 80px minimum and multiline behavior             |
| Tag/Badge                    | Pill, `text.meta` at every size, no elevation, semantic tone            |
| Label                        | `text.meta`; weight and color come from the owning field recipe         |
| Checkbox                     | 16px control, 4px radius, thin boundary, check icon owned by recipe     |
| Switch                       | Pill track and circular thumb, strong boundary only for outline style   |
| Tabs                         | Pill or connected pattern selected by appearance; one focus recipe      |
| Menu row                     | Minimum 36px, radius menu row, no per-row shadow                        |
| Card                         | Radius card, approved inset, border or elevation according to hierarchy |
| Popover/Menu                 | Radius popover, semantic floating/popover elevation                     |
| Dialog                       | Radius dialog, dialog elevation, semantic scrim, unclipped focus        |
| App panel                    | Radius panel with directional variants owned by AppShell                |
| Chat message                 | Radius message with explicit tail role; compact actions use chat recipe |

### 9.1 Proposed component API rules

- Prefer semantic axes such as `size`, `variant`, `tone`, `emphasis`, and
  `density` over `className` geometry overrides.
- Radius is selected by component role. A general `rounded-xl` escape hatch is
  not part of the normal API.
- Icon slots receive a component-managed size and accessible-name behavior.
- Validation tone is independent from interaction state.
- Loading, disabled, selected, focus-visible, and error examples are mandatory
  in the review viewer.
- A primitive may expose an `unstyled` mode only for composition by another
  approved primitive, not as a shortcut in feature code.

## 10. Proposed Markdown typography profiles

Markdown is a scoped document-rendering system and should not dictate global
`p`, `h1`–`h6`, list, table, or code styles.

### 10.1 Proposed profiles

| Proposed profile        | Proposed use                           | Proposed density                           |
| ----------------------- | -------------------------------------- | ------------------------------------------ |
| `markdown-compact-chat` | Agent summaries and short chat content | Compact headings, 8–12px block rhythm      |
| `markdown-standard`     | General chat/document preview          | Default body rhythm, 12–16px block rhythm  |
| `markdown-document`     | Dedicated long-form reading            | Comfortable width and 16–24px block rhythm |

### 10.2 Proposed Markdown role mapping

- Markdown headings remain semantic `h1`–`h6`; a profile maps them to approved
  visual roles.
- Paragraphs use the profile body role and profile-owned block spacing.
- Lists own marker position, item gap, and nested indentation through profile
  tokens.
- Inline code and code blocks use `font.code` and their own radius/background
  roles.
- Blockquotes use the proposed `border-accent` role only where the accent has
  semantic meaning.
- Tables use semantic header/body type roles and separator recipes.
- Images use `radius-media`; captions use `text.meta` and remain associated with
  the image.
- Links have visible default and focus treatment; hover is not the only signal.
- Sanitized user content cannot inject arbitrary token names, inline shadows,
  or unscoped layout styles.
- Profile snapshots include headings, nested lists, task lists, tables, code,
  blockquotes, links, images, and very long unbroken content.

## 11. Proposed migration rules

### 11.1 Proposed sequence

0. **Correct the registered theme seeds before anything is generated from
   them.** Set `light.eigent.accent` to `#1d1d1d`, remove the duplicate
   `THEME_PRESETS` seed table, and resolve Whale's dark mode (§2.4.1). This
   ships as an ordinary bug fix and does not wait for the migration — the
   default light theme currently has no Accent hover or selected feedback.
1. Freeze a computed-style inventory and render the current Design.md viewer.
2. Approve reference and semantic token names before changing components.
3. Generate CSS, Tailwind, TypeScript, and viewer data from the approved source.
4. Alias legacy spacing, radius, and shadow names to new tokens with zero visual
   change.
5. Pilot Button because it has the broadest geometry/elevation blast radius.
6. Migrate Input, Select, Textarea, InputSelect, and Popover trigger as one form
   family.
7. Migrate navigation, tabs, menus, tags, and badges.
8. Migrate cards, popovers, dialogs, sheets, and app-shell surfaces.
9. Migrate chat-specific patterns without flattening message-tail or compact
   control behavior.
10. Resolve native/runtime exceptions and verify Electron guest clipping.
11. Enable changed-file lint gates, then reduce the approved legacy allowlist.
12. Remove compatibility aliases only after usage reaches zero and visual gates
    pass.

### 11.2 Proposed change rules

- Do not perform a repository-wide raw-value replacement.
- Migrate one component family and its real call sites at a time.
- Preserve current behavior before applying the visually revised proposal; this
  separates migration regressions from deliberate redesign. Two changes are
  declared exceptions to this rule because the new value _is_ the point of the
  recipe: the Button icon reduction (§5.3.1) and the `text.meta` floor decision
  (§3.2.1). Both carry their visual diff inside the phase that introduces them.
- A repeated raw value does not automatically represent one semantic token.
  For example, a 40px layout header and a 40px form field remain separate
  semantic tokens even though their current reference value matches.
- New UI uses shared primitives and recipes; it does not add arbitrary px/rem
  geometry for standard controls.
- A required exception records owner, reason, platform, dependent code, visual
  test, and review date.
- Generated output is never hand-edited.
- Theme/color work and geometry work are reviewed together for component states,
  but can be committed in independently testable stages.

### 11.3 Proposed future UI-generation checklist

Before generating a new surface:

1. Choose the semantic HTML structure.
2. Choose the text or code channel and an approved generated role; never choose
   a raw font size.
3. Choose an existing pattern or component recipe.
4. Choose supported size/density, variant, tone, and emphasis axes.
5. Use semantic spacing roles for composition.
6. Use component-owned radius, border, focus, and elevation.
7. Render the applicable default, hover, disabled, and selected color states.
   Separately verify focus-visible ring, pressed motion/elevation, loading,
   empty, error, and long-content behavior.
8. Verify light/dark themes, more than one accent seed, alternate approved text
   and code fonts, minimum and maximum base sizes, narrow/short windows,
   localization, keyboard use, and 200% zoom.
9. If no recipe fits, propose a named addition to the system; do not hide the
   new design decision in a class string.

## 12. Proposed exception registry

The following categories are approved exceptions. They require
semantic ownership, not automatic normalization:

- AppShell sidebar width, column gap, inset, and Framer Motion width math.
- Canonical content-header height and its direct panel/header counterparts.
- Chat scroll-anchor gaps and spacer calculations.
- Electron/browser guest rectangle, radius, off-screen parking, and native
  clipping.
- Split-pane minimum widths, resize hit areas, and measured drag geometry.
- Radix trigger width, available height, transform origin, and collision values.
- Monaco, xterm, embedded browser, and other third-party viewport requirements.
- Window controls, title-bar drag regions, platform traffic-light insets, and
  platform-specific hit areas.
- Scrollbar geometry.
- Charts, canvases, media aspect ratios, screenshots, thumbnails, and preview
  scaling.
- Animation values such as `height: auto`, measured underline positions, and
  off-screen transforms.
- Markdown document details and sanitized third-party content.

An exception is not permission to use an arbitrary value elsewhere.

## 13. Proposed accessibility requirements

- Text and meaningful icon contrast meet the approved WCAG AA target in every
  interaction state.
- Focus-visible is clearly visible, survives clipping, and is not expressed by
  color or shadow alone.
- Selected, validation, status, and disabled meanings are not conveyed by color
  alone.
- Keyboard order follows semantic/document order; layout styling does not alter
  it unexpectedly.
- Icon-only controls have an accessible name.
- Disabled controls remain legible enough to identify, while clearly
  unavailable.
- Text supports 200% zoom without overlap, clipping, or loss of actions.
- Layouts tolerate longer localized labels and dynamic user content.
- Touch/coarse-pointer targets meet the proposed 44 × 44px target contract;
  desktop compact targets meet the proposed 24 × 24px minimum. The 28px action
  inside a 40px layout header therefore needs a 44px hit area or a larger
  coarse-pointer recipe.
- Motion and shadow transitions honor reduced-motion settings when movement is
  involved.
- Forced-colors/high-contrast mode retains boundaries, focus, selection, and
  validation meaning.
- Semantic headings, landmarks, lists, tables, labels, and buttons are used
  before ARIA repair.
- Markdown maintains a logical heading order and accessible link, code, image,
  and table semantics.

## 14. Proposed review and acceptance gates

No proposal becomes adopted until the relevant gates below pass.

### 14.1 Proposed design-review gates

- Current and proposed HTML viewers render side by side from declared token
  data.
- Review includes light/dark modes and multiple accent seeds.
- Every reference token, semantic alias, component recipe, Markdown profile, and
  registered exception is visible or linked from the viewer.
- Duplicate reference values are removed or explicitly justified; semantic
  aliases may intentionally share a reference.
- Pill-first shape rules are approved on real app surfaces, not isolated
  swatches only.
- Elevation is approved on canvas, card, menu, popover, dialog, and pressed
  control examples.

### 14.2 Proposed color gates

- The public primary architecture contains Accent, Neutral, Ink, and Hairline
  groups with subtle, muted, default, and strong emphasis candidates.
- Interactive public color recipes expose only default, hover, disabled, and
  selected where applicable.
- Focus is delivered through the separate Ring treatment and never appears as a
  fifth color state.
- The review Accent anchor is exactly `#1d1d1d` in light mode and `#ede1db` in
  dark mode for `accent.default.default`. The registered source seed matches
  the anchor; the viewer does not override it (§2.4.1).
- Exactly one source of truth registers theme seeds. No component holds a
  second hard-coded seed table.
- Every theme seed passes the §2.10.2 admission gate in both modes.
- The theme specimen displays exactly Eigent, CAMEL, Claw, Starfish, Whale, and
  Custom; the primary matrices declare Eigent as their default theme in both
  modes. Whale is either declared light-only with a recorded dark-gate
  exemption, or carries authored dark seeds.
- The default Accent emphasis ladder is generated separately from each mode's
  Eigent seed; hover and selected darken without rotating either seed's hue.
- Chromatic Accent default, hover, and selected candidates remain within 1° of
  the seed hue when gamut-safe. Disabled may reduce chroma and alpha without
  rotating hue.
- Proposed ΔEOK targets pass for approved interactive roles or have a reviewed
  exception. The shipping `semantic.color.json` transforms do not meet them and
  must be retuned (§2.10.1).
- Hover and selected are visibly separated from default in the direction with
  gamut headroom for that seed (§2.5.1). Direction is not asserted per mode; a
  gate requiring dark hover to be lighter is not satisfiable for the Eigent
  dark seed and is not used.
- Every generated fill has a paired `--ds-{group}-on-{emphasis}` foreground
  meeting the contrast target against the fill as rendered, in both modes.
- Inverse text is published as `--ds-ink-inverse` (alias of
  `--ds-accent-on-strong`) and `--ds-icon-inverse`. Light-mode Eigent Accent
  strong is dark; the inverse pair is near-white and ≥ 4.5:1. Dark-mode Accent
  strong is light; the inverse pair is near-black and ≥ 4.5:1. Default Ink on
  that fill is a gate failure.
- Focus ring and selected color treatment remain visually and semantically
  distinct and can appear together.
- Fixed Feedback, Status, and Category anchors remain unchanged unless
  separately approved.
- Every tone in the shipping manifest is assigned a destination family by the
  §2.7.1 table, with none unassigned.
- No public Component color group or `component.*` color alias namespace is
  generated. Component recipes reference foundation color tokens without
  minting new color names.
- A migration audit maps each legacy component-color call site to Accent,
  Neutral, Ink, Hairline, Ring, Feedback, or Category according to its actual
  responsibility; the generated proposal token rule declares no legacy
  unprefixed aliases such as `--fill-fill-primary` or `--bg-page`.
- Contrast and gamut tests pass for all generated modes, emphasis levels, and
  applicable four-state combinations.

### 14.3 Proposed typography gates

- Text and code channels both initialize to the approved 13px base.
- Text accepts 11–16px and code accepts 8–24px in 1px steps; manually entered
  values are clamped before persistence.
- Changing one base regenerates every role in that channel and does not change
  the other channel.
- Changing text or code family updates every consumer of that channel without
  introducing per-component overrides.
- Density and theme changes do not reset or alter either typography seed.
- Generated roles round deterministically, honor channel floors, and match the
  documented 13px reference table at defaults.
- All supported families, both size extremes, localization, and 200% zoom pass
  without inaccessible clipping or loss of actions.
- Semantic HTML remains correct regardless of the selected visual role, font,
  or size.

### 14.4 Proposed geometry and component gates

- Each component's computed height, line height, icon size, gap, padding,
  radius, border, and elevation match its recipe.
- Font-weight changes do not resize icons.
- Text and icon-only controls of the same size align.
- The form family aligns at shared sizes and states.
- Canonical layout headers are 40px and their nested Button `sm` actions are
  28px, leaving 6px of visible clearance on each side at the default scale.
- Layout-header actions use a 14px icon, 13/16px default label, 6px icon gap,
  10px inline padding, and an unclipped focus footprint.
- Directional/connected surfaces, chat tails, circles, pills, switch tracks,
  media, and scrollbars preserve approved shapes.
- DOM preview and Electron guest radii match exactly.
- Focus rings and floating shadows are not clipped.
- Narrow, short, split-pane, and folded-side-panel layouts retain usable content.

### 14.5 Proposed engineering gates

- Token generation is deterministic. A clean-tree check regenerates the token
  outputs and review artifacts in CI and fails on any diff.
- No token is missing, circular, unitless where a dimension is required, or
  unresolved at runtime.
- **Every `ds-*` utility and CSS variable referenced in source resolves to a
  declared token.** The scanner cross-validates scanned names against
  `manifest.json` and fails on any name that generates no CSS. This is a
  Phase 0 deliverable. Nothing enforces it today: `check-design-token-usage.mjs`
  only rejects hard-coded colors, and the usage report counts an unresolvable
  name as a healthy semantic reference. One such name
  (`text-ds-text-status-warning-default-default`) is live in production source
  and renders nothing.
- No unapproved stock Tailwind shadow or arbitrary box shadow remains in migrated
  components.
- Changed-file lint rejects unapproved raw colors, standard-control dimensions,
  radii, borders, and shadows.
- Compatibility aliases have usage counts and removal milestones.
- Component stories cover state, size, icon/text, long-label, loading, and
  disabled matrices.
- Visual regression coverage includes Button, forms, navigation, menus, cards,
  dialog/popover, chat, AppShell, Markdown, and Electron browser preview.
- Repeated-list and animated-shadow performance is measured before approving
  multi-layer elevation recipes.
- Type checking, lint, focused component tests, and the design-token validation
  suite pass.

### 14.6 Proposed final adoption gate

The proposal becomes the adopted design-system contract only after the product
owner approves the proposed viewer, token tables, component matrices, exception
registry, and migration sequence. Until then, this file remains a review
artifact and must not be cited as current production behavior.
