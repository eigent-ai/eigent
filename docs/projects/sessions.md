---
title: Sessions
description: Follow task execution through chat, progress, agents, logs, files, browser, and terminal views.
icon: messages
---

A Session combines the project conversation with live execution details. It is the main surface for reviewing what Eigent understood, what its agents are doing, and what they produced.

## Session layout

The Session contains:

- A chat and task timeline
- A task composer for follow-up requests
- A session side panel
- Workspace surfaces for files, browser, terminal, or workflow
- Controls for pausing, resuming, stopping, or expanding work

> **Screenshot placeholder:** Add a screenshot of an active Workforce Session. Show the chat, task log, Run selector, progress, agent pool, and workspace surface.

## Review the conversation

The chat timeline can contain:

- User prompts and attachments
- Planning status
- Workforce task plans
- Agent tool calls and logs
- Human-in-the-loop questions
- Completion summaries
- Follow-up runs

Expand task logs when you need operational detail. Use summaries and generated files for the final result.

## Review a Workforce plan

Before execution, Workforce can split the request into subtasks.

1. Review each subtask.
2. Edit unclear or overly broad items.
3. Add missing work.
4. Delete unnecessary work.
5. Start the task.

The coordinator assigns each subtask to an appropriate worker.

## Use the session side panel

In Workforce mode, the side panel can show:

- Agent pool
- Progress
- Execution context
- Uploaded files
- Generated files
- Skills and tools
- Expanded Workforce canvas

In Single Agent mode, it shows the selected agent's progress, context, and outputs without the multi-agent canvas.

## Open an agent workspace

Select an agent or subtask to open its workspace:

- Browser agents use an embedded browser.
- Developer agents use a terminal.
- Document and file work appears in Context.
- Workflow view shows the agent and task structure.

When a browser needs manual help, use the available take-control flow, complete the action, and return control to the agent.

## Pause, resume, or stop work

- **Pause** preserves the task state and elapsed time.
- **Resume** continues a paused task.
- **Stop** ends the current execution while preserving the Project history.

Use Stop when the task is no longer useful or is consuming resources without making progress.

## Continue with a follow-up

Enter another request in the composer. Eigent adds the request as a new Run. Use the Run selector to switch the side panel and workspaces between runs.

> **Video placeholder:** Add a 90-second MP4 showing plan review, task execution, a browser or terminal workspace, pause and resume, and a follow-up Run. Include captions and a transcript.

## Troubleshooting

### Progress and chat show different runs

Use the Run selector. The side panel follows the selected or visible Run.

### An agent workspace is empty

The selected Run might not have used that agent or workspace. Select another agent, return to workflow view, or choose the relevant Run.

### A task is waiting

Check the chat for a human-in-the-loop request, plan approval, authentication step, or unavailable tool.

## Related guides

- [Project runs](/core/project-runs)
- [Single Agent mode](/projects/single-agent)
- [Workforce](/core/workforce)
- [Context and files](/projects/context-and-files)
