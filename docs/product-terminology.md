# Eigent product terminology

This document separates user language, frontend presentation names, and frozen
compatibility contracts. Product copy is written for knowledge workers first;
engineering names make every compatibility boundary explicit so a frontend
rename cannot silently alter persisted data.

## Canonical hierarchy

The interactive-work hierarchy remains:

`Space → Session → Run → Step`

- A **Space** groups Files, Sessions, Automations, channels, agents, memory, and
  Space settings. It may be remote or use a local or cloud File source.
- A **Session** is the durable user workstream with Eigent. Users may return to
  it and start more work.
- A **Run** is one execution inside a Session. In cross-domain engineering
  language this is a **Work Session Run**.
- A **Step** is one action or event inside a Run.

Automations form a parallel hierarchy rather than redefining Session Runs:

`Space → Automation → Automation Run → Step`

- An **Automation** is a reusable definition for work that starts on a
  schedule, an event, or an on-demand request.
- An **Automation Run** is one occurrence of that Automation.

## Frontend-to-backend map

| Feature                  | User-facing term | Frontend presentation name              | Frozen compatibility term                                              |
| ------------------------ | ---------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Workspace container      | Space            | `Space*`                                | `Space`, `spaceId`, `space_id`                                         |
| Durable agent workstream | Session          | `WorkSession*`                          | `Project`, `projectId`, `project_id`                                   |
| Session execution        | Run              | `WorkSessionRun*`; Session-owned `Run*` | Run APIs; legacy `Task`, `taskId`, `task_id`                           |
| Automation definition    | Automation       | `Automation*`                           | `Trigger*`, `TriggerType`, trigger routes and stores                   |
| Automation execution     | Automation Run   | `AutomationRun*`                        | `TriggerExecution`, `ExecutionType`, `ExecutionStatus`, `execution_id` |
| Execution event          | Step             | `Step*`                                 | event and projection schema names                                      |
| Space filesystem         | Files            | `FilesBrowser`, `File*`, `FileSource*`  | folder/workdir APIs; route value `context`; tab value `files`          |
| Session-scoped resources | Context          | `SessionContext*`                       | attachments, skill, connector, and MCP compatibility sources           |
| General AI actor         | Agent            | `Agent*`                                | legacy `Worker*`, `workerListData`, `getWorkerList`, `setWorkerList`   |
| One-agent mode           | Single Agent     | `SingleAgent*`                          | existing Session mode value                                            |
| Coordinated-agent mode   | Workforce        | `Workforce*`                            | existing Session mode value                                            |
| Delegated agent          | Sub-agent        | `SubAgent*`                             | legacy subagent and worker fields where required                       |
| Shareable Space setup    | Space profile    | `SpaceProfile*`                         | `WorkspaceBundle*`, document kind `WorkspaceBundle`                    |
| Live Space configuration | Space settings   | `SpaceSettings*`                        | `WorkspaceConfiguration*`; route value `workspace-profile`             |
| Eigent-wide preferences  | App settings     | `AppSettings*`                          | existing Settings routes and stores                                    |
| Invocable agent action   | Tool             | `Tool*`, `ToolCall*`                    | `Toolkit*`, `toolkit_name`, toolkit lifecycle events                   |

Additional presentation surfaces retain the same boundary:

| Surface               | User-facing term | Frontend presentation name           | Frozen compatibility term             |
| --------------------- | ---------------- | ------------------------------------ | ------------------------------------- |
| Main navigation shell | Space sidebar    | `SpaceSidebar`                       | reads Project stores through adapters |
| Session list row      | Session          | `WorkSessionNavItem.projectId`       | Project ID                            |
| Session Run history   | Runs             | `RunHistoryPage`, `RunNavItem.runId` | task/run IDs                          |
| Session mode control  | Session mode     | `WorkSessionModeToggle`              | `Project.mode`, `SessionModeType`     |
| Session memory        | Session Memory   | Work Session presentation            | memory scope value `project`          |

## Run naming and namespaces

- Use **Run** inside a Session because the Session already supplies the scope.
- Use **Automation Run** in every Automation surface. Do not shorten it to Run
  when Session Runs could also be present.
- Use `WorkSessionRun*` and `AutomationRun*` for models or components that can
  cross domain boundaries. Session-owned modules may retain an unambiguous
  `Run*` name, such as `RunHistoryPage`.
- Use **Step** for an action or event within either kind of Run.
- Use **task** for ordinary requested work, plan items, subtasks, and prompt
  descriptions. Do not label Session history records or execution entities as
  Tasks; those are **Runs**, even when a frozen API exposes a `taskId`.
- Do not show **Execution** or **Trigger execution** as entity names. These are
  compatibility terms only.

## Agent language

- **Agent** is the base noun in all user-facing content.
- **Single Agent** and **Workforce** are the two Session mode labels.
- A **Sub-agent** is an Agent delegated by another Agent. A manually configured
  Workforce member is still an Agent unless the product models a real
  parent/delegation relationship.
- Use **Lead agent** only when a real coordinator role exists.
- Use labels such as **Add agent**, **Agent name**, and **Configured agents**.
  Do not show Worker, Coworker, or Teammate as synonyms for the entity.
- New presentation code uses `Agent*`, `SingleAgent*`, `Workforce*`, and
  `SubAgent*`. Legacy worker identifiers stay at store, API, and compatibility
  boundaries until a separately reviewed adapter migration exists.

## Files and Context

These terms describe different scopes and must not be interchangeable:

- **Files** is the Space's durable filesystem and file browser. A Space can use
  a local folder now and a cloud folder in the future.
- **File source** identifies where Files come from. Use **Local files** and
  **Cloud files** as Product labels.
- **Context** is reserved for the Session side panel. Its target meaning is the
  collection of resources deliberately made available to that Session.
- The target Context categories are **Files**, **Connectors**, **MCP servers**,
  and **Skills**. A file can be **Added to context** without renaming the Space
  Files surface.

Use **Connect local files**, **Change local files**, **Connect cloud files**,
and **Disconnect files**. Literal folder language is reserved for the operating
system picker instruction, such as **Choose a folder on this device**. Do not
show Bind folder, Workspace files, or Folder context as Product entity names.

This rename-only release does not add a Session-context selection store. The
existing side-panel section continues to summarize observed Skill, Connector,
and MCP usage from Run events, while attached and generated files remain in
their existing Files sections. Treat that as a compatibility presentation, not
proof that a resource was deliberately Added to context. A future data change
must separate **Added context** from **Activity**, **Tools used**, or **Used in
this Run**.

Use `FilesBrowser`, `File*`, and `SessionContext*` in presentation code. Avoid
a bare product-domain `Context*` name because it collides with React and
request context concepts. Preserve serialized `context` route and schema
values behind adapters.

## Automation model

The target Automation taxonomy has two independent classification dimensions:

| Dimension  | Canonical values                              | Meaning                           |
| ---------- | --------------------------------------------- | --------------------------------- |
| Start type | Scheduled, Event, On demand                   | How the Automation begins         |
| Source     | Eigent, Files, App or connector, API, Webhook | Where the start signal originates |

- **App automation** is not a start type. An app event is an **Event** start
  with an app or connector Source. A button inside an app is an **On demand**
  start with an app Source.
- Use **Automations** for the navigation destination and reusable definitions.
- Use concise **Scheduled**, **Event**, and **On demand** labels for filters or
  tabs. Use scheduled automation, event automation, and on-demand automation in
  explanatory copy.
- This rename-only release preserves the current editor and backend enum
  structure. Its presentation mapping is `schedule` → **Scheduled automation**,
  `webhook` → **Event automation**, and `slack_trigger` or the existing app
  group → **App automation**. **Automation type** is the compatibility umbrella
  label; none of these labels creates a new serialized value.
- If the editor is later split into the two canonical dimensions, use **Starts
  when** and **Source**. That requires a separately reviewed feature change.
  Trigger may then appear only in an advanced technical inspector when it
  refers to the actual start mechanism.
- Use **Run now**, **Automation runs**, **Last run**, and **Next run**.
- Preserve `Trigger*`, `Execution*`, `triggers`, `navigate-scheduled`, and
  serialized trigger values behind Automation presentation adapters.

## Space profile, Space settings, and App settings

- **App settings** contains Eigent-wide account, application, and device
  preferences. A global menu may use the concise label **Settings** when the
  destination is already clear.
- **Space settings** is the live editor for one Space's identity, model,
  environment, instructions, agents, skills, connectors, MCP servers,
  permissions, and related behavior.
- **Space profile** is a portable, versioned, publishable representation of a
  Space setup. Use Publish Space profile, Share Space profile, Import Space
  profile, Apply profile to Space, and Profile version.
- Keep **Install profile** at a security review step when the profile includes
  executable Skills, scripts, MCP servers, assets, or secret requirements.
- **Space template** is reserved for a future starter recipe that is copied to
  create a new Space. Space template and Space profile are not synonyms.
- Reserve **Configuration** for serialized documents, APIs, machine-facing
  formats, and engineering explanations. Do not use Workspace configuration as
  the user-facing destination.
- Always scope the word Profile. Prefer **Permission mode** over Permission
  profile, **Model preset** over Model profile, and **Account** or **User
  profile** for the person.

New presentation code uses `AppSettings*`, `SpaceSettings*`, and
`SpaceProfile*`. Preserve `WorkspaceConfiguration*`, `WorkspaceBundle*`, and
the `workspace-profile` route at their compatibility boundaries.

## Tools, Toolkits, and capability providers

- Use **Tool** or **Tools** throughout the UI. A Tool is an invocable action.
- Remove the Toolkit suffix from display names: Browser Toolkit becomes
  Browser; Search Toolkit becomes Search.
- Use **Tool call**, **Tools used**, and **Available tools** rather than Toolkit
  call, Toolkits used, or Available toolkits.
- Keep Connector, MCP server, Skill, Plugin, and Tool distinct. A Connector or
  MCP server can provide Tools; a Skill provides reusable instructions or a
  workflow; a Plugin packages capabilities.
- New presentation code uses `Tool*` and `ToolCall*`. Preserve `Toolkit*`,
  `toolkit_name`, `activate_toolkit`, and `deactivate_toolkit` at event, API,
  projection, and compatibility boundaries.
- Use `formatToolDisplayName(rawToolkitName)` only at presentation boundaries;
  retain the raw name for event matching, icon lookup, and diagnostics.

## Naming rules

1. Use **Session** in all visible Product copy. Do not show Project as the
   Eigent entity name.
2. Use `WorkSession*` for new or renamed Session presentation components and
   view models. The existing `components/Session` page and side-panel folder
   remain in place to avoid a high-risk path-only migration.
3. Keep `Project*`, `projectId`, and `project_id` for stores, services, API
   payloads, database models, event projections, and compatibility adapters.
4. At the presentation boundary, keep the backing ID explicit: use
   `WorkSessionNavItem.projectId`. Never introduce `sessionId` as an alias for
   a Project ID.
5. Keep Work Session Runs and Automation Runs explicitly namespaced. Never use
   Session for a Run or Automation Run for a Session Run.
6. Use Agent, Files, Context, Automation, Space profile, Tool, App settings,
   and Space settings only with the scopes defined above.
7. Translation keys containing project, trigger, execution, worker, toolkit,
   workspace, or configuration may be compatibility identifiers. Their visible
   values must use canonical Product language. Migrate keys only in an atomic,
   separately reviewed change.
8. Recognize both legacy placeholders (`New Project`, `Project {id}`) and new
   placeholders (`New Session`, `Session {id}`) while stored data is mixed.
9. Use sentence case for UI labels and headings. Treat product entity nouns as
   common nouns unless they begin the string or are an explicitly branded name.

## Frozen compatibility identifiers

Do not rename these as part of frontend terminology work:

- workspace tab and route values such as `project`, `projects`, `new-project`,
  `triggers`, `context`, `files`, and `workspace-profile`;
- command and shortcut IDs such as `new-project`, `navigate-files`,
  `navigate-scheduled`, and `navigate-configuration`;
- API paths and fields including `/projects`, `/chat/{projectId}`,
  `/task/{projectId}/take-control`, `projectId`, and `project_id`;
- persisted store fields and keys such as `projectsBySpaceId`,
  `projectIdIndex`, `lastVisitedProjectBySpace`, and
  `eigent-pinned-projects`;
- disk and Git identities such as `project_{id}` and
  `refs/heads/eigent/project/`;
- `ProjectEventStore`, Project runtime stores, hydration, projection, and
  service modules;
- `Trigger*`, `TriggerExecution`, `ExecutionType`, `ExecutionStatus`,
  `trigger_id`, `execution_id`, and serialized trigger type values;
- legacy Worker names such as `workerListData`, `getWorkerList`,
  `setWorkerList`, and `hasAddWorker` where they are persisted or coupled to a
  compatibility boundary;
- `WorkspaceBundle*`, document kind `WorkspaceBundle`,
  `WorkspaceConfiguration*`, and related service payload fields;
- `Toolkit*`, `toolkit_name`, and toolkit lifecycle event identifiers;
- memory scope value `project` and legacy `taskId` fields.

These identifiers may be wrapped by presentation adapters, but their serialized
values must remain unchanged.
