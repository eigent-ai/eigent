---
title: Spaces
description: Organize projects and local folders into persistent Eigent work areas.
icon: folder-tree
---

A Space is the top-level boundary for work in Eigent. It groups projects, tasks, triggers, and files so that related work stays together.

## Choose a Space type

### Blank Space

A blank Space starts with an Eigent-managed scratch workspace. Use it for research, writing, planning, or tasks that should not modify an existing local folder.

### Local-folder Space

A local-folder Space binds Eigent to a folder on your computer. Use it when agents need to inspect or modify an existing codebase, document set, or project directory.

### Legacy Space

A legacy Space contains work created before the current Space system. Eigent keeps these projects available so that older task history remains accessible.

## Create a blank Space

1. In the Home dashboard, select **Spaces**.
2. Open the create menu.
3. Select **Start from scratch**.
4. Eigent creates a Space and opens its Workspace.
5. Optional: Rename the Space from the Space switcher.

Blank Spaces use artifact-only storage. Agents create outputs in Eigent-managed project storage rather than writing directly to a user-selected folder.

## Create a Space from a local folder

1. In the Home dashboard, select **Spaces**.
2. Open the create menu.
3. Select **Use local folder**.
4. In the folder picker, select the directory that Eigent can access.
5. Confirm the selection.

The Space name initially follows the selected folder name. The **Context** tab shows the folder binding.

> **Screenshot placeholder:** Add a screenshot of the Space creation menu with **Start from scratch** and **Use local folder** visible.

## Switch Spaces

1. In the project sidebar, select the current Space name.
2. Select another Space.

Eigent loads that Space's projects and restores its most recently visited project when possible.

## Rename a Space

1. Open the Space switcher.
2. Open the actions for the active Space.
3. Select **Rename**.
4. Enter a non-empty name and select **Save**.

Legacy Spaces and some system-managed Spaces cannot be renamed.

## Work with local changes

Local-folder Spaces can show pending workspace changes. Depending on the current state, the Space menu can provide actions to:

- Load or refresh the working directory.
- Apply pending changes.
- Discard pending changes.
- Resolve a stale workspace state.

Review changed files before applying or discarding them.

> **Video placeholder:** Add a short MP4 showing a local-folder Space, agent-generated file changes, review in Context, and the apply or discard workflow. Include captions.

## Review Space status

The Spaces dashboard shows:

- Space name and source type
- Local folder name when applicable
- Project count
- Task count
- Trigger count
- Current operational status

Use board view to group Spaces by default, running, and awaiting-review state.

## Troubleshooting

### Context is unavailable

The active Space might not have a workspace binding. Create a Space from a local folder or wait for Eigent to finish preparing the scratch workspace.

### A local folder does not appear

Confirm that the folder still exists and that Eigent has operating-system permission to access it.

### A blank Space disappeared

Eigent can hide unused placeholder Spaces. Start a project or give the Space a meaningful name to keep it in the dashboard.

## Related guides

- [Create a project](/projects/create-project)
- [Context and files](/projects/context-and-files)
- [Dashboard projects](/dashboard/projects)
