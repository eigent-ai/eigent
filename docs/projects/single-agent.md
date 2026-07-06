---
title: Single Agent mode
description: Run a task with one CAMEL agent and monitor its progress, context, and outputs.
icon: user-robot
---

Single Agent mode assigns a task to one CAMEL-based agent instead of creating a coordinated multi-agent Workforce. The agent can still use models, tools, Skills, files, browser sessions, and terminal access.

## Choose Single Agent mode

Use Single Agent mode for:

- Focused tasks with one clear goal
- Work that benefits from a continuous context
- Short tool-driven workflows
- Tasks where coordination overhead would add little value
- Iterative follow-ups handled by the same execution pattern

Use Workforce for broad tasks that benefit from specialized roles or parallel subtasks.

## Start a Single Agent project

1. Open the Workspace or select **New**.
2. Select **Single Agent**.
3. Enter the task.
4. Attach required files.
5. Send the request.

Eigent opens a Session and starts the task without a Workforce planning stage.

> **Screenshot placeholder:** Add a screenshot of the new-project composer with Single Agent mode selected.

## Monitor the agent

The Session side panel can show:

- Task progress
- Execution context
- Uploaded files
- Generated output files
- Skills and tools

The chat timeline shows tool calls, status updates, requests for user input, and the final response.

## Use browser and terminal workspaces

When the agent uses browser or terminal tools, the corresponding workspace becomes available in the Session. The workspace is scoped to the selected Run.

## Continue with follow-ups

1. Enter a follow-up request in the Session.
2. Send the request.
3. Use the Run selector to review earlier work.

Each follow-up remains part of the same Project.

## Compare execution modes

| Capability                           | Single Agent | Workforce               |
| ------------------------------------ | ------------ | ----------------------- |
| One continuous agent context         | Yes          | No, work is distributed |
| Task planning and splitting          | Limited      | Yes                     |
| Parallel specialized agents          | No           | Yes                     |
| Agent pool and workflow canvas       | No           | Yes                     |
| Browser, terminal, files, and Skills | Yes          | Yes                     |
| Best for                             | Focused work | Complex multi-step work |

> **Video placeholder:** Add a side-by-side MP4 comparison of the same focused request in Single Agent and Workforce mode. Keep the example short and include captions.

## Troubleshooting

### The task needs another specialty

Add the required tool to the agent, install a connector, or start a Workforce Project with specialized workers.

### The agent cannot access a file

Attach the file, add it to the Space workspace, and confirm that the active Space has the correct folder binding.

### The task is too broad

Split the request into smaller follow-up Runs or use Workforce mode.

## Related guides

- [Create a project](/projects/create-project)
- [Agents overview](/agents/overview)
- [Workforce](/core/workforce)
