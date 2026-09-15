# Session side panel: file results bug investigation and fix plan

Date: 2026-09-14. Updated: 2026-09-15. Status: all three fixes implemented;
198 focused tests passed, with Electron fixture verification completed.
A live model run interrupted with Cmd+Q remains unverified because the local
account is out of credits.

Local branch: `fix/session-side-panel-file-results`, created from `main` at
`6bb55842f73766f7b219aa5ef5bcf5965f3acdaa` (the commit tagged `v1.0.4`).
Existing untracked `docs/plans/` and `plans/` content was preserved.

### Draft PR base update

The initial diagnosis below describes v1.0.4. Before publication, the issue
branch was rebased onto main at `75fe964c` after these related changes landed:

- [#1920](https://github.com/eigent-ai/eigent/pull/1920) restores Session
  history and elapsed time, including bounded automatic history pagination.
- [#1921](https://github.com/eigent-ai/eigent/pull/1921) isolates runtime files
  from workspace checkpoints and adds artifact path classification.
- [#1917](https://github.com/eigent-ai/eigent/pull/1917) batches workspace file
  preview resolution safely.

The remaining frontend gaps were reproduced on this updated base and fixed
below. Upstream changes listed above are not authored by this PR. The header
action still uses shared initial-history hydration; older-page recovery remains
owned by its existing runtime and UI.

## Implementation and verification — 2026-09-15

- Added `sessionOutputFiles.ts` as the shared Chat/Summary selector. It merges
  path-only writes with canonical IDs within each Run, applies deletion and
  recreation in sequence order, excludes blank/unidentifiable entries, and
  retains named unavailable files and richer uploaded metadata. Summary row
  keys include the Run ID; backend artifact IDs remain unchanged.
- Preserved manifest presence, sequence, scan status, and truncation through
  the projector, snapshot merge, timeline, and Session overview. A complete
  empty manifest clears older writes; partial/unavailable scans retain known
  files, and writes newer than a complete manifest remain visible. Older
  snapshots cannot replace a newer manifest. Missing artifact arrays are
  treated as unavailable, not as a successful empty scan.
- Applied the shared runtime-directory filter to Chat and Summary, legacy
  local/remote file collections, and Review's Git/overlay/backup paths. Review
  totals describe the visible files. Raw logs, journals, upload policy, valid
  empty files, authored `.log` outputs, and user-file deletions are preserved.
- Retained the compact header history retry from the initial draft, with the
  existing automatic recovery policy. Replaced the existing partial-scan
  warning's backend jargon with a localized message in all 11 locales.

### Automated validation

198 tests passed across 14 focused suites covering output reconciliation,
projector recovery, Chat file cards, Summary data, Review, local/remote file
resolution, header history action, ActivityPanel, and history hydration/runtime.
The replay test includes sanitized payload shapes from the two recorded
`file.written` receipts; subsequent events/envelopes/manifests are explicitly
synthetic. It checks initial two files, duplicate delivery, recovered five,
finalization, and repeated empty-manifest restore across both surfaces.

`npm run type-check`, focused ESLint on changed TypeScript files,
`npm run check:i18n`, `npm run check:design-tokens`, and `git diff --check`
passed. No backend contract changes were needed.

### Electron verification and limits

Launched this checkout's Electron development app and opened an existing
Session. Its loaded Summary had no history-error body section. The account
reported no remaining credits, so a new paid model run and a true live
Cmd+Q/resume reproduction were not possible.

A temporary local fixture then rendered the actual `RunFilesGroup`,
`SessionSidePanel`, header action, projector/store, and filesystem resolver
inside the same Electron app. The fixture substituted runtime context and
chat-store ownership; it did not test live network recovery. Verified:

- Two pre-interruption files, five recovered files, and five final-manifest
  files agree across Chat and Summary; expanding Chat reveals all five names.
- Runtime logs and identity-only blank rows are absent.
- A complete empty manifest removes the Chat card and shows **Files 0**.
- A partial manifest retains five files and displays the localized warning;
  finalization removes the warning.
- Named unavailable files remain visible; after supplying the fixture's Space
  metadata, real Electron IPC resolves local output paths. Selecting
  `notes5.md` in Summary and `notes1.md` in Chat read their expected Markdown
  bytes.
- The history error is a single header action beside the scope selector.
  Clicking it invokes retry once and removes the action on successful recovery.
- Light and dark appearances, collapsed/expanded lists, and unavailable/empty
  states were visually inspected. Reduced-motion classes and disabled pending
  retry states have automated coverage. 200% zoom, long localized paths, full
  preview rendering, and the complete live interrupt/resume flow remain manual
  follow-ups. The exact original seven-row payload was not provided, so the
  reporter's literal blank-row cause remains unconfirmed beyond the covered
  malformed-record and duplicate-identity defects.

Reused existing `ArtifactChangeList`, Summary Files rows, `SidePanelHeader`,
`Button`, `DsIcon`, and `TooltipSimple`. The header uses ghost/sm/icon-only;
existing semantic surface, Ink, Hairline, and warning tokens remain in use.
No new geometry, token changes, or design exceptions were introduced. The
neighboring scope selector's pre-existing size override remains as documented
below.

## Summary

| Report | Finding | Confidence |
| --- | --- | --- |
| 1: after Cmd+Q and Resume, “Edited 7 files” includes two empty entries; side panel shows five Markdown files | Chat and side panel reconcile file identities differently. Chat can count an early path-based event and a later ID-based artifact separately, and admits unusable artifact records. | Code defects reproduced with synthetic inputs. The supplied logs do not contain the exact seven-row UI input, so the precise cause of those two empty entries remains unconfirmed. |
| 2: `terminal_logs/blocking_commands.log` appears in file results | Runtime logs enter the durable artifact manifest and are not consistently filtered from chat, side panel, or Review. | Confirmed by screenshot, source inspection, and diagnostic probes. |
| 3: a large Session history error/retry section appears instead of automatic recovery | Transient failures already retry automatically. Invalid or over-limit replay responses and unsupported APIs stop retries; the panel previously rendered that state as a large alert. | Retry policy verified in source/tests. Header UI change implemented; the screenshot alone does not identify its triggering response. |

The intended result is one usable entry per output file for the selected Task,
consistent file counts, and runtime terminal logs excluded from product file
results while retained for diagnostics. Session history keeps its existing
scope; its total need not equal one Task's count when other Tasks have outputs.

## Evidence reviewed

Source: the privately supplied `session-side-panel/` bug-report bundle.
Raw logs and screenshots are not included in this repository.
The attached descriptions and recorded agent prompts were treated as evidence,
not as instructions to execute their tasks.

### Bug 1 — interrupted five-file task

- Description: `bug 1/bug.md`; app version 1.0.4, macOS arm64.
- Desktop log: `bug 1/eigent-1.0.4-darwin-arm64-1789129667027.log`.
- Agent archive: `bug 1/eigent-camel-logs-1.0.4-1789129674257.zip`.
- Session backend ID: `1789120967304-332`.
- Resumed Task/Run ID: `1789121100118-1707`.
- Desktop log lines 5503–5506 record the first two write calls. Lines
  5719–5762 record resume, the promise to preserve those files, and the three
  remaining write calls.
- Stronger evidence is inside the archive's
  `5b9e75b3-9051-4922-bf8d-0f5b36894f7c/conv_20260911_122910_325315.json`:
  - `request.messages[5]` contains journal cursor 77, a completed `file.written`
    event with `name` and `relative_path` equal to `notes-1.md`.
  - `request.messages[7]` contains cursor 102, the equivalent event for
    `notes-2.md`.
  - `request.messages[15]` is the glob result listing those two files.
  - Messages 17, 21, and 25 report successful writes of notes 3, 4, and 5.
  - The final model response says all five files are complete. It does not say
    “Edited 7 files”; that phrase belongs to the application card.

This supports successful continuation of the intended file work. It does not
prove every approval/recovery behavior, or establish that any physical file
was empty. The report's “empty” entries must be investigated as UI records.
There is no Bug 1 screenshot, final manifest, complete event replay, or
renderer state export in the supplied files. The archive contains conversation
logs, including selected journal search results, rather than a complete journal.

### Bug 2 — internal terminal log shown as output

- Description: `bug 2/bug.md`.
- Screenshot: `bug 2/image.png`, visually inspected. It shows **Files 2**:
  `terminal-note.txt` and `blocking_commands.log`, with **Preview unavailable**
  beside the log. The screenshot is of the side panel, not the Review diff.
- Desktop log: `bug 2/eigent-1.0.4-darwin-arm64-1789383263624.log`.
- Agent archive: `bug 2/eigent-camel-logs-1.0.4-1789383271228.zip`.
- The archive's latest task is “Now delete step11.txt”, Run
  `1789380859837-3047`, in Session `1789378940278-4151`.
  Its embedded earlier history includes terminal commands and a directory
  listing containing both `terminal-note.txt` and `terminal_logs`.
- The archive does not contain the exact `blocking_commands.log` artifact
  event or a screenshot-matched run manifest. The screenshot establishes the
  visible symptom; the code explains how it can occur.

## Code diagnosis

### 1. Inconsistent identity reconciliation after resume

`src/components/ChatBox/TimelineModes/RunFiles.tsx`:

- `uniqueFiles` (line 92) chooses `artifactId || relativePath || path || name`
  independently for each record. A path-only event and an ID-bearing event for
  the same file therefore occupy two keys.
- `useRunFileInfo` (line 272) prefers the manifest only when its array is
  nonempty. Missing and authoritative-empty manifests are indistinguishable.
  An empty completed manifest can therefore revive stale event rows.
- The fallback drops deletion events before reconciliation instead of applying
  them to prior writes. This adjacent edge case should be covered when fixing
  reconciliation, without removing genuine deletions from Review.
- Identity-only records can survive with an empty name and no usable path.
  The current `ArtifactChangeList` display helper falls back to “File”, so this
  alone does not reproduce the reporter's literal blank appearance.

By comparison, `collectFiles` in
`src/components/Session/SidePanel/sections/buildProjectSessionPanelData.ts`
(line 768) rejects pathless nodes and explicitly upgrades a matching path within
the same Run to its canonical artifact ID. These differing rules can explain
why the two surfaces disagree.

The event adapter at `src/lib/projector/chat/adapter.ts:1456` consumes typed
`relative_path`/`relativePath` and `name`, but not `filename` as a display-name
fallback. Inspect this boundary with the actual replay shape before changing
it. The two recorded pre-interruption `file.written` events already have valid
names and relative paths; do not claim those particular events are malformed.

**Reproduced:** two early path-only records plus five canonical records for
five paths produce seven chat rows when no nonempty projected manifest is
provided. Supplying a valid five-entry manifest produces five rows.
This is a confirmed fallback defect, not proof that the reporter's UI took
that exact fallback. Recovery-manifest availability and the final event order
remain the main items to verify during implementation.

### 2. Runtime data lacks a consistent presentation filter

- `backend/app/artifacts.py:154` marks terminal logs `metadata_only`; it does
  not exclude them. `finalize_run_artifacts` also deliberately retains direct
  runtime files when combining filesystem and Git results.
- `backend/app/utils/file_utils.py` skips `camel_logs`, but not `terminal_logs`.
- `backend/tests/app/test_artifacts.py` explicitly expects terminal logs to
  remain in the manifest and stay outside the upload lane. This is intentional
  diagnostic retention, not evidence that they are user deliverables.
- `src/lib/agentFileFilters.ts:23` recognizes only `camel_logs` as a runtime
  directory. Both chat file sources bypass this shared visibility filter.
- The side panel's `collectFiles` also lacks a runtime-file filter.
  `ActivityPanel.tsx:694` resolves files separately, and `mergeProjectFiles`
  enriches durable rows without removing unresolved ones. Filtering only the
  filesystem lookup would leave an unwanted **Preview unavailable** row.
- Electron's recursive listing hides `terminal_logs`, but the explicit-path
  branch of `getWorkspaceFileList` resolves requested paths without that
  directory filter. Enumeration behavior is therefore not a sufficient fix.
- `useReviewChanges.ts:536` maps Git response files directly and retains the
  response totals. The legacy collector also inherits the incomplete filter.
  Removing a visible row alone would leave incorrect diff totals.

**Do not filter on `metadata_only`, `.log`, file size, or preview availability.**
User-owned output files can be metadata-only, valid outputs can be empty or have
a `.log` extension, and remotely restored files can temporarily lack a preview.

## Fix plan

### Step 1 — add replay and output-selection regression fixtures

1. Build a sanitized fixture from the two recorded `file.written` events.
   Add explicitly synthetic recovery/finalization events for the missing
   portion; label them as synthetic in the test.
2. Exercise initial events → interruption → snapshot hydration → resume →
   final manifest → replay/reopen, including duplicate delivery and a later
   manifest replacing a recovery manifest. Check file identities and counts
   at each transition.
3. Cover the known seven-for-five fallback and identity-only records directly.
   If a faithful full desktop reproduction gives a different cause for the
   blank rows, capture its normalized inputs and add that case before fixing it.
   Do not rewrite the original journal or restart the reporter's workload.

### Step 2 — reconcile output identity once per Run

1. Extract a pure output-selection/reconciliation helper shared by chat and
   the side panel. Keep Run identity in scope; do not merge files from different
   Tasks just because their basenames match.
2. Normalize trusted workspace-relative paths with the existing path helper.
   Upgrade an early relative-path identity to a later canonical artifact ID
   when they describe the same path in the same Run. Prefer canonical metadata;
   do not let a stale replay overwrite richer records.
3. Apply create/update/delete events in event order in the fallback path.
   Exclude records that cannot identify a file meaningfully from output counts;
   retain named but temporarily unavailable outputs with the existing disabled
   preview treatment. Keep raw events available for diagnostics.
4. Preserve manifest presence separately from its item count through
   `EventNativeProjectTimeline`, `NarrativeTimeline`, and `RunFiles`.
   An authoritative empty terminal manifest must remain empty. Recovery,
   partial, and unavailable manifests need explicit status handling rather
   than being mistaken for a complete terminal inventory. Inspect projector
   state retention and snapshot merge ordering before adding new state fields.
5. Derive the card heading, rows, and line totals from the same selected list.
   Keep Session history grouping and filesystem/Cloud resolution separate from
   file identity; resolution may enrich a row, not create duplicate rows.

### Step 3 — exclude runtime terminal logs at every output boundary

1. Extend the existing runtime-file predicate to recognize the canonical
   `terminal_logs` directory and supported legacy runtime layouts. Use path
   boundaries, not substring matching or extension checks. Keep ordinary
   `terminal-note.txt`, `my-terminal_logs.txt`, and authored `.log` files.
2. Apply it to both chat sources, durable side-panel rows before resolution,
   and local/remote fallback collections. This also fixes old saved histories
   whose durable manifests already contain the unwanted entries.
3. Apply the same policy to Review's Git and legacy file lists. Recompute
   visible totals from filtered per-file stats; preserve unknown, binary,
   unavailable, and truncated semantics. Include deletions of runtime logs in
   the filter while preserving deletions of user files.
4. Retain raw log files, durable journal records, Git evidence, and diagnostic
   export behavior. Do not change upload policy, delete logs, rewrite past
   manifests, or add broad Git-ignore rules to solve a display problem.
   Backend changes are only needed if replay verification exposes missing
   identity data that the frontend cannot safely recover.

### Step 4 — verify acceptance criteria

| Case | Expected result |
| --- | --- |
| Five Markdown files, quit after two, resume and reopen | Exactly five distinct output paths for that Task; useful labels; no extra records; existing files remain intact. |
| Duplicate or delayed file events and manifest hydration | Stable count and identity; canonical metadata retained; no resurrected stale rows. |
| Complete empty manifest | No stale edited-file card; partial/unavailable scan states retain their warning semantics. |
| Two folders contain the same filename | Two distinct files remain; no basename-based merging. |
| Terminal command creates `terminal-note.txt` and an internal log | Only the authored file appears in output lists; log remains available to diagnostics. |
| Read-only terminal command changes only its runtime log | No edited-output card or runtime-only Review rows/totals. |
| User-authored `.log`, zero-byte file, metadata-only file, or unavailable remote file | Valid output remains visible; preview state is honest. |
| User file deleted; runtime log deleted | User deletion stays in Review; runtime deletion is excluded; deleted outputs are not revived in fallback lists. |
| Session switch, Task/history scope, Cloud restore, local and legacy roots | Existing ownership and preview authorization stay correct. |

## Tests and implementation validation

Extend the existing suites:

- `test/unit/components/ChatBox/TimelineModes/RunFiles.test.tsx`
- `test/unit/components/ChatBox/MessageItem/ArtifactChangeList.test.tsx`
- `test/unit/components/buildProjectSessionPanelData.test.ts`
- `test/unit/components/Session/SidePanelSections/useProjectOutputFiles.test.tsx`
- `test/unit/lib/agentFileFilters.test.ts`
- `test/unit/lib/projector.test.ts` and chat projection contract tests
- `test/unit/components/Session/useReviewChanges.test.tsx`

After implementation, run these focused suites, `npm run type-check`, focused
ESLint for modified source/test files, `npm run check:design-tokens`, and
`git diff --check`. Run `npm run check:i18n` if visible localized copy changes.
If backend artifact contracts change, run the artifact and relevant journal
tests as well. Reproduce Cmd+Q/resume in a disposable macOS desktop test Space;
component tests alone cannot verify the interruption lifecycle.

### Validation performed for the initial Bugs 1–2 investigation

- 34 existing tests passed: RunFiles (11), side-panel data (22), file filter (1).
- Three temporary diagnostic tests passed, confirming the current duplicate
  count, admission of unusable records, and terminal-log leakage. These assert
  current defective behavior; they are not tests proving a fix.
- Temporary diagnostic source was removed from the repository after the run.
- `npm run type-check` passed. `git diff --check` passed; a separate
  `git diff --no-index --check /dev/null` check of this untracked plan reported
  no whitespace errors (exit 1 indicates the new file differs from `/dev/null`).
- Bug 2 screenshot inspected. No live app reproduction, theme review, or
  desktop interruption test was performed. No production source was changed
  during that initial investigation.

## Bug 3 — history recovery occupies an entire section

Source: `image (1).png`, privately supplied in the follow-up.
It shows “Some session history could not be loaded” and a retry button.

### Why it appears and why retry is sometimes manual

`useProjectEventStoreHydration.ts` already loads the Session's saved events
automatically. `ProjectEventRuntimeProvider` owns that loader and the live
event streams once; the chat and side panel consume the same runtime.

- Transient request failures use automatic exponential retry: 1, 2, 4, 8,
  16, then at most 30 seconds between attempts. These show `retrying`, not the
  terminal `error` state pictured in the screenshot.
- `invalid_response` and `limit_exceeded` stop automatic retries for the
  current store incarnation. Examples include a response belonging to another
  Session, invalid event envelopes/cursors, or oversized replay payloads.
- HTTP 404 is classified as `unsupported` and also stops automatic retries.
  It has separate user-facing wording in this version.
- Manual retry clears the block/backoff and starts a fresh history attempt;
  it does not reload the application. A deterministic bad response can fail
  again until its underlying cause is corrected.

The screenshot's generic wording is consistent with `invalid_response` or
`limit_exceeded` in this checkout, but does not distinguish them. No matching
network response or hydration error was supplied for this third report. Do not
attribute it to connectivity, a specific event, or a particular limit without
that evidence. If reproduced, capture the hydration error code/message,
endpoint, response bounds, and Session/Run identity, with sensitive payloads
redacted. Fix a confirmed producer/consumer mismatch rather than bypassing
identity checks or increasing limits indiscriminately.

### Local implementation

- Removed the full error/retry alert and loading/reconnecting block from
  `ActivityPanel.tsx`. Loaded Session sections remain available.
- Added `SessionHistoryAction` to the existing header's action area, beside
  the scope selector. It consumes the existing runtime context and creates no
  additional loader or stream subscription.
- Error: one icon button invokes the existing retry handler. The tooltip and
  accessible name retain the localized failure context and retry action.
- Loading/retrying: the same location shows a disabled busy control with a
  screen-reader status. Spinner motion respects reduced motion. Manual retry
  is disabled while automatic recovery is pending.
- Ready/idle/no Session: the history action is absent.
- Automatic retry and response-validation behavior remain unchanged. The two
  original file-result bugs were subsequently implemented as recorded above.

### Bug 3 validation and design handoff

- 32 focused tests passed after rebasing onto current main, across
  `SessionHistoryAction`, `ActivityPanel`,
  `useProjectEventStoreHydration`, and `useProjectEventRuntime`.
  Coverage includes both blocked replay error codes, unsupported APIs,
  transient automatic recovery, disabled loading/retry states, completion,
  Session switching, and removal of the body alert.
- `npm run check:design-tokens` and `npm run check:i18n` passed.
- `npm run type-check`, focused ESLint for the six changed source/test files,
  and `git diff --check` passed. Desktop and visual theme/keyboard/zoom
  verification were not run.
- Reused `SidePanelHeader`, `Button`, and `TooltipSimple` with
  `variant="ghost"`, `size="sm"`, and `buttonContent="icon-only"`. The shared
  Button owns neutral/Ink colors, circle geometry, icon sizing, and focus.
  No token changes or registered exceptions were introduced; existing
  translation keys and backend identifiers were preserved.
- Existing discrepancy observed: the neighboring scope selector uses local
  size overrides on `SelectTrigger size="sm"`, while the design contract
  provides `size="xs"` for header filters. That existing selector recipe was
  not changed as part of moving history recovery into the header.

## UI and terminology handoff

Read the complete active design and terminology contracts before investigation.
Implementation should reuse `ArtifactChangeList`, the existing side-panel Files
section, `Button`, `DsIcon`, and existing preview/Review components. Preserve
their current semantic surface, Ink, Hairline, status, radius, and control axes;
this plan introduces no visual token or geometry change and no new exception.

Verify light/dark themes, keyboard focus, collapsed/expanded file lists, empty
and unavailable states, long localized paths, narrow windows, 200% zoom, and
reduced motion after implementation. Those states have not been visually
verified in this investigation. Keep visible wording **Space → Session → Task**
and preserve backend `project_id`, `run_id`, routes, persisted identifiers, and
translation keys.
