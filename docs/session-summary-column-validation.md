# Session Summary column validation

PR #2067 implements §4 and acceptance item 1 of the [Session split view plan](session-split-view-plan.md).
The remaining five PRs, including the new-Session layout and draft Preview, are outside this change.

## Behavior

- The chat header spans chat and Activity (Summary). Preview opens as a separate column to their right, with its tab header aligned beside the chat header and its content below. Summary sits between chat and Preview.
- Summary starts closed, with no folded rail, and is saved per Session in `eigent-page-tab` alongside the existing Preview persistence.
- Both header toggles are independent, use accessible pressed state, and retain keyboard focus when toggled.
- Measured Session width and the resized left side determine available columns. Activity is 360px; the timeline retains 360px and Preview retains 320px plus its 1px left border.
- Activity docks when the chat side is at least 720px wide, and hides when it becomes narrower. Both columns require at least 1041px total; Preview closes below 681px. At narrow widths the same Activity icon opens a dismissible popover over chat instead of widening the pane.
- The divider resizes the entire left side from 360px to the space available after the Preview minimum. Activity collapses without changing the divider position. Container resizes and Session switches cancel an active drag and restore cursor/selection behavior. Arrow keys, Home, and End also resize the panes.
- Removing a Session clears both saved column preferences and its Preview tabs.

## Design contract

Reuses `HeaderBox` and its canonical `ContentHeader` recipe, `Button`, `TooltipSimple`, `ShortcutTooltipContent`, existing `SessionSidePanel`, and `PreviewPanel`.
Toggles use `variant="ghost"`, `size="sm"`, `buttonContent="icon-only"`, neutral surfaces, `text-ds-ink-muted-default`, `text-ds-ink-default-default`, and `bg-ds-neutral-strong-default`.
The existing registered `split-pane-geometry` exception owns measured widths and the resize divider. No token source, generated token file, shared primitive, or new exception was added.
Existing translated Summary and Preview wording is reused. Backend identifiers and persisted Preview keys remain unchanged.

## Automated verification

235 tests passed across 23 files. Passed:

```sh
npm run type-check
npx vitest run test/unit/components/Session test/unit/store/pageTabStore.preview.test.ts test/unit/store/pageTabStore.test.ts
npm run check:design-tokens
npm run check:i18n
npx eslint src/components/Session/index.tsx src/components/Session/HeaderBox/index.tsx src/components/Session/SidePanel/index.tsx src/store/pageTabStore.ts test/unit/components/Session/SessionResize.test.tsx test/unit/components/Session/HeaderBox.test.tsx test/unit/store/pageTabStore.preview.test.ts --no-warn-ignored --max-warnings=0
git diff --check
```

Coverage includes default closed state, DOM column order, independent toggles, per-Session restoration, persisted-state rehydration, deletion cleanup, keyboard activation/focus, narrow-container closing order, chat width clamping, and interrupted drag cleanup.

## Rendered verification

Checked in the development Electron app with an existing completed Session:

- Light and dark appearance: both columns open together in the expected order, with the header controls visible and their pressed states correct. Restored the original light appearance after inspection.
- Switching to another Session shows its independent closed state; returning restores both open columns.
- Preview opens on its existing chooser. Summary continues to show its Agents and Files content.

Narrow-container behavior is covered by ResizeObserver-driven component tests. Native window resizing, 200% zoom, forced colors, and reduced-motion visual checks have not been completed. The app's View menu does not expose zoom controls; attempted keyboard zoom did not visibly change the app.
No model task was started for this layout validation. CI and human review have not run.

## Activity row refinement

The Summary toggle uses Lucide `SquareMenu`, distinct from Preview. The separate Summary header and leading fold action are removed. A canonical `ContentHeader` starts the content box with **Activity** on the left and the scope dropdown on the right; a shared `Separator` divides this row from Agents, Files, and the other sections.

Activity uses `DsText role="base" weight="semibold"`, matching other section titles. The header shares their scroll area and aligned insets. The scope dropdown reuses `Button size="sm" variant="ghost"` with the top-bar neutral hover/open recipe, its standard chevron sizing, and user-menu-style `DropdownMenuItem` rows with trailing checkmarks and radio accessibility semantics for Latest only and All. The card uses `rounded-ds-panel`, `pl-ds-8`, and the neutral surface; the shared scrollbar gutter supplies the balancing right inset without extra card padding. Its divider uses `ds-hairline-subtle-default`. No new exception was added.

On hover-capable devices the scope button is hidden at rest and appears when its whole Activity content box is hovered or contains keyboard focus. It remains visible while its menu is open. Its space stays reserved, so the title does not move. On devices without hover it remains visible. Opacity feedback respects reduced motion.

Activity is translated in all 11 locales. The sizing and icon follow-ups passed focused tests, type checking, lint, formatting, and diff checks. Previous rendered verification covered light/dark appearance, scope selection, and live Agents/Files content. The dropdown hover follow-up passed 23 focused tests, type checking, focused lint, design-token checks, formatting, and diff checks. Verified the button appearing on hover anywhere in the Activity content box, opening its menu with both radio options, selecting Latest only, keeping focus visible after selection, and hiding after clicking outside the Activity content box in the running Electron app (light appearance). Dark appearance, touch input, and reduced-motion rendering were not manually rerun.

## Preview column alignment refinement

Preview now owns the full-height right column, with its existing tab header aligned alongside the chat header. The chat header spans the chat timeline and optional Activity column. The left group owns the resized width and includes optional 360px Activity content. The resize refinement below replaces the original timeline-only width calculation.

Reuses `HeaderBox`/`ContentHeader` and `PreviewPanel` without new controls, colors, typography, or exceptions. The registered `split-pane-geometry` exception continues to own column widths and the divider.

Passed 19 focused tests across `SessionResize.test.tsx` and `HeaderBox.test.tsx`, `npm run type-check`, focused ESLint, `npm run check:design-tokens`, Prettier, and `git diff --check`. The new regression covers header/body ownership with Activity open or closed and Preview closing. Existing tests cover drag resizing and narrow-container collapse.

Verified in the running Electron app in light appearance: both headers align, Activity can close independently, and closing Preview returns the full width to chat. Left both panels open for review. Dark appearance, native narrow-window resizing, 200% zoom, and reduced-motion rendering were not rerun for this structural change.

## Activity dropdown user-menu styling

The scope control reuses the top-bar user menu's ghost `Button size="sm"`, `TOP_BAR_CONTROL_STATE_CLASS`, and shared `DropdownMenuContent`/`DropdownMenuItem` recipes. Latest only and All use plain rows with a trailing Accent checkmark while retaining `menuitemradio` and `aria-checked` semantics. The menu uses the same 8px offset. Whole-card hover, focus visibility, and open-state visibility are preserved. No shared primitive or new exception was changed.

Passed 23 focused tests (ActivityPanel, SessionHistoryAction, HeaderBox), type checking, focused ESLint, design-token checks, formatting, and diff checks. Verified light appearance, All selection, reopening from keyboard focus, Home/Enter to restore Latest only, and focus returning to the trigger. Dark appearance, touch, and zoom were not rerun.

## Persistent divider, responsive Activity, and header spacing

The full-height divider reuses vertical `Separator` with `--ds-border-thin` and `bg-ds-hairline-subtle-disabled`, matching the Preview content border. Its transparent 2px layout rail and wider resize hit area are preserved, along with the semantic focus ring; hover does not darken the line. It resizes the entire left group in either direction, without the previous 680px timeline cap. The existing registered `split-pane-geometry` exception covers measured widths, minimums, and the resize hit area. Pointer frames update width once per animation frame; drag interruption restores cursor and selection. Keyboard arrows resize by 16px and Home/End reach each limit. The resize control name is localized in all 11 locales.

Below 720px on the chat side, Activity hides (see "Default open and width-driven folding" below; the saved choice is now kept). The same SquareMenu icon then uses shared `Popover`, `PopoverTrigger`, and `PopoverContent` to show Activity over chat. Radix bounds it to the left group and available height/width, using the existing `radix-collision` exception. Escape and outside click dismiss it, and Escape restores focus to the icon. Widening the left group allows the icon to dock Activity again.

Header control gaps, control-to-divider insets, divider-to-tab insets, gaps between tabs, and the tab-add gap use `ds-4`. Both headers retain the canonical 40px row and `sm` controls. Existing `DsIcon recipe="main"` supplies Preview tab icons. No shared token, primitive, or new exception was introduced.

238 tests passed across the Session component and page-tab store suites. New regressions cover bidirectional whole-group resizing, collapse without divider jump, narrow popover access, returning to docked Activity, keyboard resize limits, Escape/outside dismissal, and focus restoration. Type checking, focused ESLint, design-token checks, locale parity/source usage, Prettier, and diff checks passed.

Rendered verification completed in Electron after restarting the stalled development runtime: the divider remains visible in light and dark appearance; both headers and two Preview tabs align; keyboard resize reaches 360px and 1022px in the tested window and moves in both directions; Activity hides at 704px, opens over chat from the same icon, and stays within chat even at the 360px minimum. Escape closes it and returns focus to the icon. Widening to 798px allows Activity to dock again. Restored light appearance and left both panels open.

Pointer resizing and cancellation are covered by component tests. Native coordinate-drag automation did not move the divider, so a native mouse-drag gesture was not independently verified; the live width changes above used the separator's keyboard controls. Native whole-window resizing, 200% zoom, touch, and reduced-motion rendering were not manually rerun. No model task was started.

Divider border refinement: replaced the filled 2px line with the shared vertical `Separator` (thin 1px border) and the Preview content's `hairline-subtle-disabled` token. Retained the 2px layout rail, expanded hit area, and keyboard focus ring; no new exception. Verified the lighter line at rest in the running Electron app in light appearance. The 15 resize tests, type check, focused lint, design-token checks, formatting, and diff checks passed. Dark appearance and zoom were not manually rerun for this token/line-width change.

Divider gutter ownership: the resize target owns `px-ds-4` around the shared 1px separator (9px total). Chat header right padding and Preview header/content left inset are removed; docked Activity also removes its divider-facing outer margin. Inner chat reading/composer spacing and the scroll gutter remain owned by their content. The entire visible gutter handles dragging, and width clamps/auto-collapse account for all 9px. The existing split-pane exception covers the measured geometry; no new exception.

The gutter follow-up passed 32 focused Session resize/header/Preview tests, type checking, focused ESLint, design-token checks, formatting, and diff checks. Verified the padded strip and flush facing header/content edges in the running Electron app in light appearance. Dark appearance and zoom were not rerun for this spacing refinement.

Compact spacing refinement: divider padding and the gaps between chat header controls, Preview tabs, and the add-tab button now use `ds-4` (4px). The divider gutter is 9px total including its thin line, and width calculations/tests account for it. Verified the compact layout in Electron in light appearance. All 32 focused tests, type checking, focused lint, design-token checks, formatting, and diff checks passed. Reused existing controls and Separator; no new exception. Dark appearance and zoom were not rerun.

## Preview full-column surface

Preview now fills its column to the content edges without an inset rounded frame, outer right margin or bottom padding. Its tab strip uses shared `ContentHeader` with the canonical 40px height and a bottom border; content starts immediately below it. The column owns a single 1px left border. An absolutely positioned transparent resize target overlaps this border, so there is no padded divider column and no extra layout gutter. The target retains keyboard focus, arrow/Home/End input, direct pointer updates and cancellation safeguards. The native browser guest also uses square corners to match the content surface.

Reused `ContentHeader`, existing `Button size="sm"`, `ds-4` header spacing, `--ds-border-thin`, `hairline-subtle-disabled`, neutral surface and semantic focus-ring roles. Existing split-pane and Electron guest geometry exceptions cover the border and hit area; no new exception, token or primitive was added. The Preview minimum is 320px of content plus the 1px border; the combined minimum is now 681px. Earlier gutter descriptions above record superseded iterations.

49 focused tests passed across SessionResize, HeaderBox, PreviewPanel and PreviewBrowserLayer. Type checking, scoped ESLint with zero warnings, design-token checks, Prettier and `git diff --check` passed. Coverage retains bidirectional pointer resizing/cancellation, Activity threshold behavior, keyboard bounds, the exact 681px minimum, content routing and browser guest positioning/parking.

Rendered verification in Electron: the rounded content outline is gone; Preview fills its column, and the left border meets the border below the tabs. Checked light and dark appearance and keyboard border resizing (End/Left reached 1007px in the tested window, then returned to 815px). Restored light appearance. Pointer gestures remain verified by component tests; native coordinate dragging, touch, zoom and reduced-motion rendering were not rerun for this surface-only refinement. Prior reduced-motion handling is preserved.

## Activity margin and header-divider spacing

Moved the Activity card's 4px outer margin from left to right in both docked and popover layouts. Removed the obsolete `flushRight` prop so opening Preview no longer removes that right margin. Added `mb-ds-4` to the shared Activity `ContentHeader`, matching the existing 4px top padding before Agents below the shared `Separator`. The header-divider gap is now balanced above and below. Shared scrollbar geometry and internal content insets remain intact.

Reused `ContentHeader`, `Separator` and `ds-4` spacing; no token, primitive or exception was added. Verified the rendered docked card and header/Agents spacing in Electron in light appearance. Dark appearance, popover rendering, zoom, touch and reduced motion were not manually rerun for this spacing-only update. All 39 focused ActivityPanel, SessionHistoryAction and SessionResize tests passed, along with type checking, scoped ESLint, design-token checks, Prettier and `git diff --check`.

## Component organisation

Behavior-preserving refactor; markup, classes, tokens and persisted keys are unchanged.

- `Session/layout/sessionColumns.ts`: column constants and pure `getSessionColumnLayout`, unit-tested in `sessionColumns.test.ts`.
- `Session/layout/usePreviewResize.ts`: pointer and keyboard divider resizing, drag cancellation and the live width variable.
- `Session/layout/usePreviewEntrance.ts`: Preview open-cycle tracking and the `displaySettled` signal.
- `Session/layout/PreviewColumn.tsx`: the animated Preview column and its resize separator.
- `Session/HeaderBox/SummaryToggle.tsx`: Summary toggle and narrow-width popover. `HeaderBox` takes a single `summary` prop.
- `SidePanel/components/Header.tsx`: `ActivityHeader` (title, history retry, scope menu) replaces the unused `SidePanelHeader`. The orphaned `FoldButton.tsx` is removed.
- `pageTabStore`: exports `SessionPreviewOpening`, and `setSessionPreviewSlice` takes `{ projectId, immediate }` instead of positional arguments.

269 tests passed across 25 files. Type checking, scoped ESLint, design-token checks, locale parity/source usage, Prettier and `git diff --check` passed. Rendered behavior was not rerun for this structural refactor.

## Default open and width-driven folding

- Starting a task marks the Session. This covers legacy live, user-started `startTask` calls (not replay or Automation runs) and managed `submitSessionMessage` sends. The mark goes into a transient `sessionTaskStartedProjectIds` signal in the page-tab store. It is not persisted.
- The Session consumes the signal once the pane is measured. If no Summary choice is saved for that Session and Summary would dock, it opens and the choice is saved. A saved open or closed choice is never overridden. If there is no room at that moment, nothing changes.
- Narrowing the window or dragging the divider below the dock width now only hides Summary. It no longer clears the saved choice, so widening docks it again. Preview still closes below its minimum.
- Deleting a Session clears its pending signal along with its saved columns.

Reused existing `SummaryToggle`, Summary column and Preview layout; no visual, token or exception changes. Regressions cover auto-open with room, a saved closed choice, too little room, hide-and-restore on window narrowing and widening, re-docking after a divider drag, and signal persistence/cleanup in the store and from `startTask`. Rendered behavior in the Electron app was not checked.

The new-Session draft rail keeps its own collapse control: `ActivityHeader` shows the existing `SidePanelFoldButton` in its leading slot when the panel is not a Session column, because that shell has no header toggle and the shortcut only applies on the Session tab. Regressions cover expand-then-collapse on the draft rail, no fold control on the Session column, and the managed-start signal.

## New session layout (plan §7)

- `Session isNewProject` now renders the same layout as a Session. That covers the `HeaderBox` titled **New session**, the token count, the Summary toggle and the Preview toggle; the Back button and the chat-timeline style control are hidden. The composer stays centered in the chat column, with the same Summary column/popover and Preview column, divider and width rules.
- The draft uses the reserved `NEW_SESSION_DRAFT_SCOPE` (`new-session-draft`) in `sessionPreviewByProject` and `sessionSummaryOpenByProject`. It never uses the previously active Project, so another Session's Preview is never shown or modified.
- When the first task starts from New session (legacy and managed paths in `Workspace`), `handOffNewSessionDraft(projectId)` runs right before switching to the Session. It moves the draft's tabs and any Summary choice to the new Session and scopes Preview there. An already-open Preview continues without a second entrance. Terminals keep their shells, and browser guests keep the same `<webview>` (no reload). A failed start keeps everything on the New session page. If no Summary choice was made in the draft, the task-start auto-open rule applies.
- The draft Preview chooser offers Browser and Terminal only. A draft terminal opens in the Space folder, or the home folder for Spaces without one, and never asks for a Project folder.
- Preview, Browser, Terminal and Summary shortcuts also work on the New session page.
- `SessionSidePanel` has no legacy folded-rail mode, and `FoldButton.tsx` is removed. Summary folds from the header everywhere. `HeaderBox`'s `empty` mode is replaced by `showTimelineStyle`.

Reused `HeaderBox`/`ContentHeader`, `SummaryToggle`, `PreviewColumn`, `PreviewPanel`, `ChooserTab`, `SessionSidePanel` and the existing `Workspace` composer. No token, primitive or exception changes. The existing `split-pane-geometry` exception covers the shared columns. The visible title reuses the existing `layout.new-project` translation.

Regressions cover the New session layout and draft scoping, never showing another Session's Preview, docking Summary under the draft scope, handoff ordering from Workspace (New session only, never on failure), store handoff without stopping shells, browser guests surviving the handoff, and shortcuts on the New session tab. Rendered behavior in the Electron app was not checked.
