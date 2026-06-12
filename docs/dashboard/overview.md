---
title: Dashboard overview
description: Navigate Eigent's Home dashboard and manage Spaces, Projects, Tasks, and Triggers.
icon: grid-2
---

The Home dashboard is the management surface for work across Eigent. Use it to find active work, review history, organize projects, and manage automations without opening each project first.

## Open the dashboard

1. Open Eigent.
2. In the main navigation, select **Home**.
3. Select **Spaces**, **Projects**, **Tasks**, or **Triggers**.

The active section appears in the URL, so returning to the same link restores that section.

> **Screenshot placeholder:** Add a full-width screenshot of the Home dashboard with the four section tabs and toolbar visible. Use sample data that does not contain customer information.

## Dashboard sections

### Spaces

Spaces are top-level work areas. A Space can use an Eigent-managed scratch folder or connect directly to a local folder. Each Space contains projects, tasks, files, and triggers.

### Projects

Projects group related tasks and follow-up runs. Open a project to continue its conversation, review files, or inspect agent activity.

### Tasks

Tasks provide a cross-project history of requests. Use this view when you know the prompt or task status but not the containing project.

### Triggers

Triggers run project prompts on a schedule, through a webhook, or from a supported application event.

## Use the toolbar

The toolbar changes the active dashboard section without changing how its items are managed.

| Control | Purpose                                                     |
| ------- | ----------------------------------------------------------- |
| Search  | Filters the active section by name or prompt                |
| Sort    | Sorts by created time, updated time, or name                |
| Grid    | Shows visual cards with key metadata                        |
| List    | Shows compact rows for scanning many items                  |
| Board   | Groups items into status columns                            |
| Create  | Starts a blank Space or a Space connected to a local folder |

Search and sort reset when you move to another section. The selected layout persists for future visits.

## Understand board status

Board view organizes work into three operational groups:

- **Default:** Work that is not currently executing or waiting for review.
- **Running:** Work with an active task or execution.
- **Awaiting review:** Work that needs user input or a decision.

The exact status of a card still appears in its metadata.

## Start new work

1. In the Home toolbar, open the create menu.
2. Choose **Start from scratch** for an Eigent-managed workspace, or **Use local folder** to connect existing files.
3. Eigent opens the new Space in the Workspace.
4. Enter a task, select Single Agent or Workforce mode, and send the request.

> **Video placeholder:** Add a short MP4 showing a user creating a Space, starting a task, and returning to the dashboard to find the new Project and Task. Include captions.

## Manage existing work

Cards and rows expose actions appropriate to their type:

- Rename or delete a project.
- Open, share, or delete a task.
- Pause or resume an ongoing task.
- Edit, enable, disable, or delete a trigger.
- Open a Space and continue work in its Workspace.

## Next steps

<CardGroup>
  <Card title="Spaces" icon="folder-tree" href="/dashboard/spaces">
    Learn how Spaces define file and project boundaries.
  </Card>
  <Card title="Projects" icon="folder-kanban" href="/dashboard/projects">
    Manage persistent project workstreams.
  </Card>
  <Card title="Views and search" icon="table-columns" href="/dashboard/views-and-search">
    Find work and choose the best dashboard layout.
  </Card>
</CardGroup>
