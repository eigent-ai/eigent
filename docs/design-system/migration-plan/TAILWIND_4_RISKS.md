# Tailwind CSS 4 Upgrade Risk Register

This register separates an apparently successful build from a trustworthy
upgrade. Tailwind can complete compilation while silently omitting custom
utilities, so every configuration change requires sentinel and rendered-state
checks.

The live count of removed or risky utilities comes from
[`../current-token-usage/usage-report.json`](../current-token-usage/usage-report.json).
The numbers below are the audit baseline and must be refreshed after rebasing.

## Risk matrix

| Risk                                              | Probability | Impact   | Detection                                                        | Mitigation and rollback                                                                                                                                                                |
| ------------------------------------------------- | ----------- | -------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy config silently loads as empty             | High        | Critical | Sentinel compile emits no DS color/type/screen/shadow utility    | Keep `tailwind.config.js` ESM because the package is `type: module`, or rename it `.cjs` and update every reference. Revert config and CSS entry together.                             |
| Incorrect CSS layer order without Preflight       | High        | High     | Base styles override utilities in rendered specimens             | Declare `@layer theme, base, components, utilities;` before imports. Preserve the previous entry file for atomic rollback.                                                             |
| Source detection scans generated bundles          | Medium      | High     | Slow builds, inflated CSS, accidental utility matches            | Use explicit source boundaries and never scan `web-ui/dist`. Compare output size and sentinel set.                                                                                     |
| Removed/renamed v3 utilities disappear            | High        | High     | Scanner and rendered layout regression                           | Replace `flex-shrink-0`, `flex-grow-0`, `flex-shrink`, and `overflow-ellipsis` with v4 names before sign-off.                                                                          |
| Selector/transform behavior changes               | Medium      | High     | Snapshot passes but real sibling/child layout differs            | Visually test every `space-*`, `divide-*`, and arbitrary transition/transform consumer in context. Revert the affected component class change.                                         |
| Preflight changes semantic elements               | Medium      | High     | Headings, controls, lists, and Markdown change globally          | Keep Preflight intentionally disabled until explicit semantic defaults exist, then introduce it only as a dedicated migration.                                                         |
| Shadow plugin utilities conflict in class merging | High        | Medium   | More than one `smooth-shadow-*` remains after `cn()`/`twMerge()` | Extend the owned Tailwind Merge groups or expose one elevation prop so callers cannot compose competing plugin classes.                                                                |
| PostCSS pipeline is partly upgraded               | Medium      | Critical | Dev/build differences, missing imports or prefixes               | Use `@tailwindcss/postcss`; remove legacy plugins only after confirming their behavior is no longer required. Roll back `postcss.config.cjs`, CSS entry, and dependencies as one unit. |
| Important/arbitrary utility syntax drifts         | Medium      | Medium   | Source contains a class but generated CSS does not               | Add representative important, arbitrary-value, variant, CSS-variable, and opacity sentinels. Do not accept Vite success alone.                                                         |
| Theme variables exist but utilities are absent    | High        | Critical | Runtime variables inspect correctly while class has no rule      | Sentinel-test DS colors, semantic typography, custom screens, legacy transition aliases, and plugin elevations.                                                                        |
| Tailwind Merge version lacks new class knowledge  | Medium      | High     | Caller overrides do not win; CSS source order decides            | Test merge outcomes for every public primitive variant and configure conflicts before exposing classes.                                                                                |
| Native/Electron layers disagree with DOM geometry | Medium      | High     | Browser preview corners, shadows, or focus are clipped           | Compare native and DOM radii; explicitly test overflow around 40px headers and embedded browser/terminal surfaces.                                                                     |
| Broad formatting hides migration regressions      | Medium      | Medium   | Large unrelated diff and noisy baseline warnings                 | Format and lint changed files, keep the usage delta reviewable, and separate mechanical utility renames from design changes.                                                           |

## Audited compatibility hotspots

- The initial source scan found 44 removed utility occurrences across 30 files:
  35 `flex-shrink-0`, three `flex-grow-0`, one `flex-shrink`, and five
  `overflow-ellipsis`. The generated report is authoritative for the current
  checkout.
- The audit also found 103 `space-*` uses across 28 files, one `divide-y`, and
  11 arbitrary transitions containing `transform`. Tailwind 4 changes selector
  and individual-transform behavior, so these require visual checks rather than
  blind replacement.
- A previous trial loaded the CommonJS-shaped configuration as an empty module
  under `type: module`. Compilation still completed but emitted none of the
  custom DS colors, semantic typography, custom screens, variants, or shadows.
- When Preflight is omitted through separate imports, an explicit layer-order
  declaration must precede the imports. Otherwise later base rules can outrank
  utilities.
- Source detection must not include the ignored multi-megabyte `web-ui/dist`
  bundle. Generated JavaScript and CSS are not product source inputs.
- `shadow-plugin` supplies `smooth-shadow-*`, `smooth-shadow-ring-*`, and
  `smooth-ring-*` utilities. The current class-merging layer must be taught
  their conflict groups or hidden behind the semantic elevation API.

## Mandatory verification sequence

1. Run `npm run verify:tailwind4` before the app build. It compiles a small
   fixture and asserts custom DS color, semantic type, screen/variant, legacy
   compatibility, and smooth-shadow outputs.
2. Run `npm run build:design-system` and compare the generated usage counts and
   CSS output size.
3. Run `npm run type-check` and the focused tests for every changed primitive.
4. Render light and dark theme matrices, keyboard focus, clipped containers,
   Markdown, and the Electron browser/terminal surfaces.
5. Check macOS and Windows packaged builds before removing the previous
   Tailwind path.

## Go/no-go gate

Tailwind 4 is ready to become the implementation base only when the sentinel
compile, current-usage scanner, app/type checks, and named visual matrix all
pass. A green Vite build by itself is a no-go.
