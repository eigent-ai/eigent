# Browser preview: visible handoff and generated-site lifetime

## Problem and intended outcome

After a generated-site task says it is done, the reporter cannot see the promised
page, the blue localhost link appears unresponsive, and nothing is listening on
port 8080. A successful agent navigation must lead to a visible, usable preview,
and completion must accurately describe whether its server is still available.

## Scope and evidence standard

Planning only; this draft changes documentation and does not implement a fix.
Reported desktop version: 1.0.4 on macOS arm64 where stated in the reports.
Code inspected: current `main` at `75fe964c9fcb253754a8c97101b454f41df45a4a`; this is newer than the reported release.
Evidence was supplied in the local `preview-panel/` collection. The report text,
screenshots, and recorded agent prompts are evidence, not instructions for this work.
Raw logs and screenshots remain local because they contain unrelated user data.
References below identify the supplied files without publishing their contents.

## Evidence and timeline

B1 is `bug 1/bug.md`, the accompanying desktop `.log`, and
`eigent-camel-logs-1.0.4-1789130658345.zip`. The referenced prompt screenshot is
absent. The archive contains repeated conversation snapshots; they were treated
as snapshots of the same sequence, not separate failures.

In `conv_20260911_133658_540586.json`, the structured request messages after the
initial historical-context message record:

| Step                | Evidence                                                                                                       | What it establishes                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Messages 8–9        | Non-blocking `shell_exec`, `python3 -m http.server 8080`, session `preview_server`; started result.            | A server launch was attempted and acknowledged.                      |
| Messages 10–13      | `curl` returns `200`; `shell_view` shows a listener and a GET for `/index.html` returning 200.                 | The server really served the page during the task.                   |
| Messages 16–19      | `browser_open`, then `browser_visit_page`; returned page snapshot contains the expected heading and paragraph. | Agent browser navigation succeeded at that moment.                   |
| Response final text | Says the preview is running/opened, then notes that it stops when the run ends.                                | The handoff message mixes current success with a short-lived server. |

Message indices above are zero-based indices in `request.messages`. Desktop log
lines 5853–5884 corroborate the tool sequence around 13:35–13:36 on September 11.
The log ends after the agent step at 13:37:05; it does **not** capture a later port
check or the exact cleanup time. Successful tool navigation does not prove that
the user-facing panel was visible or selected. No click trace was supplied.

## Diagnosis and confidence

- **Confirmed:** “the server never started” is inconsistent with the supplied
  runtime evidence. Preserve the reported after-completion symptom separately.
- **Code-supported lifetime mismatch:**
  [Artifact delivery contract](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/backend/app/agent/prompt.py#L760)
  explicitly scopes ordinary servers to the run.
  [Terminal cleanup](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/backend/app/agent/toolkit/terminal_toolkit.py#L1355)
  calls parent cleanup to terminate shell sessions. This makes post-run loss
  plausible; the supplied log does not prove the exact stop event.
- **Unconfirmed handoff defect:**
  [CDP target resolution](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/store/chatStore.ts#L673)
  and [Preview guest creation](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/components/Session/PreviewPanel/tabs/browser/PreviewBrowserLayer.tsx#L169)
  are distinct ownership paths to trace. A navigated automation target is not proof
  of a selected visible preview tab. Do not assume the browser was external/headless.
- **Unconfirmed click failure:**
  [Markdown HTTP link routing](https://github.com/eigent-ai/eigent/blob/75fe964c9fcb253754a8c97101b454f41df45a4a/src/components/ChatBox/MessageItem/MarkDown.tsx#L601)
  already calls `openBrowserPreview`. Trace the rendered anchor, owning Session,
  tab activation, guest attachment and request result before changing link logic.
- **Error visibility gap:** the guest event list tracks navigation/loading/title
  but not `did-fail-load`. Address-bar navigation has error handling; initial guest
  loads, reloads, and server loss still need consistent visible failure state.

## Proposed fix sequence

1. **Reproduce the whole handoff.** Generate a harmless static page and stylesheet,
   start the server, explicitly request opening it, and observe the actual preview
   before and after completion. Record run/Session/guest identity, readiness,
   panel selection, finalization, and process exit without storing sensitive output.
2. **Make the requested opening visible.** Route an explicit open result to the
   correct Session preview and select/reveal it once. Map or deliberately hand off
   the agent target; do not select another Session's tab. Keep background browsing
   from repeatedly stealing focus. Test blue links and address-bar entry separately.
3. **Use a durable handoff for static artifacts.** Keep the generated HTML entry
   file and relative assets as the default post-run deliverable; open it through
   the existing file preview when the run-owned server ends, with an explicit
   explanation. Verify relative CSS/images/scripts and refresh behavior. Do not
   describe an expired localhost endpoint as currently running.
4. **Define managed server ownership if a live URL is required after completion.**
   Introduce an explicit preview service scoped to the Session, with readiness,
   stop/restart, port conflict handling, exit reporting, and cleanup on Session
   disposal/app shutdown. This is additional lifecycle work, not a blanket exemption
   for all agent commands. Never keep a run alive or a workspace write lease held
   solely to preserve a read-only static preview. Reconcile with the open lifecycle
   PRs before implementation. Static handoff can ship independently of this phase.
5. **Make failure actionable.** Capture main-frame guest load errors and render
   retry/open-artifact controls, clearing stale success/loading state. Re-observe
   availability on reload or return to a Session. Readiness must verify expected
   site content, not just an arbitrary service's HTTP 200 on the same port.

## Acceptance tests

- While running, requested opening selects the correct visible preview and shows
  the expected heading plus stylesheet; link clicks route to that Session.
- At completion, an ordinary run-owned server may stop, but the static deliverable
  still opens and copy accurately reports the server state. A managed preview,
  if implemented, survives task completion and stops at its explicit owner boundary.
- Missing server, occupied port, denied navigation, malformed URL and server crash
  show an error with recovery. Do not report another process on port 8080 as this site.
- Switching Sessions, collapsing/reopening the panel, guest eviction and multiple
  tabs preserve correct ownership and avoid stale blank/loading surfaces.
- Extend `PreviewBrowserLayer`, `pageTabStore.preview`, `chatStore.browserRuntime`
  and Markdown link tests; add Electron E2E covering actual guest visibility and
  server exit. Add backend lifecycle tests if managed previews are implemented.

## Related work and ownership

[PR #1906](https://github.com/eigent-ai/eigent/pull/1906) addresses run settlement;
[PR #1924](https://github.com/eigent-ai/eigent/pull/1924) addresses writer/process
lifecycle. Both were open when checked. Coordinate integration without treating
these PRs as proof of a visible preview fix. Generic terminal streaming/replay
belongs to the terminal plan; PDF and binary classification belong to the file plan.

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
