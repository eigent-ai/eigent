# Workforce worker Sessions plan

> **Status: proposal.** This plan shows each Workforce worker as its own row
> nested under its Session in the sidebar, with its own full timeline. Nothing
> here is implemented yet.

## 1. Goal

When a Session runs in Workforce mode, several workers do the work in
parallel, but the sidebar shows one row and the chat shows the coordinator's
view. To follow one worker today, people open the side panel and read that
worker's task log.

We want the sidebar to work like a coding agent that lists its sub-sessions
under the parent:

```text
▾ Launch the pricing page             ● 4
  │ Research competitor pricing         ✓
  │ Draft the page copy                 ⟳
  │ Build the page                      !
  └ Check links and screenshots         !
```

1. A Workforce Session row can be expanded to show one child row per worker.
2. Each child row shows the worker's name or current task and its status
   (running, waiting for a reply or approval, done, failed).
3. Opening a child row shows that worker's **full timeline**: the tasks it was
   given, its messages, tool calls, approvals, outputs and changed files, in
   order, across every Run of the Session.
4. The parent row still opens the Session as today.

## 2. Terms

UI copy follows `docs/product-terminology.md`. Backend identifiers stay
unchanged (`projectId`, `project_id`, `agent_id`).

| Term            | Meaning                                                           |
| --------------- | ----------------------------------------------------------------- |
| Session         | The parent row. One Project                                       |
| Worker          | One Workforce agent in that Session, identified by its `agent_id` |
| Worker row      | The nested sidebar row for one worker                             |
| Worker timeline | The event-native timeline of the Session, filtered to one worker  |

## 3. What exists today

- **Events already name the worker.** Semantic Run events carry
  `actor_type`/`actor_id` and `agent_id`
  (`backend/app/run_journal/semantic_events.py`). Model calls are recorded per
  `agent_id` (`run_journal/models.py` `ModelInvocationRecord`), and each
  Workforce worker has its own Git worktree record (`GitAgentWorkspaceRecord`
  with `agent_id` and `agent_ref`).
- **Events can be read per Run.** `GET /runs/{run_id}/events` and
  `GET /runs/{run_id}/stream` replay a Run's events in order.
- **The timeline already groups by agent.** The event-native timeline is the
  default. `src/components/ChatBox/EventTimeline/activityGrouping.ts` groups
  activity by `agentId`/`agentName`, and
  `src/lib/projector/chat/presentation/subagentIdentity.ts` resolves sub-agent
  identity.
- **The side panel lists workers.** `Session/SidePanel/components/FoldedPanel/AgentDetailPane.tsx`
  shows one worker's tasks, terminal and files.
- **Sidebar rows are flat.** `SpaceSidebar/SessionNavListRows.tsx`
  `SessionNavItem` has no children.

## 4. Options

| Option                 | What a worker row is                                                                          | Result                                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. Worker views**    | **A view over the parent Session's Runs, filtered to one worker. No new records.**            | **Recommended first step.** Uses events that are already stored and synced. Nothing new to sync, migrate or delete. Replies still go to the Session    |
| B. Real child Sessions | A child Project with `parent_project_id`; the worker runs as its own Run with its own history | People could message one worker directly. Needs Workforce execution, Run ownership, sync, Remote Control and history changes. Decide after A is in use |
| C. Side panel only     | Keep workers in the side panel and make its task log a full timeline                          | Smallest change, but does not give the sidebar nesting that was asked for                                                                              |

The plan below is option A. Option B can reuse the same sidebar rows and
timeline view later; only the data source changes.

## 5. Behaviour

1. **Which Sessions nest.** A Session nests when at least one of its Runs ran
   in Workforce mode. Single-agent Sessions do not nest. The same rows can
   later show sub-agents of a single-agent Session, since sub-agent calls also
   carry an identity.
2. **Expand and collapse.** Collapsed by default. Expanded automatically while
   one of its workers is waiting for a reply or approval. The choice is kept
   per Session on the device.
3. **Order.** Workers in the order they were first given work. A worker that
   has been idle for the whole latest Run sorts after active ones.
4. **Row content.** The worker's current task title, falling back to the
   worker name; status icon; a dot when it has new activity since last opened.
   The parent row shows the number of workers.
5. **Worker timeline.** Opens in the main pane. Shows one section per Run
   (with the Run's start time and the user message that started it), then that
   worker's events. Approvals for that worker can be answered here. The
   composer is hidden; a line at the bottom links back to the Session to reply.
6. **Identity across Runs.** Inside one Run a worker is its `agent_id`. Across
   Runs, workers with the same configured worker name are the same row
   (see open question 1).
7. **Routing.** The worker timeline is the Session route with a worker
   parameter (for example `?worker=<agent_id>`), so back/forward, split view
   and "Open in" work the same as for Sessions.
8. **Legacy renderer.** Builds with the legacy ChatBox do not show worker
   rows.

## 6. Work by layer

**Brain**

- `GET /runs/{run_id}/agents`: workers of a Run with name, `agent_id`,
  `agent_ref`, first/last event sequence, current task, status and counts.
- `GET /runs/{run_id}/events?actor_id=<agent_id>`: the existing endpoint with
  an optional filter, so the renderer does not download every event to show
  one worker. Coordinator events that assign or return a task to that worker
  are included.
- Tests next to the existing `/runs` controller tests.

**Renderer**

- Projector: a selector that filters a Session's projected runs to one worker
  and keeps task hand-offs.
- Worker timeline view: reuses `EventTimeline` with the filter; Run section
  headers; approvals; link back to the Session.
- Sidebar: `SessionNavItem.children` for worker rows, a disclosure button on
  the parent row (`aria-expanded`), a guide line and indent from existing
  sidebar tokens, keyboard support (Left/Right to collapse/expand, Up/Down
  through rows), status from the Run projection.
- Entry points: the side panel worker card and the worker label in the
  Session timeline open the worker timeline.

**Later**

- Remote Control shows the same nesting (separate repository).
- Option B, if people need to message a worker directly.

## 7. Open questions

1. Across follow-up Runs, is "same worker name" the right identity, or should
   each Run's workers be separate rows? Recommended: same name, one row.
2. Should finished Sessions keep their worker rows? Recommended: yes, so the
   history stays readable.
3. How does this fit the longer-term choice between Workforce and single-agent
   with sub-agents? Recommended: build the rows on "agents of this Session",
   not on Workforce internals, so both modes can use them.

## 8. Pull requests

1. Brain: agents summary endpoint and actor filter, with tests.
2. Renderer: worker timeline view and entry points from the side panel and the
   timeline.
3. Renderer: nested worker rows in the sidebar.

## 9. Testing

- Brain unit tests: agents summary for a Workforce Run with 3 workers;
  `actor_id` filter returns that worker's events plus its task hand-offs;
  unknown `actor_id` returns an empty list; single-agent Run returns one agent.
- Renderer unit tests: worker filter selector; sidebar rows render children,
  expand/collapse, auto-expand on waiting, keyboard navigation.
- Manual, desktop app:
  1. Start a Workforce Session with 3 workers. The row expands into 3 worker
     rows with live status.
  2. Open each worker; its timeline matches its side panel task log.
  3. A worker asks for approval: the Session auto-expands; approve from the
     worker timeline.
  4. Send a follow-up; the same worker rows gain a second Run section.
  5. Reload the app and restart the Brain; rows and timelines come back.
  6. Split view: open the Session and one worker side by side.
- `npm run type-check`, `npm run lint`, focused backend tests,
  `git diff --check`.
