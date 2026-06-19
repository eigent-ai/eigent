# ChatBox component structure

This document describes the ChatBox layout, how the main pieces connect, and where to change behavior. Paths are relative to `src/components/ChatBox/`.

## Overview

ChatBox is the main chat surface: it wires **project + chat store** data to **message threads**, **task / workforce UI**, and the **BottomBox** composer. It supports multi-turn flows, task planning, splitting, and execution with scroll and timeline affordances.

## Architecture (folders)

```text
ChatBox/
├── index.tsx                 # Main shell: layout, chat timeline, send/stop, BottomBox
├── ChatTimeline.tsx         # Per-project task/chat rail or popover (narrow layout)
│
├── channel/                  # Session-channel renderer (one ordered channel per project)
│   ├── SessionChannel.tsx    # Flat, turn-grouped render + scroll/turn-observer + FloatingAction
│   ├── ChannelItemRenderer.tsx  # registry[item.kind] lookup
│   ├── rendererRegistry.ts   # ChannelItemKind → renderer
│   ├── context.ts            # Render context (resolveTurn → live chatStore bridge)
│   ├── submitHumanReply.ts   # Shared HITL reply (existing /human-reply shape)
│   ├── useSessionChannelShadow.ts  # Derives the channel from live per-turn tasks
│   └── renderers/            # One component per ChannelItemKind (wraps existing cards)
│
├── TaskBox/                 # Plan / run task UI
│   ├── TaskCard.tsx         # Plan list, progress, filter, expand (workforce subtasks)
│   ├── TaskItem.tsx         # Editable line in the plan
│   ├── TaskType.tsx         # Task type indicator
│   ├── TypeCardSkeleton.tsx  # Loading skeleton while the plan is forming
│   └── StreamingTaskList.tsx
│
├── MessageItem/             # All message- and log-specific UI
│   ├── UserMessageCard.tsx
│   ├── UserMessageRichContent.tsx
│   ├── AgentMessageCard.tsx
│   ├── NoticeCard.tsx
│   ├── FeedbackCard.tsx
│   ├── TaskCompletionCard.tsx
│   ├── SplittingProgressRow.tsx   # “Splitting tasks” + token tick during decompose
│   ├── TaskWorkLogAccordion.tsx  # Work log: tool / agent lines (workforce)
│   ├── FloatingAction.tsx        # Pause / skip (rendered by SessionChannel)
│   ├── MarkDown.tsx
│   ├── SummaryMarkDown.tsx
│   └── TokenUtils.tsx            # Token animation + splitting elapsed formatting
│
└── BottomBox/                # Composer and chrome above input
    ├── index.tsx
    ├── InputBox.tsx
    ├── RichChatInput.tsx
    ├── ChatInputModelDropdown.tsx
    ├── BoxAction.tsx
    ├── BoxHeader.tsx
    └── QueuedBox.tsx
```

## Core responsibilities

### `index.tsx`

- Composes `channel/SessionChannel`, `BottomBox`, and (when used) `ChatTimeline`.
- Connects to `useChatStoreAdapter`, `projectStore`, navigation, and session chrome (e.g. scroll padding, task time display, pause/resume).
- Owns high-level task operations (send, stop, share, history hooks) and passes props into children.

### `channel/` (session-channel renderer)

The project's whole conversation is **one ordered, typed channel** (`ChannelItem[]`,
`src/types/sessionChannel.ts`), keyed by `projectId`. Items are grouped into turns by `turnId`
(`items.filter(i => i.turnId === t)`), replacing the old per-turn `chatStore` + render-time
`groupMessagesByQuery` heuristic.

- **`SessionChannel.tsx`**: renders `turnOrder.map(turn → items.map(<ChannelItemRenderer/>))`,
  owns the turn IntersectionObserver (drives side-panel `TurnTabs`), scroll-to-turn,
  auto-scroll-to-bottom, and the `FloatingAction` (pause/skip) for the running turn.
- **`useSessionChannelShadow.ts`**: derives the channel by folding the live per-turn `chatStore`
  tasks (`buildProjectChannel`) — the chatStore SSE handler is still the source of truth; the
  channel is a typed projection of it.
- **`ChannelItemRenderer` + `rendererRegistry`**: look up the renderer by `item.kind` — no switch.
- **`renderers/`**: one component per kind, wrapping the existing `MessageItem/` & `TaskBox/` cards.
- **`submitHumanReply.ts`** + `renderers/AskRenderer.tsx`: HITL replies + 30s auto-skip.

## TaskBox (`TaskBox/`)

- **`TaskCard`**: Task type 1/2/3 flows—plan text, `taskRunning` rows, filter tabs, link to the chat that owns a subtask, expand/collapse with session-backed preference.
- **`TaskItem`**: Single plan line edit/delete.
- **`TypeCardSkeleton`**: Shown while the model is decomposing before `to_sub_tasks` is ready.
- **`StreamingTaskList`**: Renders running subtasks during streaming / updates.

## MessageItem (`MessageItem/`)

- **`UserMessageCard` / `UserMessageRichContent`**: User bubble + rich blocks.
- **`AgentMessageCard`**: Assistant markdown, optional typewriter, attachments.
- **`SplittingProgressRow`**: Shown while the task is in the splitting phase; uses store `taskTime` / `elapsed` when present, with a per-session wall-clock fallback when not.
- **`TaskWorkLogAccordion`**: Collapsible work log for running/finished/paused task (tool activate/deactivate, agent lines); Framer `height: auto` for expand, stable segment keys from the merged log.
- **`TaskCompletionCard`**: Completion / summary style card when appropriate.
- **`NoticeCard`**: Chain-of-thought or notice-style content.
- **`FeedbackCard`**: Thumbs / feedback when enabled.
- **`FloatingAction`**: Compact floating controls (rendered by `channel/SessionChannel`).
- **`TokenUtils`**: Animated token number and `formatSplittingElapsed` helpers.

## BottomBox (`BottomBox/`)

- **`index.tsx`**: Wires `BoxHeader`, `InputBox` / `RichChatInput`, `BoxAction`, `QueuedBox` to task state (pending, running, confirm, etc.).
- **`InputBox` / `RichChatInput` / `ChatInputModelDropdown`**: Text input, model picker, rich input where applicable.
- **`BoxAction`**: Confirm, edit, send, stop, and related actions.
- **`BoxHeader`**: Task summary, timing, and header affordances.
- **`QueuedBox`**: Queued user messages when the task pipeline is busy.

## Data flow (short)

1. **User input** → `BottomBox` → `index.tsx` / store → API or store updates.
1. **SSE / store updates** → `chatStore` accumulates per-turn `Task` state → `useSessionChannelShadow` folds it into `ChannelItem[]` → `SessionChannel` → `ChannelItemRenderer` → `MessageItem` / `TaskBox` by `item.kind`.
1. **State** → **`chatStore`** (per chat, source of truth), **`sessionChannelStore`** (derived channel per project), **`projectStore`** (project + which chat is active), plus local component state (expand, scroll).

## Extending the UI

- **New channel item kind**: add the type to `src/types/sessionChannel.ts`, emit it from `buildProjectChannel` (`store/sessionChannelReducer.ts`), add a renderer under `channel/renderers/`, and register it in `channel/rendererRegistry.ts`.
- **New task UI**: add under `TaskBox/` and mount from the relevant renderer or `TaskCard`.
- **New bubble content**: add a card under `MessageItem/` and use it from a `channel/renderers/` component.

This layout keeps **transport** (`index`, `chatStore`) separate from the **typed channel projection** (`channel/`, `store/sessionChannel*`), **message rendering** (`MessageItem/`), **task planning/execution** (`TaskBox/`), and **composer** behavior (`BottomBox/`).
