# ChatBox component structure

Paths are relative to `src/components/ChatBox/`.

## Folder layout

```text
ChatBox/
├── index.tsx                 # Top-level shell: layout, scroll, BottomBox, send/stop
│
├── shell/                    # Rendering orchestrators (no pure-UI logic here)
│   ├── SessionStackContainer.tsx  # One section per task across all chatStores (dedup)
│   ├── SessionView.tsx            # One task: normalizes messages → query groups
│   └── QueryGroup.tsx             # One user turn: user bubble, task UI, agent output
│
├── renderSession/            # Pure data normalization (no React)
│   ├── types.ts              # ChatBlock, ChatTurn, AskPayload, HitlInputBlock, etc.
│   ├── normalizeMessages.ts  # detectInputType, extractChoices, legacyAskPayload,
│   │                         #   normalizeMessagesToChatTurns
│   └── queryGroups.ts        # normalizeTaskToQueryGroups → ChatQueryGroup[]
│
├── messages/                 # Message bubble components
│   ├── UserMessageCard.tsx
│   ├── UserMessageRichContent.tsx
│   ├── AgentMessageCard.tsx
│   ├── SummaryMarkDown.tsx
│   ├── MarkDown.tsx
│   ├── TaskCompletionCard.tsx
│   └── askBlocks/
│       └── QuestionBlock.tsx # View-only ASK card (reply controls are in BottomBox)
│
├── notices/                  # Non-message overlay cards
│   ├── NoticeCard.tsx
│   └── FeedbackCard.tsx
│
├── taskLog/                  # Task execution UI (work log, timers, action buttons)
│   ├── TaskWorkLogAccordion.tsx  # Per-turn cursor-sliced work log + frozen timer
│   ├── PreparingToExecuteTasks.tsx
│   ├── FloatingAction.tsx
│   └── TokenUtils.tsx
│
├── TaskBox/                  # Plan / subtask UI
│   ├── TaskCard.tsx
│   ├── PlanTaskBox/
│   └── ...
│
└── BottomBox/                # Composer and chrome above the input
    ├── index.tsx             # Routes to BoxHeaderAsk (state='ask') or normal input
    ├── BoxHeaderAsk.tsx      # Inline HITL composer with visible 30-second countdown
    ├── hitlInputs/
    │   ├── TextInputBlock.tsx
    │   ├── ChoiceInputBlock.tsx
    │   └── index.ts
    ├── BoxHeader.tsx
    ├── InputBox.tsx
    └── QueuedBox.tsx
```

## Data flow

```
User input
  └─▶ BottomBox / index.tsx / store → API / SSE

SSE events → chatStore (addMessages)
  └─▶ RenderGroupMeta[] (per-user-message cursor snapshot)
        └─▶ SessionStackContainer → SessionView
              └─▶ normalizeTaskToQueryGroups(task, taskId)
                    └─▶ ChatQueryGroup[]
                          └─▶ QueryGroup
                                ├─▶ UserMessageCard
                                ├─▶ TaskCard / PlanTaskBox
                                ├─▶ TaskWorkLogAccordion (cursor-sliced per group)
                                ├─▶ AgentMessageCard / QuestionBlock / NoticeCard …
                                └─▶ TaskCompletionCard
```

## Key concepts

### Per-turn work-log slicing

`chatStore.addMessages()` snapshots `WorkLogCursor` (per-agent log length) each time a
user message arrives. `normalizeTaskToQueryGroups` attaches `startCursor`/`endCursor` to
each `ChatQueryGroup.workLog`. `TaskWorkLogAccordion` slices `agent.log` to only show
entries produced while that group was active and freezes the elapsed timer once the
group is closed.

### Inline HITL

When `task.activeAsk` is set, `index.tsx` builds an `AskPayload` via
`legacyAskPayload()` (heuristic from question text) or the optional `message.askPayload`
(structured, when the backend eventually emits it). `getBottomBoxState()` returns `'ask'`
and both `BottomBox` instances render `BoxHeaderAsk` — a visible 30-second countdown ring
that auto-submits `"skip"` and accepts text or choice input. `QuestionBlock` in the chat
scroll shows the question as a view-only card.

### Multi-task scoping (#1655)

`SessionStackContainer` deduplicates tasks across all chatStores for the active project
and renders one `SessionView` per task. `SessionView` accepts `taskId?` (falls back to
`chatState.activeTaskId`). `QueryGroup` uses `queryGroup.taskId` — carried through the
normalized `ChatQueryGroup` — for all task-derived UI, so historic groups always show
their own task's state, not the newest task's.

## Deferred scope

Structured `askPayload` and `replyPayload` fields on `Message` exist in `types.ts` for
forward compatibility, but the backend does not yet emit them. Rich HITL input kinds
beyond `text` and `choice` (key_value, model, mcp, skill_upload, file_upload, redirect)
and structured reply blocks (table, chart) are intentionally not built until the backend
starts sending the corresponding payloads.
