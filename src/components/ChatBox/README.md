# ChatBox architecture and spacing

This document describes the current ChatBox structure, layout relationships,
spacing rules, and the planned removal of the legacy ChatStore renderer. Paths
are relative to `src/components/ChatBox/`.

## Direction

The target architecture is the event-native timeline plus the shared
`BottomBox` composer. The older `ProjectChatContainer` → `ProjectSection` →
`UserQueryGroup` renderer remains available behind the event timeline feature
switch while migration is in progress.

New conversation presentation work should be added to `EventTimeline/`, not to
the legacy `MessageItem/` routing path.

## Current runtime structure

```text
ChatBox
├── scroll viewport
│   └── timeline column (Narrative: 600px max; Trajectory: full width)
│       ├── event-native path
│       │   └── EventNativeProjectTimeline
│       │       └── TimelineModeRenderer
│       │           ├── NarrativeTimeline (segments + CallRow)
│       │           └── TrajectoryTimeline (trace rows)
│       └── legacy fallback path
│           └── ProjectChatContainer
│               └── ProjectSection (one task/run)
│                   ├── UserQueryGroup (one user turn)
│                   │   ├── UserMessageCard
│                   │   ├── PlanTaskBox or TaskCard
│                   │   ├── TaskWorkLogAccordion
│                   │   └── AgentMessageCard / NoticeCard / interaction UI
│                   └── FloatingAction
├── PlanTaskBox overlay portal (legacy only)
└── BottomBox overlay (width: 100%; maximum width: 600px)
    ├── QueuedBox
    ├── floating UsageLimitBanner or PickerPanel
    └── BoxMain
        ├── BoxHeader
        ├── ControlInputRouter
        │   ├── InputBox
        │   │   └── RichChatInput
        │   └── approval / selection / form / feedback / blocked controls
        └── BoxFooter
            ├── project mode
            ├── approval mode
            └── thinking effort + model selector
```

## Event-native components to keep

```text
ChatBox/
├── index.tsx
├── EventNativeProjectTimeline.tsx
├── EventTimeline/
│   ├── index.ts
│   ├── EventTimeline.tsx
│   ├── EventRenderer.tsx
│   ├── EventRendererBoundary.tsx
│   ├── DefaultEventRenderers.tsx
│   ├── UnknownEventFallback.tsx
│   ├── presentationPolicy.ts
│   └── rendererRegistry.ts
└── BottomBox/
    ├── index.tsx
    ├── types.ts
    ├── useEventNativeHumanControl.ts
    ├── ControlInput.tsx
    ├── InputBox.tsx
    ├── RichChatInput.tsx
    ├── BoxHeader.tsx
    ├── BoxFooter.tsx
    ├── QueuedBox.tsx
    ├── PickerPanel.tsx
    ├── UsageLimitBanner.tsx
    ├── ApprovalModeSelect.tsx
    └── ModelAndThinkingEffortSelect.tsx
```

### Event-native data flow

1. Durable project/run events hydrate the project event store.
2. The chat projector converts transport events into semantic
   `ChatProjectionNode` values.
3. `presentChatSemanticEntities` folds lifecycle receipts into logical
   entities (L1).
4. `composeTimelineRuns` builds one `TimelineRunView` per Run.
5. `EventNativeProjectTimeline` bounds the mounted history window.
6. `TimelineModeRenderer` picks Narrative or Trajectory.
7. `BottomBox` renders the event-derived human control or the standard input.

### Normal timeline hierarchy

When the event-native read path is enabled, Normal always renders from the
semantic Run timeline. It keeps the legacy outer Run disclosure without
reading presentation data from `ChatStore`, then selects its second layer from
the Project session mode:

```text
Worked for / Working on tasks for
├── Single Agent: flat chronological event list
│   ├── event or reasoning text
│   ├── permission or human-input receipt
│   └── repeated toolkit/method event group
│       └── individual tool-call accordions
└── Workforce: one System/Agent accordion per Run-wide identity
    ├── chronological event
    ├── reasoning text
    ├── permission or human-input receipt
    └── repeated toolkit/method event group
        └── individual tool-call accordions
```

Single Agent never renders a `Single Agent` or `System event` accordion.
Workforce creates one stable accordion per agent, ordered by that actor's first
visible event, and preserves chronological order inside each actor. Explicit
agent IDs are authoritative; unique name and task correlations can join
partial receipts, while ambiguous or unattributed rows stay in the one System
accordion. Plans remain System events even when their tasks have assignees.

Agent activation/deactivation frames provide Workforce identity metadata but
are not child events. Their legacy `message` is the raw model input (for
example the injected Lightweight Memory context), not assistant reasoning, and
an unmatched activation can otherwise look permanently active after a stopped
Run. Displayable reasoning comes from assistant narration messages.

Human interactions are rendered at their request sequence. The semantic
presentation layer folds an explicitly correlated resolution onto that request
before Run composition, so answering a question updates the original row
instead of moving it to the end or nesting it under a tool.

## Timeline modes

Two modes, selected by an `IconPillToggle` in the Session header and persisted
in `pageTabStore`:

| Mode         | Question it answers               | Work-band unit |
| ------------ | --------------------------------- | -------------- |
| `narrative`  | What did it do for me?            | Segment        |
| `trajectory` | What exactly happened, and where? | Trace row      |

Only the work band differs. The user query, plan, interrupts, artifacts, and
final response render identically in both, so toggling never moves the row the
reader was looking at.

### The segment layer

`lib/projector/chat/presentation/segmentTimeline.ts` folds trace rows into
narrative segments. A segment is one piece of narration plus the calls made
while carrying it out. Boundaries come only from data the projection already
carries: new narration, an agent change, a task change, a toolkit change, or
an interrupt. Wall-clock gaps are deliberately **not** a boundary.

`TimelineSegment.source` is the seam for backend step events. Everything is
`derived` today; backend `step.*` events will supply `authored` segments with
real titles and no renderer change.

### Narrative typography

Primary text is reserved for language the agent produced itself. Anything the
frontend derived from toolkit and method names stays subdued, so the reader can
always tell narration from inference.

| Content                                 | Token                                  |
| --------------------------------------- | -------------------------------------- |
| Narration, work-log progress, plan text | `text-ds-text-neutral-default-default` |
| Derived segment label, calls, counts    | `text-ds-text-neutral-subtle-default`  |
| Work-band header                        | `text-ds-text-neutral-muted-default`   |

A segment with no narration promotes its derived label to primary, because it
is then the only text there is.

### Calls: one row, two executors

`presentation/timelineCalls.ts` maps both a toolkit invocation and a human
interaction onto one `TimelineCall`. They share a shape — a request, an
executor, a response — so `TimelineModes/CallRow.tsx` renders both. Only the
labels and title grammar differ:

| Family      | Interaction types                                      | Labels               | Title            |
| ----------- | ------------------------------------------------------ | -------------------- | ---------------- |
| `ask`       | question, feedback, human_feedback, form, confirmation | Question / Answer    | `You · Answered` |
| `authorize` | approval, credential_binding                           | Requested / Decision | `You · Allowed`  |
| `choose`    | choice, selection, merge_conflict, diff_review         | Options / Selected   | `You · Selected` |

An unrecognized future interaction type falls back to `ask`, which is the only
family whose labels stay accurate for an unknown pair. **The timeline never
renders an approve/reject control** — permission actions belong to `BottomBox`.
A pending request shows as `Input required`; the resolved record shows the
prompt and the human's answer through the same disclosure a tool call uses.

### Fold policy

Calls stay folded by default; narrative exists to show the agent's words, not
its tool rows. A failed segment is the exception and opens to the failing row.
While a segment is folded the running shimmer sits on its label; opening it
hands the shimmer to the call that owns it, so exactly one indicator shows.

### Pause and resume

`paused` flows from `ChatBox` into both renderers. While paused, elapsed time
holds, the shimmer and status spinners stop, and the header reads
`Paused after`. The work log stays open, because a pause is not an ending.
`usePausedOffsetMs` subtracts the paused span so the timer continues from where
it stopped rather than jumping forward by the wait.

### Repeated tool-call presentation

`EventTimeline/activityGrouping.ts` converts consecutive identical tool
activity nodes into logical calls before rendering. It pairs lifecycle frames
with a backend `toolCallId` when available and uses FIFO pairing for older
events without correlation. The source projection remains immutable.

Calls are grouped only when the run, agent, toolkit, and method match without
another timeline node between them. A message, interaction, different tool,
or Run change ends the group in Single Agent. Workforce applies the same rule
inside each agent's own chronological list.

- One logical call renders as an accordion with the safe Request then Response.
- Two or more calls render through `RepeatedToolCallGroup.tsx` as
  `Toolkit · method · count events`.
- The repeated group is collapsed by default and expands to show each call's
  individual status and safe display detail.
- Aggregate running, completed, cancelled, and failed states appear on the
  collapsed row.

Normal tool rows do not show a status icon. Successful calls keep the neutral
legacy text treatment; failed, timed-out, and unknown-outcome headers use the
error text color plus an accessible failure label. Typed tool payloads reach
Request/Response only through explicit backend `display_input` and
`display_output` fields; the frontend never falls back to raw request/result
data.

- The group key is anchored to its first call so an open accordion stays open
  when later calls join the same live burst.

When the event-native read path is disabled, `TaskWorkLogAccordion.tsx` applies
the same consecutive-call rule to action rows through
`groupConsecutiveToolItems`. Its optional inner accordion uses the same
`Toolkit · method · count events` summary. Every expanded child retains the
original `Toolkit · method` name. Preparation/registration rows are
intentionally excluded because that synthetic block can contain calls from
multiple agents. Remove this legacy implementation together with
`TaskWorkLogAccordion.tsx` at final cutover.

## Main layout measurements

| Relationship                                |                                                            Value |
| ------------------------------------------- | ---------------------------------------------------------------: |
| ChatBox shell                               |                      Full width and height; vertical flex layout |
| Scroll viewport                             |                               Remaining height; 8px left padding |
| Timeline column                             |          Normal/Summarised: 600px centered; Detailed: full width |
| BottomBox overlay column                    | Full width; 600px maximum; 8px horizontal and 4px bottom padding |
| Minimum space below timeline                |                                                            128px |
| Dynamic space below timeline                |                                  BottomBox measured height + 8px |
| Event-native row spacing                    |                                                             12px |
| Second and later query/header gap           |                                                             44px |
| Follow-up query scroll transition           |                                 800ms Framer Motion eased scroll |
| Legacy query-group spacing                  |                                                             12px |
| Legacy content spacing inside a query group |                                                             12px |
| Separate legacy task/run sections           |                                               32px bottom margin |
| Folded plan preview                         |                                                     200px height |
| Expanded plan separation from BottomBox     |                                                              8px |
| Footer compact threshold                    |                                                            460px |
| Composer input height                       |                                      40px minimum; 200px maximum |
| Legacy user-message left indentation        |                                                             64px |
| Floating legacy controls bottom boundary    |                                                            128px |

The timeline bottom padding is calculated as:

```text
maximum(128px, measured BottomBox height + 8px)
```

This keeps the final timeline item visible above queued messages, banners,
headers, and other BottomBox states whose height changes at runtime.

## Numeric spacing convention

ChatBox spacing utilities must use numeric Tailwind values. Do not introduce
named spacing utilities such as `p-sm`, `px-sm`, `gap-xs`, or `py-px`.

| Utility value | Rendered size |
| ------------: | ------------: |
|           `0` |           0px |
|         `0.5` |           2px |
|           `1` |           4px |
|         `1.5` |           6px |
|           `2` |           8px |
|         `2.5` |          10px |
|           `3` |          12px |
|           `4` |          16px |
|           `5` |          20px |
|           `6` |          24px |
|           `8` |          32px |
|          `10` |          40px |
|          `16` |          64px |
|          `32` |         128px |

Use an explicit arbitrary numeric value when Tailwind has no matching scale
entry, for example `py-[1px]`.

### Timeline rhythm

Both timeline paths currently use a real 12px sibling rhythm:

- Event-native: `EventTimeline` uses `gap-3` between list items.
- Legacy: `ProjectSection` uses `space-y-3` between query groups.
- Legacy: `UserQueryGroup` uses `gap-3` between its direct content blocks.

Do not add a gap to a wrapper that contains only one child. It has no visual
effect and obscures which parent owns the relationship between components.

## Radius by elevation

Corner radius encodes how far a surface sits from the conversation, so sibling
surfaces intentionally differ:

| Radius        | Elevation                        | Examples                          |
| ------------- | -------------------------------- | --------------------------------- |
| `rounded-3xl` | Composer shell, floats over chat | `BottomBox`, control variants     |
| `rounded-2xl` | Timeline card, sits in the flow  | `HumanInteractionCard`, banners   |
| `rounded-xl`  | Nested block inside a card       | Argument detail, scope disclosure |
| `rounded-lg`  | Inline row inside a block        | Receipts, option lists, skeletons |

Match the surface's elevation rather than the radius of whatever is next to it.

## Staged migration surfaces

Parts of the event-native path are deliberately built ahead of their callers.
They are not dead code, but nothing exercises them yet:

- `EventTimeline/presentationPolicy.ts` is driven by the `detailLevel` prop.
  `EventNativeProjectTimeline` has no caller that passes it, so `'detailed'` is
  always in force until a detail-level control is wired up.
- `VITE_CHATBOX_EVENT_BUS` gates the ChatBox event-native renderer and control
  path and is unset in every checked-in env file, so the legacy conversation
  renderer ships by default. It does **not** gate the Session-level Project
  event runtime or the new SidePanel.

### Project runtime cutover

`ProjectEventRuntimeProvider` is mounted by the Session shell whenever a
Project is active. The SidePanel uses that durable snapshot as its Run and
activity source even while ChatBox still renders its legacy path. This runtime
ownership is therefore an intentional default cutover, not a staged surface
behind `VITE_CHATBOX_EVENT_BUS`.

An HTTP 404 from Project replay is treated as an unsupported backend
capability and stops automatic retry for that Project-store incarnation;
manual retry remains available. Network and 5xx failures keep the bounded
exponential retry path. The Files lane still watches the scoped legacy
ChatStore task to know when resolver metadata may have changed, but Project
filesystem results may only enrich durable artifact rows and never create Run
ownership.

Remove an entry here as soon as its caller lands.

## Legacy cleanup inventory

The following files belong to the legacy ChatStore conversation renderer. They
can be removed after the event-native path is permanent and no fallback is
required:

```text
ProjectChatContainer.tsx
ProjectSection.tsx
UserQueryGroup.tsx
InterruptedRunBanner.tsx

MessageItem/
├── AgentMessageCard.tsx
├── FloatingAction.tsx
├── HumanInteractionCard.tsx
├── NoticeCard.tsx
├── PreparingToExecuteTasks.tsx
├── TaskWorkLogAccordion.tsx
└── UserMessageCard.tsx
```

The following appear unused by production code and should be verified before
deletion:

```text
MessageItem/FeedbackCard.tsx
MessageItem/SummaryMarkDown.tsx
MessageItem/TaskCompletionCard.tsx
TaskBox/TaskType.tsx
```

### Move or replace before deleting

These components still have consumers outside the legacy ChatBox renderer:

| Component                                | External dependency/action                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `TaskBox/TaskCard.tsx`                   | Used by `Session/Workforce/FoldedPanel`; move to Workforce or replace              |
| `TaskBox/TaskItem.tsx`                   | Child of `TaskCard`; move with it                                                  |
| `TaskBox/PlanTaskBox/`                   | Used by `Session/Workforce/FoldedPanel`; move or replace with event-native plan UI |
| `MessageItem/MarkDown.tsx`               | Used by `Folder`; move to a shared content component location                      |
| `MessageItem/TokenUtils.tsx`             | Used by Session, HistorySidebar, and Dashboard; move to shared utilities           |
| `MessageItem/UserMessageRichContent.tsx` | Used by PlanTaskBox; move with its remaining owner or make shared                  |

### Final cutover changes

After the dependencies above are resolved:

1. Remove the `ProjectChatContainer` branch from `ChatBox/index.tsx`.
2. Remove the legacy interruption-banner branches.
3. Remove `PLAN_OVERLAY_SLOT_ID` and the legacy plan overlay portal.
4. Make `EventNativeProjectTimeline` the only conversation renderer.
5. Remove the legacy/event-native conditional state and handlers from
   `ChatBox/index.tsx`.
6. Retire `VITE_CHATBOX_EVENT_BUS` after event-native rendering is the default.
7. Remove legacy projection normalization only after the event store no longer
   relies on legacy `/chat` frames as an ingestion source.
8. Delete or update the corresponding legacy tests.

Do not remove the legacy event bridge merely because the legacy visual
components are gone. The visible event-native timeline currently enables that
bridge so legacy transport frames can still be normalized into the event store.

## Extending ChatBox

- Add a new semantic timeline node renderer in `EventTimeline/` and register it
  in `rendererRegistry.ts`.
- Add display-density or visibility rules in `presentationPolicy.ts`.
- Add a new human-control state to `BottomBox/types.ts`, route it through
  `ControlInputRouter`, and derive it in `useEventNativeHumanControl.ts`.
- Keep transport and store logic outside presentation renderers.
- Preserve the mode-aware timeline width (600px for Normal/Summarised, full
  width for Detailed), the centered 600px composer, and 12px timeline rhythm.
