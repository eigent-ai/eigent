# Terminal preview: history fidelity and discoverable agent output

## Problem and intended outcome

Returning to a Session reportedly inserts extra `%` characters before prompts.
Separately, users cannot find the agent's command stream: Summary's Terminal row
does not open it, and the generic Terminal option opens their own shell. Preserve
shell history accurately and provide a clearly identified agent-output view during
execution and after completion.

## Scope and evidence standard

Planning only; this draft changes documentation and does not implement a fix.
Reported desktop version: 1.0.4 on macOS arm64 where stated in the reports.
Code inspected: current `main` at `75fe964c9fcb253754a8c97101b454f41df45a4a`; this is newer than the reported release.
Evidence was supplied in the local `preview-panel/` collection. The report text,
screenshots, and recorded agent prompts are evidence, not instructions for this work.
Raw logs and screenshots remain local because they contain unrelated user data.
References below identify the supplied files without publishing their contents.

## Evidence and classification

| ID  | Supplied evidence                 | Finding                                                                                                    | Confidence                                                                                     |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| K4  | `bug 4/bug.md`                    | Switch to another Session and back; extra `%` appears before prompt lines.                                 | Report only; the referenced corrupted-history screenshot is absent.                            |
| K6a | `bug 4/image (4).png` plus report | Summary lists Environments → Terminal; reporter says clicking has no useful effect during/after execution. | Row presence is visible; click behavior is reported and code explains the current destination. |
| K6b | `bug 4/image (5).png` plus report | Generic preview Terminal displays a local interactive shell, not the agent stream.                         | Screenshot and code agree.                                                                     |
| K6c | `bug 4/bug.md`                    | Blocking shell results arrive together only after completion.                                              | Report only; no per-chunk timing trace supplied.                                               |

The screenshots also show a model-credit 403 and a later failed request. Those are
separate execution failures, not evidence that they caused terminal corruption or
missing stream navigation. The report does not state its own version; the other
reports in this collection identify desktop 1.0.4.

## Code findings and hypotheses

### K4: local shell replay

[Shell replay](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/components/Session/PreviewPanel/tabs/terminal/ShellTerminal.tsx#L122)
creates a new xterm instance, writes raw buffered output, subscribes to live data,
and only then schedules fitting/resizing. [Shell registry](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/lib/shellSessions.ts#L52)
stores bounded raw chunks but no historical viewport dimensions or serialized
terminal screen. Replaying cursor-control/prompt output at a different geometry
is a plausible source of visual differences. Buffer trimming may also discard
terminal state needed by later escape sequences. Neither is a confirmed cause of K4.

Capture raw bytes and dimensions across a Session switch with the reporter's shell
configuration. Determine whether `%` is a legitimate prompt/no-newline marker,
a redraw artifact, or duplicate delivery. Do not remove `%` characters or strip
ANSI as a cosmetic fix.

### K6: navigation and output sources

- [Environment row handler](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/components/Session/SidePanel/components/ActivityPanel.tsx#L925)
  calls `setScrollToTurnRequest`, not the agent terminal opener. The row is an
  interactive control in code, but its destination does not satisfy the request.
- [Terminal router](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/components/Session/PreviewPanel/tabs/terminal/TerminalTab.tsx#L40)
  intentionally chooses between a read-only agent stream and a local shell.
  [Chooser](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/components/Session/PreviewPanel/tabs/ChooserTab.tsx#L43)
  already has a separate agent-stream list; this capability should be repaired and
  made discoverable, not rebuilt as a second terminal system.
- [Source collection](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/components/Session/PreviewPanel/tabs/terminal/terminalSources.ts#L68)
  only includes assigned subtasks with non-empty output. A running silent command,
  missing assignment mapping, or insufficient restored history can therefore leave
  no selectable source. Trace the actual path for single-agent and multi-agent runs.
- [Backend output hook](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/backend/app/agent/toolkit/terminal_toolkit.py#L738)
  publishes when logging occurs; [Frontend terminal event handling](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/store/chatStore.ts#L4658)
  maps output to subtasks. Neither alone establishes incremental delivery for
  blocking calls. Inspect the pinned CAMEL implementation and capture timing before
  deciding whether buffering occurs in process reads, logging, transport or rendering.

## Proposed fix sequence

1. **Fix history fidelity using a captured reproduction.** Fit before replay and
   coordinate live subscription/replay ordering. If raw replay cannot reconstruct
   the screen across geometry changes, retain the xterm instance or restore an
   explicit bounded terminal snapshot with dimensions. Verify parser completion,
   resize/redraw behavior and sequence ownership; keep the PTY alive during Session
   switches and dispose it only at its owning lifecycle boundary.
2. **Route environment selection to agent output.** Reuse `openAgentTerminalPreview`
   with a stable source for the selected Session/task. If several commands/agents
   exist, offer the existing chooser with descriptive labels. If none has output
   yet, show a waiting state; if history is unavailable, explain that and offer the
   conversation/log destination. Do not silently open a user's shell as fallback.
3. **Create source identity at command start.** Register running commands before
   first output, including single-agent execution. Preserve Session/run/agent/tool
   identity through live events, completion and replay, using existing contracts
   where available. Distinguish command state from owning subtask state. Keep
   completed output readable after switching Sessions or restoring history.
4. **Deliver incremental output end to end.** Where the timing trace confirms
   buffering, emit bounded stdout/stderr chunks from process readers with ordered
   offsets and explicit completion/exit status. Preserve blocking tool-call semantics
   while streaming observational output. Batch for backpressure, deduplicate on
   replay/reconnect, and retain existing secret scrubbing across chunk boundaries.
   UI alone cannot stream bytes the backend has not emitted.
5. **Keep control boundaries clear.** Label the local shell and read-only agent
   output distinctly through existing translations. Keep ordinary local-shell input
   separate from agent processes. No new agent-input or kill controls are proposed.

## Reproduction and acceptance tests

- Local shell: run newline/no-newline commands and colored prompts; switch Sessions
  repeatedly at equal and different panel widths. History matches the original;
  literal `%` output is preserved; no duplicate chunks or changed line wrapping
  attributable to replay order. Test Unicode, long output, buffer cap and shell exit.
- Agent command prints one line per second for five seconds: first output appears
  before process exit, final output appears exactly once, and exit status is accurate.
  Also test a silent command, stderr, nonzero exit and cancellation.
- Summary → Terminal opens the matching stream during and after execution. Generic
  local-shell creation remains separately labeled. Multiple agents/runs and restored
  Sessions never mix their output or present old output as a running command.
- Add real xterm/PTY replay coverage; mocked router tests cannot establish prompt
  fidelity. Extend source-collector, `TerminalTab`, `ActivityPanel`, page-tab store,
  shell registry and backend terminal output/queue tests. Include packaged macOS
  and Windows smoke tests plus high-volume and reconnect coverage.

## Dependencies and ownership

[PR #1837](https://github.com/eigent-ai/eigent/pull/1837) already changes terminal
transport, restoration, working-directory resolution and chooser labels. Reuse or
rebase onto its final behavior and add the missing K4/K6 regression coverage.
[PR #1906](https://github.com/eigent-ai/eigent/pull/1906) and
[PR #1924](https://github.com/eigent-ai/eigent/pull/1924) overlap run/process cleanup;
all three were open when inspected. Preserve their lifecycle and writer-lease
contracts. Generated-site preview lifetime belongs to the browser plan. Billing
403s and unrelated file-output manifests are outside this plan.

## UI contract for implementation

Preserve `Space → Session → Task` wording and existing backend identifiers.
Keep the Session preview panel and its shared primitives; follow
[`design.md`](../../design-system/design.md) and
[`product-terminology.md`](../../product-terminology.md).
Use existing `Button` (`secondary` for recovery, `ghost` for toolbar actions,
`size="sm"` in compact headers), `DsText`, `DsIcon`, and existing header recipes.
Use `bg-ds-neutral-default-default`, `text-ds-ink-default-default`,
`text-ds-ink-muted-default`, and approved feedback/focus roles.
Existing `electron-guest-rect`, `split-pane-geometry`, and `third-party-viewports`
exceptions remain owned by their current patterns; no new exception is proposed.
Current preview code contains legacy local icon sizes and raw spacing that differ
from the active guideline. Reuse supported primitive APIs in touched recovery UI;
do not copy those discrepancies into new controls or expand this into a redesign.
Implementation must verify loading, empty, ready, failed, disabled, keyboard focus,
long names, narrow/short windows, 200% zoom, light/dark themes, and reduced motion.
No new UI, visual verification, or token change is included in this planning draft.

## Validation recorded for this draft

On the inspected `main` snapshot, this baseline command passed **60 tests in 6 files**:

```sh
npx vitest run test/unit/lib/filePreviewContract.test.ts test/unit/lib/filePreviewLoader.test.ts test/unit/components/Folder/FilePreview.test.tsx test/unit/components/Session/TerminalTab.test.tsx test/unit/components/Session/PreviewBrowserLayer.test.tsx test/unit/store/pageTabStore.preview.test.ts
```

These are existing automated tests, not a reproduction or proof of a fix.
Markdown formatting, source-link validation, and whitespace checks are run before
publication. Type checking, design-token checks, backend tests, and desktop E2E
are not run for this documentation-only delta. For implementation, run the focused
regressions below, `npm run type-check`, `npm run check:design-tokens`, focused
ESLint, locale parity checks for changed translations, and `git diff --check`.
Human testing and screenshots remain pending; no human sign-off is claimed.
