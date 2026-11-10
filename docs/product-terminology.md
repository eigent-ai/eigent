# UI-to-backend terminology match

This document matches the wording users see in Eigent with the backend terms
engineers must preserve. UI copy and presentation component names use the UI
wording below. Backend, API, database, route, event, and persisted identifiers
continue to use their existing technical terms and values.

## Product hierarchy

| Layer | UI wording | Backend term |
| ----- | ---------- | ------------ |
| 1     | Space      | Space        |
| 2     | Session    | Project      |
| 3     | Task       | Task         |

The hierarchy shown in the product is:

`Space → Session → Task`

## UI-to-backend match

| UI wording                                    | Backend term or identifier                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space                                         | `Space`, `space_id`, `spaceId`, `activeSpaceId`                                                                                                                                                                 |
| Spaces                                        | Space collections and Space APIs                                                                                                                                                                                |
| Session                                       | `Project`, `project_id`, `projectId`, `activeProjectId`                                                                                                                                                         |
| Sessions                                      | Project collections such as `projectsBySpaceId`                                                                                                                                                                 |
| New session                                   | New Project operation; `new-project` route and command values                                                                                                                                                   |
| Session name                                  | `Project.name` and Project name fields                                                                                                                                                                          |
| Rename session                                | Project rename or update operation                                                                                                                                                                              |
| Delete session                                | Project delete or archive operation                                                                                                                                                                             |
| End session                                   | Project achieved state and Project update operation                                                                                                                                                             |
| Session details                               | Project metadata and Project history                                                                                                                                                                            |
| Task                                          | `Task`, `task_id`, `taskId`                                                                                                                                                                                     |
| Tasks                                         | Task collections and Task APIs                                                                                                                                                                                  |
| Dev mode                                      | `chatTimelineDetailLevel` in the `eigent-page-tab` store: `trajectory` when on, `narrative` when off; `toggle-timeline-view` command; `chat.timeline-dev-mode` and `layout.shortcuts.toggle-timeline-view` keys |
| Information density (Minimum, Moderate, Full) | `narrativeInformationDensity` in the `eigent-page-tab` store: `compact`, `balanced`, `expanded`; `chat.timeline-information-density` and `chat.timeline-density-*` keys                                         |

Use sentence case in headings, tabs, table headers, menus, dialogs, tooltips,
toasts, empty states, and accessibility labels. Use **Task** or **Tasks**, never
all-cap **TASK** or **TASKS**. Do not expose **Project** as the product entity
name.

**Dev mode** and **Information density** are the two view settings in the
Session menu of the event-native conversation timeline. Dev mode shows the
full tool-by-tool trajectory instead of the narrative summary; Information
density sets how much of the narrative is shown. In English copy write them in
sentence case ("Dev mode", "Toggle dev mode"); do not expose "Trajectory" or
"Narrative", which are implementation words. Other locales keep their existing
translations.

## Presentation naming match

Presentation files, folders, components, props, and local UI variables should
describe the surface users see.

| UI surface or presentation name           | Backing backend responsibility               |
| ----------------------------------------- | -------------------------------------------- |
| `SpaceSidebar`                            | Active Space plus its Project collection     |
| `SessionNavList`                          | Project navigation list                      |
| `SessionNavListRows`, `SessionNavItem`    | Project metadata and Project IDs             |
| `SpaceSwitchDropdown`                     | Space selection                              |
| Space management and `Space*` details     | Space stores, APIs, and identifiers          |
| Session management and `Session*` details | Project stores, APIs, and identifiers        |
| Space-owned `File*` or `Folder*` browser  | Space filesystem or work-directory contracts |
| Session-owned file preview or context     | Project-scoped Task and file contracts       |

When a presentation component handles both a Space and its Sessions, name it
for the surface it owns. For example, `SpaceSidebar` owns the sidebar, while
its nested list remains `SessionNavList` because those rows represent Sessions.

## Frozen technical contracts

Do not rename or change the values of technical identifiers as part of a UI
terminology update. This includes:

- `Project`, Project stores, services, runtime modules, and API models;
- `project_id`, `projectId`, `activeProjectId`, and other Project-keyed fields;
- route and tab values such as `project`, `projects`, and `new-project`;
- command and shortcut IDs such as `new-project` and `toggle-timeline-view`;
- stored view-setting values such as `trajectory`, `narrative`, `compact`,
  `balanced`, and `expanded`;
- API paths, request fields, response fields, database columns, and event
  payloads that use Project terminology;
- persisted keys such as `projectsBySpaceId`, `lastVisitedProjectBySpace`, and
  `eigent-pinned-projects`;
- existing translation keys containing `project` when only their displayed
  value needs to change.

These identifiers may be consumed by Session-named presentation code, but no
new serialized alias should be introduced.

## Boundary example

```tsx
<SessionNavList
  sessions={projectMetas}
  activeSessionId={activeProjectId}
  onSessionClick={(projectId) => projectStore.setActiveProject(projectId)}
/>
```

In this example, the presentation API follows the visible Session wording.
`projectMetas`, `activeProjectId`, the callback value, and the Project store
remain backend-facing Project contracts. The ID is passed through without
changing, aliasing, or reserializing it.

## Change checklist

For terminology-only work:

1. Update visible copy, accessibility labels, and presentation-oriented names.
2. Classify files and components by ownership: Space, Session, or shared.
3. Preserve all frozen identifiers and serialized values.
4. Search for stale visible Project wording separately from technical Project
   contracts.
5. Run focused UI tests, type checking, locale parity checks when copy changes,
   formatting, lint, and `git diff --check`.
