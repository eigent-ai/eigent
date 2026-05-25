# ChatBox component structure

ChatBox is the **session UI** — the per-session chat surface mounted from
[`src/components/Session/index.tsx`](../Session/index.tsx). One ChatBox =
one session = one or more tasks rendered in vertical query groups.

Product hierarchy:

```
Project page   (src/pages/Projects/Project.tsx)
  └─ Session   (src/components/Session/index.tsx)
       └─ ChatBox       (this folder)
            └─ Tasks    (one per user-query turn, grouped into "query groups")
```

## Folder layout

```
ChatBox/
├── README.md                          # this file
├── index.tsx                          # main shell: layout, send/stop, BottomBox wiring
│
├── shell/                             # session / scroll wrapping
│   ├── SessionStackContainer.tsx     # iterates every chat store for the active project, stacks Sessions
│   ├── SessionView.tsx                # one chat store → render query groups
│   └── QueryGroup.tsx                 # one user-query turn (user msg + agent output + work log)
│
├── renderSession/                     # pure data normalization (no React rendering)
│   ├── types.ts                      # ChatBlock, HitlInputBlock, ReplyBlock, ChatTurn, ChatQueryGroup
│   ├── normalizeMessages.ts          # Message[] → ChatTurn[], plus detectInputType / legacyAskPayload
│   └── queryGroups.ts                # Message[] + renderGroups → ChatQueryGroup[] (cursor-based slicing)
│
├── BottomBox/                         # composer (user input side)
│   ├── index.tsx
│   ├── InputBox.tsx                  # free-typing composer
│   ├── RichChatInput.tsx
│   ├── ChatInputModelDropdown.tsx
│   ├── BoxHeader.tsx                 # task summary / timing chrome above the input
│   ├── BoxHeaderAsk.tsx              # composer for an active ASK turn (renders hitlInputs/)
│   ├── BoxAction.tsx                 # send / confirm / stop buttons
│   ├── QueuedBox.tsx
│   ├── UsageLimitBanner.tsx
│   └── hitlInputs/                    # 8 active-ASK input controls
│       ├── index.ts
│       ├── TextInputBlock.tsx
│       ├── ChoiceInputBlock.tsx
│       ├── KeyValueInputBlock.tsx
│       ├── ModelPickerBlock.tsx
│       ├── McpConfigBlock.tsx
│       ├── SkillUploadBlock.tsx
│       ├── FileUploadBlock.tsx
│       └── RedirectBlock.tsx
│
├── messages/                          # per-message rendering (was MessageItem/)
│   ├── UserMessageCard.tsx
│   ├── UserMessageRichContent.tsx
│   ├── AgentMessageCard.tsx           # markdown + reply-block dispatch + copy/👍/👎 row
│   ├── MarkDown.tsx                  # shared markdown renderer
│   ├── SummaryMarkDown.tsx
│   ├── askBlocks/                     # view-only ASK display (in-chat)
│   │   └── QuestionBlock.tsx
│   └── replyBlocks/                   # rendered END reply blocks
│       ├── index.ts                  # renderReplyBlock(block, opts) registry
│       ├── MarkdownReplyBlock.tsx
│       ├── TableReplyBlock.tsx
│       ├── ChartReplyBlock.tsx
│       ├── DashboardReplyBlock.tsx
│       ├── FilesReplyBlock.tsx
│       └── TriggerSuggestionBlock.tsx
│
├── taskLog/                           # task execution UI
│   ├── TaskWorkLogAccordion.tsx      # live + frozen work log (1070 LOC)
│   ├── PreparingToExecuteTasks.tsx
│   ├── TokenUtils.tsx                # token animation, formatSplittingElapsed
│   └── FloatingAction.tsx            # pause / skip controls
│
├── notices/                           # in-chat status / feedback cards
│   ├── NoticeCard.tsx                # chain-of-thought / system notices
│   └── FeedbackCard.tsx              # 👍 / 👎 / copy
│
└── TaskBox/                           # plan & subtask UI (workforce)
    ├── TaskCard.tsx                  # plan list + progress + filter + expand
    ├── TaskItem.tsx                  # single subtask line (edit/delete)
    ├── TaskType.tsx                  # type indicator
    └── PlanTaskBox/
        ├── index.tsx
        ├── ExpandedOverlay.tsx
        ├── FoldedView.tsx
        ├── StatusRow.tsx
        ├── SubtaskEditor.tsx
        └── utils.ts
```

### Concern boundaries

| Folder | Owns | Does NOT own |
|---|---|---|
| `shell/` | Stacking, scroll, query-group lifecycle | Per-message rendering, composer |
| `renderSession/` | Pure data: messages → groups → blocks | Any React rendering |
| `BottomBox/` | User input composer + **active** ASK controls | Rendered ASK display in chat |
| `messages/` | One message's visual card + ASK/REPLY block registries | Work-log, status, controls |
| `taskLog/` | Live work-log accordion, preparing status, pause/skip | Per-message bubbles |
| `notices/` | Non-message interrupt cards (cot, feedback) | Anything per-task |
| `TaskBox/` | Plan list + subtask editing | Live execution log |

## Data flow

```
Project page
  └─ Session
       └─ ChatBox (index.tsx)
            ├─→ BottomBox/                       (input + active ASK composer)
            │     └─ hitlInputs/                 (text, choice, key, model, mcp, skill, file, redirect)
            │
            └─→ shell/SessionStackContainer
                 └─ shell/SessionView            (one chat store)
                      └─ shell/QueryGroup        (one user-query turn)
                           ├─→ messages/UserMessageCard
                           ├─→ TaskBox/                       (plan + subtasks, workforce only)
                           ├─→ taskLog/TaskWorkLogAccordion  (live or frozen work log slice)
                           ├─→ notices/                       (cot, feedback)
                           ├─→ messages/askBlocks/QuestionBlock  (view-only ASK summary)
                           └─→ messages/AgentMessageCard
                                └─ messages/replyBlocks/     (markdown / table / chart / files / trigger)
```

### State

- **`projectStore`** — which project is active, list of sessions (chat stores) per project.
- **`chatStore`** (per session, vanilla Zustand) — tasks, messages, `renderGroups`
  (per-group cursor metadata), `activeAsk` queue, work-log cursors.

### Render normalization (`renderSession/`)

- `normalizeMessages.ts` — flat `Message[]` → `ChatTurn[]`. Also hosts
  `detectInputType`, `extractChoices`, and `legacyAskPayload` for converting
  unstructured ASK text into a structured `AskPayload` (used until the backend
  emits `askPayload` directly).
- `queryGroups.ts` — `Message[] + renderGroups` → `ChatQueryGroup[]`. The
  cursor-based slicing means each group has its own start/end work-log
  positions and its own elapsed snapshot.

## Where to add X

| Task | Add file in | Wire from |
|---|---|---|
| New ASK input control (e.g. date picker) | `BottomBox/hitlInputs/DateInputBlock.tsx` | Add `case 'date':` to `BoxHeaderAsk.tsx` switch + add to `HitlInputBlock` union in `renderSession/types.ts` |
| New reply block kind (e.g. video) | `messages/replyBlocks/VideoReplyBlock.tsx` | Add to `replyBlocks/index.ts` registry + add to `ReplyBlock` union in `renderSession/types.ts` |
| New in-chat status card | `notices/` | Branch in `shell/QueryGroup.tsx` step switch |
| New task-status UI | `taskLog/` | Wire from `shell/QueryGroup.tsx` `shouldShowWorkLog` branch |
| Backend protocol change for ASK | `renderSession/normalizeMessages.ts` (legacyAskPayload) + `renderSession/types.ts` (HitlInputBlock / AskPayload) | — |
| Backend protocol change for END | `renderSession/types.ts` (ReplyBlock / ReplyPayload) + new reply block file under `messages/replyBlocks/` | — |
| New page-level wiring | `src/components/Session/index.tsx` (don't touch ChatBox if avoidable) | — |
