---
title: Projects overview
description: Understand how Spaces, Projects, Sessions, and Runs organize work in Eigent.
icon: folder-kanban
---

Projects are persistent workstreams inside a Space. A project keeps related conversations, task runs, agents, files, browser activity, terminal state, and automations together.

## Product hierarchy

Eigent organizes work into four levels:

| Level   | Purpose                                           |
| ------- | ------------------------------------------------- |
| Space   | Defines the top-level workspace and file boundary |
| Project | Groups related work around an ongoing goal        |
| Session | Presents the conversation and execution surfaces  |
| Run     | Represents one request or follow-up task          |

For example, a Space called “Marketing” can contain a “Product launch” project. The project session can include separate runs for research, copywriting, and presentation creation.

## Use the project sidebar

The project sidebar is available in the main Workspace. It provides access to:

- The Space switcher
- Workspace
- Context
- Scheduled triggers
- Dispatch
- New project
- Projects in the active Space
- Project actions

The sidebar can be resized or folded into an icon rail.

> **Screenshot placeholder:** Add a screenshot of the expanded project sidebar. Annotate the Space switcher, Workspace, Context, Scheduled, Dispatch, New, and project list in surrounding text.

## Start a project

1. Select a Space from the sidebar.
2. Select **New** or open the Workspace.
3. Enter the first task.
4. Choose Single Agent or Workforce mode.
5. Attach required files.
6. Send the task.

Eigent creates the Project and opens its live Session.

## Continue a project

Submit a follow-up request in the same conversation. Eigent adds a new Run while preserving earlier prompts, progress, and outputs.

Use this approach when the new request contributes to the same goal. Create another Project when the work needs a separate history, file context, or lifecycle.

## Manage project status

### Active

An active project can accept new runs, execute triggers, and appear in the project sidebar.

### Achieved

An achieved project is complete. If a run is still active when you end the project, Eigent stops that run before saving the achieved state.

### Archived or deleted

Archived projects leave the active workflow. Deleting a project can also remove its local project data. Save important output files before deletion.

## Search across projects

Use `Command/Ctrl + K` from the Workspace to open global search. Search can help locate existing projects and sessions without returning to the Home dashboard.

> **Video placeholder:** Add a 60-second MP4 showing project creation, a follow-up run, global search, and project completion. Include captions.

## Related guides

<CardGroup>
  <Card title="Create a project" icon="plus" href="/projects/create-project">
    Start the first run and choose an execution mode.
  </Card>
  <Card title="Sessions" icon="messages" href="/projects/sessions">
    Follow agent execution and review outputs.
  </Card>
  <Card title="Project runs" icon="rotate" href="/core/project-runs">
    Continue work with follow-up requests.
  </Card>
</CardGroup>
