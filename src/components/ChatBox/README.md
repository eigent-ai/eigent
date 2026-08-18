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
│   └── timeline column (width: 100%; maximum width: 600px)
│       ├── event-native path
│       │   └── EventNativeProjectTimeline
│       │       └── EventTimeline
│       │           └── EventRenderer
│       │               └── semantic event renderer
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
            ├── thinking effort
            └── model selector
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
    ├── ThinkingEffortSelect.tsx
    └── ModelSelect.tsx
```

### Event-native data flow

1. Durable project/run events hydrate the project event store.
2. The chat projector converts transport events into semantic
   `ChatProjectionNode` values.
3. `EventNativeProjectTimeline` selects renderable nodes and bounds the mounted
   history window.
4. `EventTimeline` applies presentation policy and creates a 12px-spaced list.
5. `EventRenderer` selects a renderer by semantic node kind or exact event type.
6. `BottomBox` renders the event-derived human control or the standard input.

The default semantic renderer kinds are message, notice, interaction, plan,
activity, artifact, run status, and unknown.

### Repeated tool-call presentation

`EventTimeline/activityGrouping.ts` converts consecutive identical tool
activity nodes into logical calls before rendering. It pairs lifecycle frames
with a backend `toolCallId` when available and uses FIFO pairing for older
events without correlation. The source projection remains immutable.

Calls are grouped only when the run, agent, toolkit, and method match without
another timeline node between them. A message, interaction, different tool,
agent change, or Run change ends the group so chronological relationships are
never reordered.

- One logical call renders as the normal activity row.
- Two or more calls render through `RepeatedToolCallGroup.tsx` as
  `Toolkit · method · count events`.
- The repeated group is collapsed by default and expands to show each call's
  individual status and safe display detail.
- Aggregate running, completed, cancelled, and failed states appear on the
  collapsed row.
- The group key is anchored to its first call so an open accordion stays open
  when later calls join the same live burst.

While the legacy fallback is still enabled, `TaskWorkLogAccordion.tsx` applies
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
| Timeline column                             |                 Full width; 600px maximum; horizontally centered |
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
- Preserve the shared 600px timeline/composer alignment and 12px timeline
  rhythm unless the overall layout specification changes.
