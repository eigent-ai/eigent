# Session pane scope verification

Implemented on `refactor/session-pane-scope`, rebased onto `origin/main`
(`09bc31ef9`). PR #2068 targets `main`.

## Delivered

- `Session` accepts a pane-owned `projectId`. Existing standalone callers keep
  their active-Session behavior.
- Chat subscriptions, Session execution, drafts, attachments, model controls,
  approvals, task controls, plan saving, Summary, and preview content use the
  pane's identity. Backend Project identifiers and persisted contracts retain
  their existing names.
- Pointer and keyboard focus update the global active Session for the sidebar
  and commands. Focus, Summary and query-scroll requests retain their target.
- Preview actions capture their owner. Preview entrances and browser bounds
  are tracked independently for visible Sessions. Background browser callbacks
  continue to address the owning Session.
- Panes that own their Session retain history runtimes and failure evidence
  across focus changes. The standalone route follows the active Session and
  does not retain, so stale-runtime eviction still covers the Session it
  leaves. Expanded plans have a unique portal destination per pane.
- Switching Sessions on the standalone route updates the Session in place
  instead of remounting it, so column widths survive the switch.
- Unscoped chat focus, task focus and query-scroll requests are not bound to
  the preview scope; an unscoped chat focus applies to the focused pane.

The pane manager, opening/closing panes, layout persistence, and sidebar open
markers belong to PR 3 in the split-view plan. This branch supplies its Session
rendering foundation.

## Validation

Passed:

- `npm run type-check`
- Scoped ESLint for changed source and test files.
- `npm run check:design-tokens`
- Focused Vitest suites: **1,258 tests across 66 files**, covering Session,
  ChatBox, the adapter and pane hooks, page-tab state, Project runtime,
  ChatStore, and failure evidence.
- `PLAYWRIGHT_CHANNEL=chrome node test/e2e/session-pane/verify.mjs`
- Prettier for changed files and `git diff --check`.

The browser harness uses production Session shells, composers and controls with
seeded history and offline execution/event sources. It verifies two simultaneous
Sessions, independent drafts and Preview toggles, pointer and keyboard focus,
focused Summary commands, light and dark themes, 200% zoom, narrow windows, and
both motion preferences. Unit tests also verify sending and approving from a
non-active Session, saving plans to their owner, delayed preview callbacks,
simultaneous browser viewports, and runtime retention.

Live backend model runs and real Electron guest rendering were not exercised.
The existing Electron preview harness was not run. No visible copy changed, so
locale parity was not required.

## Design handoff

Reused the existing Session layout, HeaderBox/ContentHeader recipe, SummaryToggle,
PreviewPanel, BottomBox, Button, Tabs, Tooltip, Popover and Dialog primitives.
Controls retain `ghost`, `sm`, `icon-only` axes and existing neutral/Ink semantic
roles, including `bg-ds-neutral-subtle-default` and
`text-ds-ink-default-default`. No token sources, generated files, or component
recipes changed. Existing split-pane and Electron guest geometry exceptions
remain in use; no exception was added.
