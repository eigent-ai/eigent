---
title: Project runs
description: Continue a project with follow-up requests and switch between each run's progress, context, and outputs.
icon: rotate
---

Use follow-up requests to continue working in the same Project without losing earlier history. Eigent saves the original task and each follow-up as a separate **Run**.

The Run selector appears in the Session side panel after a Project contains at least two Runs.

## Understand Runs

The first request in a Project is **Run 1**. The first follow-up is **Run 2**, and later follow-ups continue in chronological order.

Each Run can have its own:

- Prompt and attachments
- Status
- Plan and subtasks
- Assigned agents
- Execution context
- Browser and terminal state
- Generated files

> **Screenshot placeholder:** Add a screenshot of a Project with **Run 2** selected and the Run dropdown open. Show at least one completed Run and one active Run.

## Create another Run

1. Open a Project.
2. In the Session composer, enter a follow-up request.
3. Attach any new files.
4. Send the request.
5. In Workforce mode, review and start the new plan.

Eigent adds the request to the same conversation and updates the Run selector.

Use a follow-up when the new request depends on previous work. Create another Project when the goal, file boundary, or audience is unrelated.

## Switch Runs

1. Open the Session side panel.
2. Select **Run N** in the panel header.
3. Select a Run from the dropdown.

The dropdown lists the newest Run first. Each item includes:

- Run number
- Prompt preview
- Status indicator
- Checkmark for the selected Run

Selecting a Run scrolls the conversation to that request and updates the Session side panel.

## Understand status indicators

| Indicator         | Meaning                     |
| ----------------- | --------------------------- |
| Pulsing brand dot | Pending or running          |
| Green dot         | Finished                    |
| Red dot           | Failed                      |
| Neutral dot       | Inactive or no final status |

## Review Run-specific content

Selecting a Run updates the available:

- Workforce or Single Agent progress
- Agents and subtasks
- Execution context
- Uploaded and generated files
- Browser workspace
- Terminal workspace
- Expanded Workforce view

Opening a file or selecting a subtask acts on the selected Run instead of automatically using the latest Run.

## Scroll through Run history

The Run selector and conversation remain synchronized:

- Selecting a Run scrolls the conversation to it.
- Manually scrolling to another Run updates the Run label.
- After a dropdown selection, Eigent keeps the selected Run while smooth scrolling reaches the requested position.

> **Video placeholder:** Add a 45-60 second MP4 showing Run selection, automatic chat scrolling, manual scrolling, and the side panel changing between two Runs. Include captions.

## Example workflow

Suppose Run 1 asks Eigent to research a market and create a report.

1. Add competitor pricing as Run 2.
2. Turn the updated findings into a presentation as Run 3.
3. Select Run 1 to review the original research.
4. Select Run 2 to inspect pricing outputs.
5. Select Run 3 to monitor presentation creation.

All three Runs remain in one Project.

## Troubleshooting

### The Run selector is not visible

The Project contains only one Run, or the follow-up has not been added to the conversation.

### The side panel changes while you scroll

The selected Run follows the Run most visible in the conversation. Select a Run from the dropdown to return to it.

### An older Run has no workspace

That Run might not have used the selected agent, browser, terminal, or output type.

### A Run does not appear

A Run needs a user prompt. Wait for the follow-up to appear in the conversation, then reopen the selector.

## Related guides

- [Projects overview](/projects/overview)
- [Sessions](/projects/sessions)
- [Context and files](/projects/context-and-files)
