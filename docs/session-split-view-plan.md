# Session split view plan

> **Status: proposal.** This plan simplifies the Session layout, lets a Space
> show two or three pieces of content side by side, and rebuilds model
> comparison on top of that split view. It is delivered as six pull requests
> (§9). PR 2 is implemented locally on `refactor/session-pane-scope`; see
> [its verification notes](session-pane-scope-verification.md). The other PRs
> remain separate deliverables.

## 1. Goal

Today a Space shows one Session at a time, with a fixed summary rail on the
right. Developers and users want to:

1. Keep the Session view simple: the chat timeline first, with the summary and
   the preview as optional columns.
2. Work with two or three things at once in one Space: two Sessions, or a
   Session next to Files, Automations or Dispatch.
3. Compare two models on the same prompt by opening the two Sessions side by
   side, with a small comparison summary in the top bar.
4. Start a new Session in the same layout as an existing one.
5. Open a Session on its own: a new window on desktop, a new tab on the web.

## 2. Terms

UI copy follows `docs/product-terminology.md`: **Space → Session → Task**.
Backend identifiers (`projectId`, `project_id`, `Project`) stay unchanged.

| Term         | Meaning                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| Pane         | One column of content inside the Space area, to the right of the sidebar              |
| Split view   | Two or three panes shown side by side                                                 |
| Pane content | What a pane shows: a Session, Files, Automations, Dispatch, or a comparison diff      |
| Focused pane | The pane the user last interacted with; it drives the sidebar highlight and shortcuts |
| Window       | A desktop operating-system window. Not used for panes                                 |
| Tab          | A browser tab in the web build. Not used for panes                                    |

"Window" and "tab" are kept for real windows and browser tabs so that copy and
code never confuse them with panes.

## 3. Current layout

- `src/components/Session/index.tsx` lays out a Session as: chat (header and
  timeline) → optional resizable preview → fixed summary rail on the right
  (`RIGHT_RAIL_*` classes), which can fold.
- Whether the preview is open is stored per Session
  (`pageTabStore.sessionPreviewByProject`). Whether the summary is open is
  local component state.
- A new Session (`isNewProject`) has its own layout branch with the composer
  in the middle and the summary rail on the right.
- Most of the Session view reads one global active Session
  (`activeProjectId`): 31 frontend files, including 74 reads in
  `src/components/ChatBox/index.tsx`.
- The top bar is one row: sidebar toggle, Home, the Space switcher pill, then
  utilities on the right.
- The desktop app runs one main window. Queued follow-ups and scheduled
  automations are started from the renderer (`useBackgroundTaskProcessor` in
  `src/App.tsx`, `useTriggerTaskExecutor`). The backend event stream relay
  already serves each window separately.
- There is no URL for a Session; the workspace is driven by app state.

## 4. Session pane layout

A Session pane has three columns, left to right:

```
┌ Session header ───────────────────────────── [Summary] [Preview] ┐
│ Chat timeline        │ Summary (optional) │ Preview (optional)   │
│ …                    │                    │                      │
│ [ composer ]         │                    │                      │
└──────────────────────┴────────────────────┴──────────────────────┘
```

- **Chat timeline** always shows.
- **Summary** is an optional column with a fixed width. It is **closed by
  default**.
- **Preview** is an optional, resizable column that takes the remaining width.
- The **Summary** and **Preview** toggles sit next to each other in the Session
  header, as `Button variant="ghost" size="sm" buttonContent="icon-only"` with
  accessible names and pressed state.
- Both toggles are stored per Session, so each pane in a split view keeps its
  own columns.
- When a pane is too narrow for all three columns, the summary closes first,
  then the preview, and the chat timeline keeps a minimum width.

## 5. Split view

```
┌ Sidebar ┬ Pane 1 (focused) ──────┬ Pane 2 ───────────────┐
│ Space   │ Session                │ Session, Files,        │
│ Sessions│                        │ Automations, Dispatch  │
│  ● A    │                        │ or a comparison diff   │
│  ○ B    │                        │                        │
└─────────┴────────────────────────┴────────────────────────┘
```

### 5.1 Pane content

A pane shows one of: **Session**, **Files**, **Automations**, **Dispatch**,
**Answer diff**, or **File diff** (the last two belong to model comparison,
§6). Split view supports up to three panes. Each content type renders the
same component it uses today, scoped to its pane.

### 5.2 Scoping a Session to a pane

A Session pane receives its `projectId` through context instead of reading the
global active Session. Everything inside the pane follows it: header,
timeline, composer, approvals, summary and preview. The global
`activeProjectId` becomes "the Session in the focused pane", so the sidebar
highlight, keyboard shortcuts and global commands keep working.

Code outside a pane keeps its current behavior. Request-style commands in
`pageTabStore` (for example scroll-to-turn and side-panel toggles) target the
focused pane.

PR 2 implementation: `<Session projectId={projectId} />` establishes a
`SessionPaneProvider`. `useSessionProjectId` and `useChatStoreAdapter` read
that identity; callers outside a provider retain the active-Session fallback.
`useSessionPageTabStore` binds preview reads and mutations to the pane,
including callbacks that settle after focus moves. Pointer and keyboard focus
update `activeProjectId` and the default command target. Mounted panes retain
their history runtime, plan overlay destination, and failure evidence while
another pane is focused.

### 5.3 Opening, closing and focus

- Open a Session in a new pane from the sidebar row menu, or with a modifier
  click. Plain click replaces the focused pane's content.
- Files, Automations and Dispatch open in a new pane from their usual entry
  points with the same modifier.
- Each pane header has a close action. Closing the last extra pane returns to a
  single pane.
- Clicking anywhere in a pane focuses it.

### 5.4 Sidebar markers

The sidebar marks every Session that is open in a pane, with a stronger marker
for the focused pane. Markers use text or shape as well as color.

### 5.5 Persistence

The layout is saved **per Space**: which panes are open, what each shows,
their widths, and each Session pane's Summary and Preview toggles. It is
restored after an app restart and when the user returns to the Space. A pane
whose Session was deleted or archived shows a removed state and can be closed;
it never breaks the layout.

### 5.6 What split view does not change

Two Sessions open side by side in one Space still follow the existing write
rules for the Space folder: only one Task writes to the shared folder at a
time, and the other shows that it is waiting. Split view changes presentation,
not execution.

## 6. Model comparison in split view

A comparison runs one prompt on two models as two linked Sessions (lanes A and
B) in the same Space. With split view, a comparison is "the two lane Sessions
open side by side" plus a small summary, instead of a separate page.

### 6.1 Starting a comparison

The new Session composer (§7) has a **Compare models** option. Lane A uses the
composer's model; the developer picks lane B. On send, Eigent creates two
linked Sessions with the same prompt, attachments, thinking effort and Space,
opens them side by side, and focuses lane A. The feature stays behind a
developer flag.

### 6.2 Comparison chip in the top bar

When the focused pane's Session is a comparison lane, a chip appears next to
the Space title:

`Comparison · A <model> · B <model>` with each lane's status as text
(Running, Waiting, Done, Failed), and a marker when the lanes have received
different prompts. If the other lane is not open, the chip offers
**Open B alongside** (or A).

### 6.3 Comparison popover

Clicking the chip opens a popover with:

- the prompt (shortened) and when the comparison started;
- one row per lane: model, thinking effort (requested → effective), status,
  active time, time to first token, input and output tokens, tool calls (and
  failures), files changed;
- a note when the lanes have received different prompts;
- actions: **Compare answers** and **Compare files** (open the diff as pane
  content), **Apply A** / **Apply B** (local Spaces), **Follow up both**,
  **Export**, **Swap panes**.

Numbers are shown side by side without coloring either lane as better.

### 6.4 Diff pane content

- **Answer diff**: the two final answers, rendered side by side or as a text
  diff.
- **File diff**: what each lane left in its own working folder, grouped as only
  in A, only in B, or different.

### 6.5 Fairness requirements

- Both lanes start from the same Space files and cannot see each other's
  writes.
- Both lanes use the same Space configuration, tools and thinking effort; only
  the model differs.
- A lane's changes reach the Space folder only when the user applies that lane.
- Comparison lanes do not add entries to the user's Space or account memory.

**Open question.** On the default write path, Sessions in a Local Space share
one folder and take turns writing, which breaks the first requirement. Lanes
need their own isolated working copy from the same starting commit, held
until the user applies one. This must be settled before this PR adds
file-writing comparisons; text-only comparisons can ship first.

### 6.6 Sidebar

Lane Sessions appear in the sidebar grouped under their comparison, each with
an **A** or **B** tag.

## 7. New Session layout

A new Session uses exactly the same layout as an existing Session:

- the Session header, titled **New session**;
- the Summary and Preview toggles on the right, with the summary closed;
- the composer centered in the chat column until the first Task starts.

The user can open the preview before sending, for example to use the browser
or a terminal. A preview tab opened before the Session exists belongs to a
draft context; when the first Task starts, the draft is handed over to the new
Session so open tabs carry over. When the first Task starts, the composer
moves to the bottom and the view continues as that Session.

This removes the separate new-Session layout branch in
`src/components/Session/index.tsx`.

## 8. Windows and tabs

- **Desktop:** "Open in new window" opens the Session in a new desktop window
  that uses the same window settings as the main window.
- **Web build:** "Open in new tab" opens a browser tab using a Session deep
  link, for example `/spaces/:spaceId/sessions/:projectId`.

Prerequisites:

1. **One dispatcher.** Queued follow-ups and scheduled automations are started
   from the renderer today, so every extra window would start them again.
   Before a second window can exist, either only one window (the main window)
   starts queued work, or starting queued work moves into the backend.
2. **Shared state.** Each window has its own copy of the stores. Renames,
   new Sessions and Space changes must reach every window, through a
   broadcast channel or the main process.
3. **Deep links.** A Session route that loads the right Space and Session. Split
   view persistence and links shared from elsewhere can reuse it.

## 9. Pull requests

Each PR is independent of the model comparison prototype and targets `main`.

| #   | Branch                             | Scope                                                                                                                                                             | Depends on |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | `feat/session-summary-column`      | Summary as an optional column between chat and preview, toggled next to the preview toggle, closed by default, stored per Session; narrow-width rules (§4)        | —          |
| 2   | `refactor/session-pane-scope`      | A Session renders from a pane-provided `projectId`; the focused pane drives the global active Session; composer and approvals work in a non-active Session (§5.2) | —          |
| 3   | `feat/session-split-view`          | Split view with up to three panes, pane content types, open/close/focus, sidebar markers, per-Space persistence (§5)                                              | 1, 2       |
| 4   | `feat/split-view-model-comparison` | Compare models in the new Session composer, linked lane Sessions, top-bar chip and popover, Answer diff and File diff pane content, sidebar grouping (§6)         | 3, 5       |
| 5   | `feat/new-session-layout`          | New Session uses the Session layout with a centered composer and a draft preview context carried into the Session (§7)                                            | 1          |
| 6   | `feat/session-windows-and-tabs`    | Session deep links, web "Open in new tab", desktop "Open in new window", single dispatcher and cross-window state (§8)                                            | 2          |

### Acceptance per PR

1. Summary and Preview toggle independently, survive switching Sessions, and
   the chat timeline never drops below its minimum width.
2. Two Sessions can render at once with working composers, approvals and
   previews, and the sidebar highlight follows the focused one.
3. Two or three panes open, close and refocus; the layout returns after an app
   restart and after switching Spaces; removed Sessions show a removed state.
4. A comparison opens both lanes side by side; the chip and popover reflect
   live status; diffs open as pane content; a lane can be applied; lanes never
   see each other's writes (or file-writing comparisons stay disabled until
   §6.5 is settled).
5. A new Session looks like a Session; a terminal or browser tab opened
   before sending is still open after the first Task starts.
6. A Session opens in a new window or tab; queued follow-ups and automations
   start exactly once with two windows open; a rename in one window appears in
   the other.

## 10. Design notes

These follow `docs/design-system/design.md`:

- Pane headers use `ContentHeader` (routine 40px) with `Button size="sm"`
  actions.
- Toggles and pane actions are `Button variant="ghost" size="sm"`; icon-only
  buttons have accessible names and pressed state.
- The comparison chip uses the top bar pill recipe; lane labels are `Tag`
  pills with text, never color alone; both lanes use neutral surfaces.
- Text uses `DsText` roles (`meta` for metric labels, `channel="code"` for
  numbers and durations).
- Each pane owns its scroll area with `scrollbar-always-visible`.
- Every state shows text, not only color: running, waiting, done, failed,
  removed.
- Verify light and dark themes, keyboard focus order across panes, 200% zoom
  and narrow windows.

## 11. Risks

| Risk                                                                       | Mitigation                                                                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Code that reads the global active Session breaks inside a non-focused pane | PR 2 scopes the Session view first, with tests that render two Sessions at once          |
| Too little width for sidebar plus two full Session panes                   | Summary closes first, then preview; panes keep a minimum width; a third pane is optional |
| Two windows start the same queued work twice                               | PR 6 ships only after a single dispatcher is in place                                    |
| Persisted layout points at deleted content                                 | Removed state per pane; never fail the whole layout                                      |
| Comparison lanes share one folder                                          | §6.5: isolated working copies, or text-only comparisons first                            |

## 12. Validation

- Frontend: `npm run type-check`, focused `npx vitest run` for each PR's
  components and stores, `npm run check:design-tokens`, `npm run check:i18n`
  when copy changes, and `git diff --check`.
- Manual: light and dark themes, two and three panes, app restart, Space
  switch, narrow window, keyboard navigation between panes.
