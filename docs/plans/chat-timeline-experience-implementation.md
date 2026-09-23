# Chat timeline experience implementation plan

Date: 2026-09-23

Branch: `fix/chattimeline-eventbus-launch`

Status: implementation plan complete; product-thinking interview pending. No feature implementation is included in this document.

## 1. Outcome and scope

Make it easy to understand what a task is doing, respond deliberately when it needs input, inspect its result, and reuse successful work.

This plan covers all seven observations from the source review and the subsequent requirements:

1. Move active human decisions out of the composer into a stable floating card, with chronological receipts in the timeline.
2. Explain approval-scope limitations without changing backend permission policy.
3. Put Narrative/Trajectory and the Narrative density control in the Session-title menu, alongside Session actions. Give each density a distinct way to present the same chronological work.
4. Draft an automation from a task using a dedicated agent skill, then reuse the existing automation editor and creation API.
5. Mark model changes at the next submitted task boundary.
6. Add accessible user-message metadata and actions, separating editing from Git recovery.
7. Render interactive HTML artifacts inline in final results, supported by a separate generation skill.

The target is frontend work and skill content using existing backend contracts. Any missing durable capability becomes an explicit dependency; the frontend must not simulate backend support. The exception is not permission to modify backend permission policy, which remains out of scope.

Use Space → Session → Task in presentation. Preserve backend `Project`, `project_id`, `run_id`, Trigger contracts, routes, translation keys, and existing persisted keys. “Run” below describes an execution identity in code, not a proposed new product entity.

## 2. Current foundations and constraints

Source observations were checked on this branch. They are not live UI verification.

| Area               | Existing foundation                                                                              | Gap or constraint                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeline transport | `src/components/ChatBox/index.tsx`, `ProjectChatContainer.tsx`, `EventNativeProjectTimeline.tsx` | Local `.env.local` has `VITE_CHATBOX_EVENT_BUS=false`; legacy and event-native rendering remain separate. Do not enable the flag as part of writing this plan.                                    |
| Event presentation | `src/lib/projector/chat/presentation`, `TimelineModes`                                           | `TimelineRunView` already groups queries, work, interactions, artifacts, and final results. Model and user-action capabilities need explicit presentation metadata.                               |
| View preferences   | `src/types/chatTimeline.ts`, `src/store/pageTabStore.ts`, `Session/HeaderBox/index.tsx`          | View and Narrative density now persist independently. The current dropdown is on the right and all three densities share one action-row structure; this section replans both.                     |
| Human control      | `BottomBox/controlArbitration.ts`, `useEventNativeHumanControl.ts`, `legacyHumanControl.ts`      | Control authority already lives outside button rendering. Preserve durable identity, pending counts, idempotent decisions, and reconciliation.                                                    |
| Permissions        | `backend/app/permission_policy/service.py`, `backend/app/controller/run_controller.py`           | Terminal execution and actions without one exact resource matcher are once-only. This policy offers `once` and, when eligible, `space`; frontend support for `run` does not mean it is offered.   |
| Automation         | `MessageItem/TaskCompletionCard.tsx`, `Trigger/TriggerDialog.tsx`, `src/service/triggerApi.ts`   | Completion card has no callers found in the active source. Dialog can prefill only the prompt through its current public props; creation already exists.                                          |
| Models             | `BottomBox/ModelAndThinkingEffortSelect.tsx`, `src/store/chatStore.ts`                           | Session selection and resolved submission model exist. Current timeline view model lacks a dedicated model snapshot. Resume requires the original model or an explicit backend-supported upgrade. |
| User messages      | `MessageItem/UserMessageCard.tsx`                                                                | Copy and expansion exist. Time, historical editing, checkpoint capabilities, and a complete accessible action row do not.                                                                         |
| Git recovery       | `src/service/workspaceGitApi.ts`, `backend/app/controller/workspace_git_controller.py`           | Restore endpoint prepares a candidate; response explicitly says it is not applied to the user worktree. It is not a completed rewind workflow.                                                    |
| HTML               | `MessageItem/MarkDown.tsx`, `src/components/Folder/index.tsx`, `src/lib/htmlSanitization.ts`     | Chat sanitizes Markdown and shows full HTML documents as code. File preview already has a sandboxed iframe and CSP helpers.                                                                       |
| Skills             | `backend/app/agent/toolkit/skill_toolkit.py`, Settings/Skills                                    | Discovery/configuration and pinned bundle sources already exist. Shipping a skill file in this repository alone does not install it into every user's Space.                                      |

Two discrepancies must be resolved explicitly during implementation:

- `TimelineModes/index.tsx` describes a shared query/result shell, but Trajectory currently renders messages as trace rows. Share the shell deliberately, retaining complete trace inspection without duplicate visible conversation messages.
- Approval options currently all use primary styling. The adopted design guideline specifies one primary action per decision context.

## 3. Shared presentation boundary

Introduce a small presentation contract for the common task shell, built from existing `TimelineRunView` for event-native data and a legacy adapter for ChatStore data. Do not create another event ledger or synthesize backend events.

The common shell owns:

```text
Task boundary: model change when applicable
User message: content, attachments, timestamp, actions
Process: Narrative or Trajectory renderer
Final result: Markdown and validated interactive artifacts
Result actions: files, review, create automation
```

The active decision card is a Session-level overlay above the composer. Timeline receipts remain attached to the triggering task, including when their process group is collapsed.

Presentation metadata must distinguish stable source identity from display text. Proposed fields include query identity, execution identity, optional timestamp, optional resolved model snapshot, and capabilities for edit, artifact preview, automation draft, and checkpoint recovery. Capability flags derive from actual available services/state; absence must not turn into a clickable placeholder.

Use the existing project/run/message identities. Legacy-only identities may support local disclosure state, but must never authorize a durable decision or Git operation. Keep the existing owner responsible for network calls and mutations.

The renderer must retain unsupported trace events for inspection and preserve existing hydration, recovery, source arbitration, and scroll anchors. Do not replace these mechanisms while adding presentation features.

## 4. Session-title menu and Narrative density

### Interaction

Remove the right-side View dropdown. Put an icon-only chevron `Button size="sm"` immediately after the truncated Session title in the left side of the canonical header. The title stays a label, not a menu trigger. Give the chevron an accessible name such as “Session options for [name]”; retain the full title in its tooltip or accessible label. The back button remains before the title, and token usage and Preview remain on the right. Keep the chevron visible when the Session pane is compact. A new, unnamed Session may omit the menu until it has a durable Project identity.

The chevron opens one `DropdownMenu` with two clearly separated sections:

```text
View settings
  [ Narrative | Trajectory ]   pill tab switch
  Narrative detail             only while Narrative is selected
  Compact ──●──── Balanced ──── Expanded  three-stop slider
────────────────────────────
Pin / Unpin
Rename session
End session
Delete session
```

Use the shared `Tabs` pill treatment for the two view choices, with text labels rather than icon-only choices. The Narrative detail control appears only when Narrative is selected. The slider has exactly three stops, labeled Compact, Balanced, Expanded; expose its current value with `aria-valuetext`, keyboard arrows/Home/End, and a visible selected label. Changing a view or density keeps the menu open so the user can inspect the result; closing returns focus to the chevron. If Radix menu keyboard handling conflicts with nested tabs or the slider, move the settings into a menu-owned popover panel while preserving this one trigger and visual structure. Do not leave controls that look functional but cannot be reached by keyboard.

Pin uses the same persisted `eigent-pinned-projects` state as the sidebar. Rename uses the existing Session-name update endpoint and updates both visible Session caches only after success. End and Delete open the existing confirmation flows; End still stops an active task before marking the Session achieved, and Delete retains its history/file cleanup behavior. Reuse one action owner shared by the header and sidebar, rather than duplicating destructive logic or dispatching untyped UI events. Show Unpin for a pinned Session, disable End for an ended Session, and separate Delete visually with its destructive tone. Keep backend `Project` identifiers and the persisted pin key unchanged.

Retain the existing view-switch keyboard shortcut. It cycles available views only, never changes density, and skips modes not supported by the current transport. Do not add a new shortcut for density in the first version.

### State and future modes

- Preserve the serialized `chatTimelineDetailLevel` key and existing values. Use a clearer presentation variable name if helpful without changing serialization.
- Keep the persisted `narrativeInformationDensity` value: `compact | balanced | expanded`, but change its default and unknown-value fallback to `compact`. Do not overwrite an existing explicit preference during migration.
- Match the existing device-local preference scope; this is not a new account-sync setting. Both values persist across Sessions and restarts. Do not introduce a per-Session override in v1.
- Preserve existing retired-view migrations; normalize unknown density values to Compact. Normalize unsupported view selections to the supported default and ensure the label matches the rendered view.
- Keep view IDs and labels typed so a future view can be added to the same View settings section. Do not build a general plugin framework or expose speculative modes.
- Legacy mode receives the same Narrative density behavior. Keep Trajectory available only when its authoritative event source is available; explain its unavailability in the menu if shown. Do not present legacy rows as a complete event trace.

### Density behavior

All three densities keep the Run summary, agent ownership, chronological agent messages, plans, human decisions, errors, files, and final result. They change only the work rows **between** adjacent agent messages. Workforce keeps agent groups; a single-agent Session does not gain a redundant agent wrapper.

| Setting               | Work rows between two agent messages                                                                                                                                                                                                                                                                                               | First view                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Compact (new default) | One accordion for all consecutive toolkit actions in that message interval, regardless of toolkit. This is the current grouped-action treatment. Its summary may show a count, while failure/running state remains visible.                                                                                                        | Accordion closed; the agent message remains visible.                         |
| Balanced              | Preserve order and group only adjacent calls with the same explicit toolkit identity. Give each group a descriptive label containing the toolkit and its distinct method/action descriptions, not only “N actions.” A single call stays as its own action row. Missing toolkit identity does not justify grouping unrelated calls. | Groups closed; individual action titles visible.                             |
| Expanded              | Show message, action, message, action in source order, matching the older non-event-bus structure and density. Each action has its own row; request/response details remain available through that row’s disclosure.                                                                                                               | Action rows visible; large input/output payloads stay bounded and collapsed. |

The outer Run and agent disclosures are independent of density. Switching density must not hide all historical narration just because Compact is selected. Human decisions and errors never disappear inside a generic action-count accordion. An active or failed action must expose its state at the group level. Preserve manual disclosure choices by stable Run/item ID when possible; changing density should not mutate event data or reorder calls. A new Session uses the saved default.

Compare Expanded against a captured legacy Session with interleaved messages and actions before calling parity complete. Test repeated same-toolkit calls, toolkit changes, missing toolkit IDs, one-call intervals, multiple agents, nested subagents, long labels, running/failing calls, restored history, reduced motion, narrow panes, and 200% zoom.

Acceptance: one Session-title chevron menu; a working pill view switch; slider visible only in Narrative; independent persisted state; the three distinct grouping rules above; working Pin, Rename, End, and Delete paths through shared Session actions; keyboard and screen-reader operation; no query/result movement or lost scroll anchor on switching; parity for supported legacy Narrative behavior.

## 5. Human decisions and permission explanations

Extract reusable display-only decision content from `BottomBox/ControlInput.tsx` into a Session-owned decision surface. Keep event-native and legacy decision adapters and `selectBottomBoxControl` authority until the cutover is complete; adapt presentation, not submission semantics.

The floating card contains the request, agent/tool identity when known, useful operation details, pending count, and choices. Preserve a normal composer draft below it, with sending availability controlled by existing pending-input rules. Do not silently convert a drafted follow-up into an approval response.

Use one primary “Allow once” or confirmation action. Broader scopes use secondary controls or a related menu. Render only offered scopes; never manufacture “Always allow.” Keep Stop separate from decision targets so resolving a prompt does not replace Allow with Stop at the same location.

Model the transition as pending → submitting → reconciling → resolved receipt, with failure returning to the same pending request. Key the surface by project/run/interaction/version. Disable the in-flight request, require authoritative resolution, and retain its settled presentation before admitting the next decision.

Verify consecutive requests with pointer double-clicks and held/repeated Enter. The successor must require a fresh deliberate activation after it is presented: consume the outgoing pointer sequence, do not transfer focus automatically to its approving action, and ignore repeated keyboard activation. Do not rely only on a debounce duration.

Always render a compact chronological request/decision receipt outside hidden detail, or a visible pointer to it. Historical, expired, resolved, wrong-run, and read-only requests must not submit. A floating “View request” link can scroll to the receipt without mounting a second independent controller.

Document policy in the UI only from trustworthy payload fields: terminal execution is once-only; exact non-terminal matchers may allow Space scope. When the reason is unavailable, use “This action supports one-time approval” rather than inventing an explanation. Backend policy and offered-scope validation stay unchanged.

Acceptance: no click-through into the next request or composer; one decision submission; retry/reconciliation correctness; multiple pending requests; remount/history/recovery; legacy/event-native behavior; visible scope and completed outcome.

## 6. Automation drafting as a skill

### Product flow

Add “Create automation” to the shared final-result actions. The user selects it, the skill produces an editable draft using the selected task's context, and the existing `TriggerDialog` reviews and creates it. A natural-language request to make work recurring may produce the same draft artifact; merely mentioning a schedule must not call the creation API.

Capture the source Space, Session, execution, and message identity when the action begins. Do not bind the resulting automation to whichever Session happens to be active when generation finishes. Keep the source visible in the draft editor.

V1 targets scheduled repetition. App/webhook automation keeps the existing manual editor until there is demonstrated demand for skill-generated connector configuration.

### Skill deliverable: `automation-draft`

Package `SKILL.md`, an output-schema reference, representative examples, and any small validation helper required by the existing skill distribution path. Use the installed Eigent skill mechanism or a versioned Workspace Bundle; choose one supported distribution route in the first implementation slice and verify new-install, update, disabled-skill, and offline behavior. These are Eigent runtime skills, not Codex personal skills.

Skill inputs: selected task query, relevant user refinements, final result summary, available artifact references, known model selection, and explicit recurrence instructions. Avoid sending the entire trace or credentials. This invocation uses the configured model path; describe its normal usage cost in the loading/retry behavior.

Skill responsibilities:

- Extract the reusable task and its intended outcome, preserving important user corrections.
- Separate repeatable instructions from one-time dates, filenames, examples, and stale result data.
- List required data sources, files, credentials, and output destinations without inventing access.
- Propose a schedule only when the user supplied one. Leave cadence, time, and timezone unresolved when missing; never silently default to midnight daily.
- Return a versioned draft artifact and a readable summary. Do not create, enable, or execute the automation.

Proposed application-owned draft envelope:

```ts
type AutomationDraftV1 = {
  version: 1;
  kind: 'automation-draft';
  name: string;
  description: string;
  taskPrompt: string;
  schedule: {
    text: string;
    timezone?: string;
  } | null;
  requiredInputs: Array<{ name: string; description: string }>;
  unresolved: string[];
};
```

This is a proposed artifact format, not a new backend Trigger payload. Source identity and model/provider authority come from the host's captured context, not model-authored IDs. The frontend schema validator limits lengths, rejects unsupported versions and malformed structures, and maps only supported fields into existing `TriggerInput`/`SchedulePicker` contracts.

Extend `TriggerDialog` with a typed initial-draft input and explicit source binding while retaining `initialTaskPrompt` compatibility. Initialize on opening a new draft, not on every asynchronous update; never overwrite user edits with a late model response. Unresolved required inputs and schedule/timezone ambiguity stay visible and block activation when needed. Verify existing timezone/DST API semantics before promising exact wall-clock recurrence.

Invoke through the existing task/skill mechanism with visible progress. Do not add a hidden model client. Verify how the existing runtime explicitly selects an installed skill and returns its artifact before wiring the action. If that path is unavailable, open the existing manually editable draft seeded from the task and record the skill-generation integration as incomplete.

Creating and enabling are host actions through the existing editor. Guard double submission, reconcile uncertain creation responses before retrying, and never assume the API supports idempotency unless verified. Report success only with a returned automation identity. Allow cancel/retry/manual editing without changing the original task.

Acceptance: explicit recurrence, missing recurrence, timezone ambiguity, one-time instructions, unavailable inputs, disabled/missing skill, invalid draft, late generation after navigation, edited draft preservation, duplicate clicks, creation failure, and the first scheduled execution. The current renderer-dependent execution path must not be described as always-on cloud execution.

## 7. Model boundary and user-message actions

### Model change receipt

Capture non-secret resolved model metadata when a new execution is admitted: model/provider identity and display name, with thinking effort separately where available. Do not capture API keys or raw provider configurations.

Use existing persisted environment/run data where available; first verify its retrieval path and completeness in local, restored, and cloud histories. A local presentation cache may cover new local submissions, but cannot justify claims of durable cross-device history. Missing historical values render as unavailable rather than being inferred from today's Session selection.

Place a small divider immediately before the new user query when its effective model differs from the previous execution. Selecting a dropdown option, cancelling a draft, or changing away and back does not emit a divider. Handle model fallback and queued-task model-resolution semantics explicitly. Resume retains the original execution's model contract; a new attempt is not silently labeled as a new user query.

Acceptance: unchanged model, explicit change, provider fallback, two aliases of the same model, queued submission, failed admission, restored history, missing metadata, and resume.

### Message structure

Extend `UserMessageCard` with optional timestamp and explicit action capabilities. Use a stable metadata/action row: localized time, Copy, Edit and resend, and conditional Git recovery. Keep attachments, full accessible text, narrow-window wrapping, and content expansion. Actions must work on keyboard focus and touch, not only pointer hover; every icon button has an accessible name and loading/disabled state.

“Edit and resend” copies the chosen query and attachments into an editable composer draft while retaining the original history. V1 submits a new follow-up with a visible relation to the source message; it does not replay the conversation from an earlier point. Protect any existing unsent draft from silent replacement. Missing attachments require an explicit resolution before sending.

Do not reuse `ChatBox.handleEditQuery`, which deletes chat/history. A true branch-from-history action requires separate runtime-context support and is not claimed by this v1 behavior.

### Git rewind dependency

Show Rewind only when the source message maps to a usable checkpoint and a verified end-to-end recovery capability exists. “Git enabled” is necessary but insufficient. Recovery must preview affected files and subsequent work, protect concurrent/dirty changes, validate repository freshness, and produce a durable result.

The existing restore endpoint returns a candidate with `applied_to_user_worktree: false`. First trace whether an existing supported apply operation can complete the flow. If not, document the missing backend capability and defer functional Rewind; do not wire raw reset commands behind a button or label candidate creation as completed recovery. Code/file recovery does not undo sent messages, external API effects, or automatically rewind model context.

Acceptance: Copy/time/edit can ship independently. Rewind is complete only with checkpoint identity, preview, application, failure recovery, and repository-state verification—not with a mock button.

## 8. Interactive HTML and its generation skill

### Host foundation

Extract reusable HTML artifact preview behavior from the file viewer into a shared component without weakening existing preview restrictions. Integrate it into the common final-result surface, so Narrative and Trajectory reach the same result component. Ordinary Markdown remains sanitized; arbitrary HTML code blocks remain code.

Use an explicit versioned artifact reference in the final message, for example a fenced `eigent-artifact` descriptor containing `version`, `kind: 'html'`, title, task-owned artifact reference, and text fallback. Finalize that schema alongside the parser before writing skill examples. This is a frontend-recognized message convention over the existing transport, not a new backend event type.

Resolve references only through artifacts authorized for the captured Space/Session/execution. Model-authored paths and URLs are not authorization. Reject traversal, missing or ambiguous artifacts, unsupported versions, wrong-run references, and oversized content. Where legacy history lacks verifiable artifact ownership, retain the normal file/code fallback.

Mount completed content in an opaque-origin sandbox. V1 allows local script-driven interaction, without same-origin access, external network, parent/Electron APIs, popups, top navigation, or automatic form submission/downloads. Use a stricter inline policy than any opt-in remote file-preview mode. Validate navigation behavior in both web and Electron; an Electron navigation hook alone is not browser isolation.

Keep any frame-to-host bridge narrow: bounded resize and explicit host-rendered actions only. Validate source frame, instance identity, message shape, and limits; an opaque-origin message's origin string is not sufficient authentication. Never let frame messages invoke tools, approvals, filesystem access, or automation creation.

Provide loading, error, unsupported, source, expanded-preview, and text-fallback states. Preserve chat scroll position on resize; cap height and content size; mount only completed/visible results with disposal on removal. Interactive state is ephemeral in v1 and may reset on unmount/reload; do not promise saved edits. Browser/Electron resource exhaustion remains a release test, since iframe isolation is not a CPU quota.

### Skill deliverable: `interactive-result`

Package through the same supported skill distribution mechanism as `automation-draft`. Include `SKILL.md`, artifact-contract reference, a small accessible self-contained HTML template, and examples for a filtered table, calculator, and chart.

The skill creates one self-contained HTML file using existing file tools, embeds required data and styles, uses semantic controls, and includes a text summary and validated artifact-reference convention in its final message. It should choose an interactive result only when interaction helps the user's task; routine answers remain Markdown.

No remote libraries, external requests, application APIs, or embedded secrets. Support light/dark presentation, narrow widths, keyboard use, and reduced motion. Treat task inputs as data rather than script source. If generation or artifact association fails, emit a useful Markdown result and normal file reference.

Acceptance: valid completed artifact, streaming/truncated descriptor, malicious paths and scripts, blocked network/navigation, forged frame messages, multiple frames, long/large output, missing files after reload, resizing, cleanup, and equivalent Narrative/Trajectory behavior. A skill alone is not delivery of inline rendering.

## 9. Delivery sequence and completion gates

| Slice | Deliverable                                                                | Depends on                                 | Completion gate                                                                                         |
| ----- | -------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| A     | Representative recorded fixtures and common query/result boundaries        | None                                       | Legacy/event-native source mapping, identity and scroll tests pass; no new transport introduced.        |
| B     | Session-title menu, shared Session actions, three Narrative densities      | A                                          | View/density independent; controls and confirmations work; grouping follows the three rules above.      |
| C     | Floating decision card and policy explanations                             | A                                          | Consecutive-request input safety, one authority, replay/retry/read-only coverage.                       |
| D     | User-message copy/time/edit and submitted-model divider                    | A                                          | Metadata lineage verified; history preserved; unavailable history displayed honestly.                   |
| E     | `automation-draft` skill, parser, result action, editor integration        | A; supported skill invocation/distribution | Reviewed draft creates through existing API; first execution verified; no invented schedule or binding. |
| F     | Shared HTML preview, artifact reference parser, `interactive-result` skill | A; authorized artifact resolution          | Browser and Electron isolation checks pass; complete result and fallback work across modes.             |
| G     | Git Rewind capability investigation, then implementation if supported      | D; verified restore/apply path             | Real recovery verified or explicit missing capability documented; no false Rewind affordance.           |
| H     | Event-native launch/cutover decision                                       | B–F plus recovery parity                   | Live and historical Sessions pass both-path comparison; flag rollback preserves data and controls.      |

Do not tie the first useful release to automation, HTML, or Rewind. First demonstrate B and C internally with actual long-running work, interrupted tasks, multiple agents, and repeated approvals. Add D, then E/F as separately testable increments. Keep G conditional on verified capability. The final event-native cutover is a separate decision from adding presentation features.

## 10. Validation and design handoff

Use `docs/design-system/design.md` and `docs/product-terminology.md` as authoritative contracts, with `docs/design-system/index.html` as visual reference. Reuse the canonical header, `Button`, `DropdownMenu`, `Tabs`, `Tooltip`, `DsText`, `DsIcon`, shared fields, and the existing confirmation dialogs. Use the existing Appearance slider recipe as a reference for the three-stop range control. Select supported axes, including header `size="sm"`, ghost/secondary controls, semantic focus, and one primary decision action. Inspect the actual dropdown at narrow width, short height, 200% zoom, keyboard focus, reduced motion, and all registered light/dark themes; do not add arbitrary control geometry or new color roles.

Use semantic neutral surfaces, Ink hierarchy, Hairline boundaries, card/popover radii, floating elevation for the decision card, and shared spacing. Do not hand-edit generated tokens or inherit deprecated aliases from old components. Inspect the exception registry for chat scroll and iframe geometry; register any genuinely new runtime-coupled exception with an owner and reason before use.

Verification matrix:

- Both flag values; single-agent and workforce; live, completed, failed, interrupted, resumed, read-only, and restored history.
- Light/dark, keyboard-only, screen-reader labels, reduced motion, 200% zoom, narrow and short windows, and long localized copy.
- Multiple pending approvals, consecutive activations, failed/stale responses, remounts, mode changes during submission, and another Session becoming active.
- Long timelines, large tool payloads, empty/missing metadata, attachment failures, history hydration, and scroll anchoring.
- Invalid/missing/late skill outputs, manual editor changes, missing credentials, ambiguous recurrence, and uncertain create responses.
- Actual browser and packaged/Electron HTML behavior, not only DOM or Node tests.

Required implementation checks, scoped to each slice:

```bash
npm run check:design-tokens
npm run type-check
npm run check:i18n
npx vitest run <affected-test-files>
npx eslint <changed-source-files>
npx prettier --check <changed-files>
git diff --check
```

Run token generation only if token sources change. Extend existing tests in `test/unit/components/ChatBox`, `test/unit/lib/htmlSanitization.test.ts`, and relevant stores/services; add focused regressions for behavioral boundaries above rather than snapshots that mirror markup. Do not add tests for the plan document itself.

The preceding source review ran four focused suites: 67 tests passed. That is a baseline for current behavior, not validation of this proposed work. No runtime/theme verification was performed during that review. This planning change requires only document formatting and diff checks.

Each implementation handoff must report reused primitives, semantic axes/tokens, verified states/themes, exceptions, passing/skipped commands, and precise implementation/commit/push/deployment status. Preserve the unrelated local modification in `src/store/authStore.ts`.

## 11. Product review and evidence still required

After completing this plan, run the explicitly requested `emil-product-thinking` interview using its `principles.md`. The skill requires one question per turn, with a recommended strong answer, starting in Reason to exist. Do not fabricate user evidence or label a static self-review as a completed interview.

Known observations: approval placement creates a reported misclick risk; the work log feels too compressed. Not yet established: which real users struggle most, the recurring tasks they already repeat manually, whether interactive output improves a task outcome, and how often they need historical edit/recovery.

Collect concrete examples before locking the release scope. Candidate evaluation tasks are: correctly explain what is running, resolve two consecutive approvals without unintended action, locate a result/file, turn a repeated task into a correct scheduled draft, and use an interactive result to answer a question. Compare these against current behavior; record errors and completion time, not just preference for a prettier screen.

Interview status: not completed. The plan's technical sequence is actionable, but product priority remains subject to the user's answers. Record the final verdict and any scope changes here after the interview, without treating unanswered questions as approval or rejection.

## 12. Implementation checkpoint on this branch

The first implementation pass includes the right-side View dropdown with a persisted Narrative detail preference; Compact, Balanced, and Expanded work-log disclosure defaults that still share one row structure; a floating human-decision card above the disabled composer; a separate review step before actions on a successor request; visible one-time-only approval guidance; Copy, time, and edit-a-copy actions on user messages; bundled `automation-draft` and `interactive-result` skills; and a task-result action that opens the existing automation editor with a validated draft when the result contains one. The task automation editor shows its captured source Session and requires the user to review its schedule and required inputs before creation. The revised §4 supersedes that dropdown and density behavior; it is planned, not implemented on this branch.

The automation action currently opens a manually editable editor when the result lacks a valid `automation-draft` block. When the bundled skill is enabled, a separate “Draft with skill” action prepares a follow-up using the selected task's request and result; the user submits it through the normal task runtime, where `SkillToolkit` can load the skill. This does not start a hidden model call or automatically replace an existing composer draft. Installed-skill invocation and the returned artifact still need an end-to-end runtime check. The existing `SchedulePicker` initializes a daily schedule even when no recurrence was requested; the added review gate prevents silent creation from this task action, but mapping natural-language schedules into the picker remains unimplemented.

Approval scope is backend policy, not a frontend setting. `backend/app/permission_policy/service.py` allows persistent Space scope only for one exact target resource and excludes `terminal.execute`; otherwise it offers `once` only. The frontend renders the offered scopes and now explains a once-only request generically. No backend policy was changed. A Run scope label exists in the UI type but is not currently emitted by this backend path.

Rewind remains conditional. `backend/app/controller/workspace_git_controller.py` returns a restore candidate with `applied_to_user_worktree: false`; no verified apply operation was found in the traced UI path. There is no Rewind action in this pass.

The model-change divider is now a shared UI component in both timeline views. It appears before the next user query only when consecutive Runs have different resolved model identities; missing data leaves it hidden. The separate draft PR #1965 adds `resolved_model` to durable Run list and detail reads. Wiring those reads into the event-native presenter remains follow-up integration work; the current Session model cannot label older Runs, especially restored history.

Inline HTML rendering remains unimplemented. The bundled skill intentionally produces a normal HTML artifact and text fallback until the host can resolve a final-message descriptor against the same Run's authorized artifact manifest and isolate browser/Electron navigation. The current file viewer's HTML sandbox allows forms and downloads, so it cannot be reused unchanged for inline results.

The edit action copies text into the composer, preserves prior history, and asks the user to reattach files. A durable source-message relation on the submitted follow-up is not yet available in the current message contract. This v1 action is labeled “Edit and resend” in the UI, but it does not rewind model context.

Validation for this checkpoint: `npm run check:design-tokens`, `npm run type-check`, `npm run check:i18n`, focused Vitest suites (107 tests), scoped ESLint, Prettier, skill validation, and `git diff --check` passed. Token verification covered registered light/dark themes; actual interactive browser/Electron visual and navigation QA has not yet run. No design-system exception was registered; the new surfaces reuse shared `Button`, `DropdownMenu`, `Checkbox`, `Input`, and dialog primitives with semantic neutral, hairline, Ink, and elevation roles.
