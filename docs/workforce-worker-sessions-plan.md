# Workforce worker Sessions plan

> **Status: first version built.** Each Workforce worker shows as its own row
> nested under its Session in the sidebar. Opening a worker row shows that
> worker's timeline. §10 lists what is not built yet.

## 1. Goal

When a Session runs in Workforce mode, several workers do the work in
parallel, but the sidebar shows one row and the chat shows the coordinator's
view. To follow one worker today, people open the side panel and read that
worker's task log.

We want the sidebar to work like a coding agent that lists its sub-sessions
under the parent:

```text
▾ Launch the pricing page             3 ▾
  │ Research competitor pricing         ●
  │ Draft the page copy                 ●
  └ Build the page                      ●
```

1. A Workforce Session row can be expanded to show one child row per worker.
2. Each child row shows the worker's current task (or its name) and its status
   (running, waiting for a reply or approval, done, failed).
3. Opening a child row shows that worker's **timeline**: the tasks it was
   given, its messages, tool calls, approvals, outputs and changed files, in
   order, across every Run of the Session.
4. The parent row still opens the Session as today.

## 2. Terms

UI copy follows `docs/product-terminology.md`. Backend identifiers stay
unchanged (`projectId`, `project_id`, `agent_id`).

| Term            | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| Session         | The parent row. One Project                                      |
| Worker          | One Workforce agent in that Session, identified by its name      |
| Worker row      | The nested sidebar row for one worker                            |
| Worker timeline | The event-native timeline of the Session, filtered to one worker |

## 3. What exists today

- **Most events name the worker, but not all the same way.**
  - Agent turn events (`agent.started`, `agent.completed`, …) and assignment
    events (`subtask.*` with `assignee_id`) carry the worker's `agent_id`
    (`backend/app/run_journal/semantic_events.py`).
  - Tool call events (`tool.*`, written by the tool checkpoint in
    `run_journal/store.py`) carry **only** the worker's name (`agent_name`) and
    the task it was processing (`process_task_id`), not its `agent_id`.
  - Approvals and questions (`approval.requested`, `interaction.requested`)
    carry the `step_id` they block, not a worker. Their answers carry only the
    request id.
- **An `agent_id` is a process instance.** It changes on every Run. The side
  panel already keys agents by name for this reason
  (`Session/SidePanel/sections/buildProjectSessionPanelData.ts`).
- **Events can be read per Run.** `GET /runs/{run_id}/events` and
  `GET /runs/{run_id}/stream` replay a Run's events in order.
- **The renderer has every Run of the open Session.** The event-native
  timeline (the default) reads `ProjectEventStore` snapshots whose
  `chat.nodes` span all Runs. Nodes carry `agentId`/`agentName`, `taskId` and
  `stepId` where the event had them (`src/lib/projector/chat/types.ts`).
- **Sessions open through a store, not a URL.** `openSessionInShell`
  (`src/lib/sessionOpen.ts`) sets the active Project and workspace tab. There
  is no Session route or `?projectId` parameter, except for Session windows.
- **Sidebar rows are flat.** `SpaceSidebar/SessionNavListRows.tsx`
  `SessionNavItem` had no children, but already had a `nested` row style
  (used by Home's Space groups).

## 4. Options

| Option                 | What a worker row is                                                                          | Result                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Worker views**    | **A view over the parent Session's Runs, filtered to one worker. No new records.**            | **Built.** Uses events that are already stored and synced. Nothing new to sync, migrate or delete. Replies still go to the Session                     |
| B. Real child Sessions | A child Project with `parent_project_id`; the worker runs as its own Run with its own history | People could message one worker directly. Needs Workforce execution, Run ownership, sync, Remote Control and history changes. Decide after A is in use |
| C. Side panel only     | Keep workers in the side panel and make its task log a full timeline                          | Smallest change, but does not give the sidebar nesting that was asked for                                                                              |

Option B can reuse the same sidebar rows and timeline view later; only the
data source changes.

## 5. Behaviour

1. **Which Sessions nest.** A Session nests when its mode is Workforce. For
   older Sessions with no recorded mode, it nests when more than one agent
   took part. Single-agent Sessions do not nest.
2. **Expand and collapse.** Collapsed by default. The disclosure button on the
   parent row shows the number of workers. Right and Left on the parent row
   expand and collapse it. The choice is kept per Session on the device
   (`localStorage`, `eigent-session-worker-rows-expanded`). While a worker is
   waiting for a reply or approval, the rows are always expanded.
3. **Order.** Workers in the order they were first given work. Workers that
   did nothing in the latest Run sort after the ones that did.
4. **Row content.** The worker's current task, falling back to the worker
   name, and a status dot (running, waiting, done, failed, idle).
5. **Worker timeline.** Opens in the main pane in place of the Session
   timeline, under a header with the worker's name, current task and a Back
   button. It reuses the event-native timeline with a `workerKey` filter. Each
   Run is a section that starts with the user message that started it. The
   composer is replaced by a line that links back to the Session to reply.
   Approvals are answered with the Session's existing decision card.
6. **Identity across Runs.** A worker is its normalized name (trimmed,
   whitespace collapsed, lowercase). Agent ids are only used to link nodes
   that carry an id but no name. This resolves the first open question: the
   `agent_id` cannot be the identity because it changes every Run.
7. **Which events belong to a worker.** In order of preference:
   1. events that name the worker (name or `agent_id`, including
      `assignee_id`);
   2. events whose task id is one of the worker's tasks (task hand-offs and
      results, tool calls);
   3. approvals and questions whose step or tool call is one of the worker's,
      and the answers to those requests.

   Coordinator events (plans, Run status) are not part of a worker timeline.

8. **Opening.** Clicking a worker row opens its Session and then the worker
   timeline. Clicking the Session row closes the worker timeline. The open
   worker is kept per Session in memory (`useSessionWorkerViewStore`), not in
   a URL, because Sessions have no route.
9. **Legacy renderer.** Builds with the legacy ChatBox do not show worker
   timelines.

## 6. What was built

**Brain** (`backend/app/run_journal/worker_view.py`,
`backend/app/controller/run_controller.py`)

- `GET /runs/{run_id}/agents`: workers of a Run with `agent_id`, name,
  status (`idle`, `running`, `waiting`, `completed`, `failed`, `cancelled`),
  current task, first and last event sequence and time, and counts (events,
  tasks, tool calls, pending requests). `agent_ref` is not returned: it is not
  in Run events.
- `GET /runs/{run_id}/events?actor_id=<agent_id>`: the existing endpoint with
  an optional worker filter using the rules in §5.7. The whole Run is read
  to attribute events (task and step ids are learned from earlier events),
  then the filtered list is paged with the same `after_sequence`/`limit`
  cursor.
- Tests: `backend/tests/app/run_journal/test_worker_view.py`.

**Renderer**

- `src/lib/projector/chat/workerView.ts`: `selectSessionWorkers` and
  `filterChatNodesForWorker` over projected chat nodes.
- `src/hooks/useSessionWorkers.ts`: live workers per Session, from the
  Sessions whose `ProjectEventStore` is loaded in this window.
- `src/store/sessionWorkerViewStore.ts`: the open worker per Session and the
  expand choice.
- `EventNativeProjectTimeline` takes `workerKey`; `ChatBox` renders the worker
  header (`WorkerTimelineBar.tsx`) and swaps the composer for the reply line.
- `SessionNavItem.childRows` renders a disclosure button and nested rows with
  the existing `nested` row style; `SpaceSidebar/sessionWorkerRows.ts` builds
  them.
- Tests: `test/unit/lib/projector/workerView.test.ts`,
  `test/unit/components/SessionNavWorkerRows.test.tsx` and a worker-filter
  case in `EventNativeProjectTimeline.test.tsx`.

## 7. Open questions

1. ~~Same-name identity across Runs?~~ Decided by the code: `agent_id`
   changes every Run, so the name is the identity (§5.6).
2. Should finished Sessions keep their worker rows? Built: yes, while the
   Session's timeline is loaded, so the history stays readable.
3. How does this fit the longer-term choice between Workforce and single-agent
   with sub-agents? The rows are built on "agents of this Session", not on
   Workforce internals, so single-agent sub-agents can use them later.
4. Two workers with the same name in one Run share one row. The Brain filter
   does not guess an owner for name-only tool calls in that case.

## 8. Pull requests

This PR holds the first version (§6). Later pull requests:

1. Renderer: worker rows for Sessions that are not loaded (use
   `/runs/{run_id}/agents`).
2. Renderer: entry points from the side panel worker card and the worker
   label in the Session timeline.
3. Remote Control: the same nesting (separate repository).

## 9. Testing

- Brain unit tests: agents summary for a Workforce Run with 3 workers; the
  waiting status clears when the approval is answered; the `actor_id` filter
  returns that worker's events plus its task hand-offs, tool calls and
  approvals that carry no `agent_id`; unknown `actor_id` returns an empty
  list; a single-agent Run returns one agent; two workers with the same name
  do not take each other's tool calls; the endpoint pages a filtered list.
- Renderer unit tests: worker selector (name identity across Runs, order,
  waiting status), worker filter (task-linked tools, approvals, Run start
  messages), sidebar rows (count, expand/collapse by click and keyboard,
  auto-expand on waiting, mode gating), timeline `workerKey` filter.
- Manual, desktop app:
  1. Start a Workforce Session with 3 workers. The row shows 3 and expands into
     3 worker rows with live status.
  2. Open each worker; its timeline matches its side panel task log.
  3. A worker asks for approval: the Session auto-expands; approve from the
     worker timeline's decision card.
  4. Send a follow-up; the same worker rows gain a second Run section.
  5. Reload the app and restart the Brain; rows and timelines come back after
     the Session is opened.
- `npm run type-check`, `npm run lint`, focused backend tests,
  `git diff --check`.

## 10. Not built yet

- Worker rows for Sessions that have not been opened in this window. The
  sidebar only knows the workers of Sessions whose timeline is loaded.
- A "new activity since last opened" dot on worker rows.
- Up/Down keyboard movement between sidebar rows (the sidebar has none today).
- Opening a worker from the side panel worker card or from a worker label in
  the Session timeline.
- Worker timelines in a Session open in its own window or in a split pane:
  the worker row opens the worker in the main window only.
- An approval card scoped to the open worker: the decision card shows the
  Session's pending request, which may belong to another worker.
- The renderer does not call the new Brain endpoints yet; it builds the same
  view from the events it already has.
