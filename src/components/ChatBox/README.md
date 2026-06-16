# ChatBox component structure

This document describes the ChatBox layout, how the main pieces connect, and where to change behavior. Paths are relative to `src/components/ChatBox/`.

## Overview

ChatBox is the main chat surface: it wires **project + chat store** data to **message threads**, **task / workforce UI**, and the **BottomBox** composer. It supports multi-turn flows, task planning, splitting, and execution with scroll and timeline affordances.

## Architecture (folders)

```text
ChatBox/
├── index.tsx                 # Main shell: layout, chat timeline, send/stop, BottomBox
├── ChatTimeline.tsx         # Per-project task/chat rail or popover (narrow layout)
├── ProjectChatContainer.tsx  # Scroll region + all chat stores for the active project
├── ProjectSection.tsx        # One chat store: query groups, FloatingAction
├── UserQueryGroup.tsx        # One user query → messages, task UI, agent results
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
│   ├── FloatingAction.tsx        # Pause / skip (used from ProjectSection)
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

- Composes `ProjectChatContainer`, `BottomBox`, and (when used) `ChatTimeline`.
- Connects to `useChatStoreAdapter`, `projectStore`, navigation, and session chrome (e.g. scroll padding, task time display, pause/resume).
- Owns high-level task operations (send, stop, share, history hooks) and passes props into children.

### `ProjectChatContainer.tsx`

- Renders the stack of per–chat-id sections for the active project.
- Owns scroll behavior and “stick to bottom” / padding for the last message and BottomBox.

### `ProjectSection.tsx`

- One **vanilla `chatStore`** instance: subscribes to it and maps **messages** into **query groups** (see `UserQueryGroup`).
- Hosts `FloatingAction` (pause, skip) for the active task.

### `UserQueryGroup.tsx`

- A **single user turn**: user content, then downstream UI driven by `AgentStep` / `ChatTaskStatus` (e.g. splitting, task card, agent completion, notices).
- Imports from `TaskBox/` and `MessageItem/`; this is the main place new message *shapes* are routed.

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
- **`FloatingAction`**: Compact floating controls (wired from `ProjectSection`).
- **`TokenUtils`**: Animated token number and `formatSplittingElapsed` helpers.

## BottomBox (`BottomBox/`)

- **`index.tsx`**: Wires `BoxHeader`, `InputBox` / `RichChatInput`, `BoxAction`, `QueuedBox` to task state (pending, running, confirm, etc.).
- **`InputBox` / `RichChatInput` / `ChatInputModelDropdown`**: Text input, model picker, rich input where applicable.
- **`BoxAction`**: Confirm, edit, send, stop, and related actions.
- **`BoxHeader`**: Task summary, timing, and header affordances.
- **`QueuedBox`**: Queued user messages when the task pipeline is busy.

## Data flow (short)

1. **User input** → `BottomBox` → `index.tsx` / store → API or store updates.
1. **SSE / store updates** → `ProjectChatContainer` → `ProjectSection` → `UserQueryGroup` → `MessageItem` / `TaskBox` by step and status.
1. **State** → **`chatStore`** (per chat), **`projectStore`** (project + which chat is active), plus local component state (expand, scroll, active query).

## Extending the UI

- **New agent or system message type**: branch in `UserQueryGroup.tsx` (and possibly `ProjectSection` if grouping changes).
- **New task UI**: add under `TaskBox/` and mount from `UserQueryGroup` or `TaskCard` as needed.
- **New bubble content**: add a card under `MessageItem/` and import it from `UserQueryGroup` (or the parent that owns that message list).

This layout keeps **transport and layout** (`index`, `Project*`) separate from **message rendering** (`MessageItem/`) and **task planning/execution** (`TaskBox/`), and **composer** behavior (`BottomBox/`).
