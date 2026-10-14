# Model comparison plan

> **Status: proposal.** This plan describes a developer tool for running the
> same Task on two models and comparing the results. Nothing here is
> implemented yet.

## 1. Goal

Developers need a quick, fair way to answer "how does model B handle this
Task compared with model A?" inside Eigent. They should be able to:

1. Write one prompt, pick two models, and start both runs with one action.
2. Watch both runs progress at the same time.
3. Compare the outcomes: final answer, files produced or changed, tool use,
   time, tokens, and failures.
4. Continue either side independently afterwards.

The feature targets developers evaluating models and prompts. It ships behind a
developer flag and is not part of the default product surface.

### Non-goals

- Automatic quality scoring or an LLM judge. Developers make the call. A judge
  can be added later on top of the same data (see §9).
- Changing the model of an existing Run or resuming a Run on another model.
  The resume capability digest deliberately refuses a model change
  (`docs/model-capabilities.md`, "Revisions and resume").
- More than two models in the first release. The data model allows N lanes,
  but the UI and cost guardrails start with two.

## 2. Recommendation: two linked Sessions, not two models in one Session

There are two ways to build this.

| | **A. Two models inside one Session** | **B. Two linked Sessions (recommended)** |
| --- | --- | --- |
| Model pin | Needs a second pin and a new "lane" axis on `SessionModelSelection` and admission | Each Session already owns one pin (`Project.metadata.modelSelection`) |
| Working folder | Both runs share one working folder and the workspace writer lease, so they serialize or overwrite each other | Each Session gets its own `copy` working folder |
| Run journal, follow-ups, resume | Every Project-keyed record (`RunRecord.project_id`, conversation history, `task_locks`) needs a lane dimension | Unchanged, because each lane is an ordinary Project |
| Chat UI | `chatStore` (about 9k lines) and the timeline need to render two interleaved run streams | Each Session renders as it does today; the comparison view hosts two of them |
| Review, Files, terminals, delete | Need lane awareness everywhere | Work as-is per Session |
| Backend changes | Admission, task lock, workdir resolver, run journal | One read-only usage summary endpoint |

**Option B wins.** A Session (backend `Project`) is already the unit that owns
the model pin, the working folder, the run journal, the follow-up history, and
the review diff. Putting two models in one Session would fork every one of
those along a new axis, and the shared working folder would make the
comparison unfair or broken. Two Sessions give clean isolation now. A
comparison layer on top only links them and presents them together.

From the developer's point of view it still feels like one action and one
view: they start a comparison from the composer and land on a side-by-side
comparison view. The two Sessions underneath are an implementation detail they
can also open individually.

## 3. What exists today

These are the building blocks the plan relies on, verified on `main`:

- **Session model pin.** `ProjectMetadata.modelSelection` in
  `src/store/projectStore.ts` is persisted through `setProjectModel` and
  reused by `startTask`. The backend receives it as
  `Chat.session_model_selection` (`backend/app/model/session_model.py`).
- **Per-Session working folders.** `freeze_task_directories_for` in
  `backend/app/utils/workspace_resolver.py` gives `copy` (and `worktree`)
  Sessions their own `project_workdir_root(space_id, project_id)` seeded from
  the Space baseline. `direct-write` Sessions all write to the Space root.
- **Session creation.** `createSyncedProjectInSpace` in
  `src/lib/spaceProject.ts` accepts `workdirMode` and free-form `metadata`.
  The server shallow-merges Project metadata, so no schema migration is needed
  to add a comparison link.
- **Concurrent runs.** `task_locks` in `backend/app/service/task.py` is keyed
  per Task, so two Sessions can run at the same time in one Space.
- **Run facts.** The run journal records `ModelInvocationRecord` (prompt,
  completion, and cache tokens; `started_at`, `first_token_at`,
  `completed_at`; finish reason; errors) and `ToolCallRecord` (tool, status,
  outcome, timings). `GET /runs/{run_id}` already returns attempts, total
  elapsed time, and tool calls, but no model-usage totals.
- **Review diff.** `src/components/Session/PreviewPanel/tabs/review` renders
  file diffs per Session with Monaco.
- **Composer model control.**
  `src/components/ChatBox/BottomBox/ModelAndThinkingEffortSelect.tsx`.
- **Feature flags.** Vite env flags such as `VITE_CHATBOX_EVENT_BUS`
  (`src/store/chatEventProjectionBridge.ts`).

Two constraints shape the design:

- `ProjectChatContainer` reads `projectStore.activeProjectId`, so it can only
  render the active Session. A side-by-side view needs it to accept a
  `projectId` (Phase 2).
- The browser toolkit defaults to CDP port 9222 and a profile keyed by port
  (`backend/app/agent/toolkit/hybrid_browser_toolkit.py`). Two concurrent
  browser-agent runs could share one browser. Phase 0 verifies this.

## 4. Concepts and data model

### Comparison

A **Comparison** is a group of two Sessions created from the same prompt in the
same Space. Each Session is one **lane** (A or B).

The link is stored in each Session's Project metadata. It is a new key for a
new feature, not an alias for an existing one:

```ts
interface ProjectComparisonLink {
  /** Shared by every lane in the group. */
  groupId: string;
  /** Stable lane label shown in the UI. */
  lane: 'a' | 'b';
  /** Sibling Session IDs, ordered by lane. Backend Project IDs, unchanged. */
  projectIds: string[];
  /** SHA-256 of the prompt and attachment names, to detect drift. */
  promptDigest: string;
  createdAt: number;
}

interface ProjectMetadata {
  // ...existing fields
  comparison?: ProjectComparisonLink;
}
```

Why metadata and not a new table: a Comparison has no state of its own beyond
the link. Status, timings, and outputs all come from each lane's Runs. Keeping
it in metadata means deleting a Session needs no cascade, and the rest of the
product treats lanes as ordinary Sessions. If comparisons later need their own
notes, verdicts, or more than a handful of lanes, promote them to a Space-owned
record then.

### Fairness rules

Both lanes must differ only in the model. At launch the comparison:

- sends the same message, attachments, and thinking effort to both lanes. The
  effort is only kept when both models support it. Otherwise the launcher
  shows the mismatch before starting and lets the developer choose.
- uses the same Space, session mode (`workforce` or `single-agent`), Space
  configuration revision, toolkits, and MCP servers;
- forces `workdirMode: 'copy'` for local Spaces so each lane starts from the
  same baseline and cannot see the other lane's writes. Non-local Spaces use
  `artifact-only`, which is already per Task;
- records the `promptDigest` so the comparison view can flag lanes that later
  diverged through follow-ups.

## 5. User flow

1. With `VITE_MODEL_COMPARISON=true`, the composer shows a **Compare models**
   toggle next to the model control.
2. Turning it on adds a second model control, labeled **Model B**. The current
   selection becomes **Model A**.
3. The send action reads **Run comparison**. A short note warns that the
   comparison runs the Task twice and uses usage for both runs.
4. On send, Eigent creates two Sessions, pins one model on each, starts both
   runs, and opens the **Comparison** view.
5. The comparison view shows both lanes side by side, with live progress and a
   metrics strip. Each lane has an **Open session** action.
6. Follow-ups can be sent to one lane from its own Session, or to both from the
   comparison view's composer (Phase 4).
7. In the sidebar, the two Sessions appear with an **A** or **B** tag and the
   model name, so developers can tell them apart.

Session names default to the prompt, followed by the lane and model, for
example `Refactor auth flow · A · Model name`.

## 6. Phased delivery

Each phase is a separate PR and is shippable behind the flag.

### Phase 0: verify concurrency (spike, no UI)

Verify the assumptions in §3 before building on them:

- Start two `copy` Sessions in one local Space at the same time with different
  models and confirm both runs progress in parallel and write to separate
  folders.
- Check the browser toolkit. If two runs share the CDP port and profile,
  choose one of two fixes:
  - allocate a separate browser per lane through `cdp_browsers`; or
  - document browser tasks as unsupported in the first release and warn in the
    launcher.
- Check terminal processes, the workspace writer lease, and MCP servers for
  any Space-global state that would couple the lanes.
- Check provider rate limits when both lanes use the same provider key.

Outcome: a short findings note added to this plan, and any blocking fixes as
their own PRs.

### Phase 1: launch and link

Frontend only.

- Add `VITE_MODEL_COMPARISON` and a `useModelComparisonEnabled()` helper.
- Add `startModelComparison()` in a new `src/lib/modelComparison.ts`:
  1. Validate both selections against the same rules as a normal send
     (quota, provider validity, effort support).
  2. Create both Sessions in parallel with `createSyncedProjectInSpace`
     (`workdirMode` per §4, `metadata.comparison`, `setActive: false`).
  3. Pin each model with `setProjectModel`.
  4. Start both runs with the same payload through each Session's chat store
     `startTask`.
  5. If one lane fails to start, keep the other running and show the failure
     in that lane, without rolling back the successful lane.
- Add the **Compare models** toggle and the **Model B** control to the
  composer by reusing `ModelAndThinkingEffortSelect`.
- Add the lane tag to `SessionNavItem` and a comparison header in the Session
  view that links to the sibling Session.
- Emit PostHog events `model_comparison_started` and
  `model_comparison_lane_failed` with model identifiers only. Never include
  prompt content.

At the end of Phase 1, a developer can start a comparison and switch between
the two Sessions to compare them by hand.

### Phase 2: comparison view and metrics

- **Backend.** Add `GET /runs/{run_id}/usage`, or a `usage` block on
  `GET /runs/{run_id}`, that aggregates `list_model_invocations(run_id)`:
  - model calls, retries, errors, and finish reasons;
  - prompt, completion, cache-read, and cache-write tokens;
  - time to first token (first invocation) and total model time.

  Tool-call counts and wall time already come from `GET /runs/{run_id}`
  (`tool_calls`, `total_attempt_elapsed_ms`). Cover the aggregation with
  isolated tests in `backend/tests/app/controller`.
- **Frontend refactor.** Make `ProjectChatContainer` and the timeline accept an
  explicit `projectId`, defaulting to the active Session so existing call sites
  are unchanged. This is the main refactor risk in the plan. Land it on its
  own with the existing ChatTimeline tests before the comparison view uses it.
- **Comparison view.** A new Space-owned workspace tab, `WorkspaceTab.Compare`,
  holds `ModelComparisonView` with two `SessionComparisonPane` children. Each
  pane shows:
  - a lane header with the lane tag, model name, effort, run status, and an
    **Open session** action;
  - the read-only Session timeline for that lane;
  - the final answer, pinned at the bottom once the run ends.
- **Metrics strip** across the top: status, wall time, time to first token,
  model calls, tokens (input, output, cache), tool calls (total and failed),
  files changed, and errors. Show differences as plain numbers. Do not color a
  lane as better or worse, because a lower number is not always better.

### Phase 3: output diff

- **Final answer diff.** A text diff of the two final answers using the Review
  tab's Monaco diff setup (`monacoModelLifecycle.ts`).
- **File diff.** Compare lane A's working folder with lane B's. This is
  output-against-output, not before-and-after. The backend lists both folders
  relative to the shared baseline. The view groups files as only in A, only in
  B, or changed in both, and reuses `ReviewFileTree` and `DiffFileCard`.
- **Apply a lane.** For local Spaces, let the developer apply one lane's
  changes to the Space through the existing Session apply flow
  (`SpaceProjectApplyResponse`). Nothing is applied automatically.

### Phase 4: iteration and export (optional)

- Send a follow-up to both lanes from the comparison view.
- Re-run the same prompt on a third model as a new lane.
- Developer notes and a verdict per comparison. This would promote the
  Comparison to its own record.
- Export a comparison report (Markdown or JSON) with the prompt, models, final
  answers, metrics, and file list. It must exclude credentials and use the run
  journal's existing redaction.

## 7. UI design notes

These follow `docs/design-system/design.md` and
`docs/product-terminology.md`.

- **Terminology.** Visible copy says **Session**, **Comparison**, and
  **Task**, never **Project**. Backend identifiers stay `projectId`,
  `project_id`, and `Project`. `ProjectComparisonLink.projectIds` carries
  backend IDs unchanged. Translation keys go under a new `comparison.*`
  namespace, in sentence case.
- **Ownership.** `ModelComparisonView` is Space-owned because it lives in the
  Space workspace and spans Sessions. Its children are Session-named
  (`SessionComparisonPane`, `SessionComparisonHeader`).
- **Primitives.**
  - `ContentHeader` (routine 40px) for each pane header.
  - `Button` for actions: one primary action per context (**Run
    comparison**); **Open session** is `variant="ghost" size="sm"`.
  - `ModelAndThinkingEffortSelect` for both model controls.
  - Tag or badge pills with `text.meta` for lane labels.
  - `DsText` roles: `body-large` semibold for pane titles, `meta` for metric
    labels, and `channel="code"` for token counts and durations.
- **Lane identity.** Lanes are labeled **A** and **B** in text. Color is not
  the only distinction. Use neutral surfaces for both lanes. Do not use
  feedback colors for winner or loser.
- **Layout.** The two panes split the available width evenly. At narrow widths
  or 200% zoom they stack, with a lane switcher. Each pane owns its scroll
  area and uses `scrollbar-always-visible`.
- **States.** Starting, running, waiting for approval, completed, failed,
  stopped, and one lane failed to start. Each state shows text, not only
  color.
- **Approvals.** Approvals for each lane appear in that lane's pane and in its
  Session, as they do today. The comparison view never approves both lanes at
  once.

## 8. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Shared browser or CDP profile across lanes | Phase 0 spike. Allocate a per-lane browser, or warn and skip in the first release |
| Copying large Spaces twice is slow or uses disk | Show the Space size in the launcher. Use git worktrees for git Spaces in a later iteration |
| Double usage cost, especially on Eigent Cloud | Show a cost note in the launcher, check quota for both lanes before starting, and keep the developer flag |
| Provider rate limits when both lanes share a key | Surface rate-limit errors per lane. Allow staggered start as a launcher option if Phase 0 shows contention |
| `ProjectChatContainer` refactor regresses the main Session view | Default `projectId` to the active Session, land the refactor in its own PR, and run the ChatTimeline tests |
| Lanes drift after follow-ups | `promptDigest` plus a "diverged" note in the comparison view |
| One lane is deleted | The surviving lane keeps working. The comparison view shows the missing lane as removed |

## 9. Future extensions

- An LLM judge or rubric scoring that reads the Phase 2 and Phase 3 data. Keep
  it optional and clearly labeled as model-generated.
- Batch comparisons over a saved prompt set, for regression testing a model
  upgrade.
- Using `POST /runs/{run_id}/fork` to branch both lanes from a shared
  checkpoint. Today a fork must resume on the same model, so this needs a
  deliberate capability-contract change first.

## 10. Open questions

1. Should the gate be an env flag only, or also a Settings toggle for
   internal builds?
2. Is two lanes enough for the first release, or do developers need three?
3. For git Spaces, should Phase 1 use `copy` or go straight to per-lane git
   worktrees?
4. Should comparison Sessions be hidden from the main Session list by
   default, to avoid clutter, and shown only under the comparison?

## 11. Validation per phase

- Frontend: `npm run type-check`, focused `npx vitest run` for new
  `modelComparison` helpers and components, `npm run check:design-tokens`,
  focused lint, and locale parity for new `comparison.*` keys.
- Backend: isolated tests through `backend/tests/run_isolated.py` for the
  usage endpoint.
- Manual: run one comparison in a local Space and one in a non-local Space,
  covering a file-writing Task, a failing lane, an approval in one lane, and
  light and dark themes.
- Always run `git diff --check` before review.
