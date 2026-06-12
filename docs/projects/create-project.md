---
title: Create a project
description: Start a project, choose an execution mode, attach files, and submit the first task.
icon: plus
---

Create a Project when you want Eigent to keep related tasks, files, and follow-up requests together.

## Before you begin

Confirm the following:

- A Space is selected.
- At least one model is configured.
- The task goal is clear enough to plan or execute.
- Required source files are available.

If no model is configured, Eigent opens the Models page instead of starting the task.

## Open the project composer

Use one of these entry points:

- In the project sidebar, select **New**.
- In the project sidebar, select **Workspace**.
- From the Home dashboard, create or open a Space.

The composer displays the active Space and lets you select a project mode.

> **Screenshot placeholder:** Add a screenshot of the new-project composer with the Space, project picker, Single Agent or Workforce toggle, attachment control, and send action visible.

## Choose an execution mode

### Single Agent

Single Agent mode uses one CAMEL-based agent with the available tools. Choose it for focused tasks that benefit from one continuous context.

### Workforce

Workforce mode plans the request and distributes subtasks across specialized agents. Choose it for research, software, documents, or other work that benefits from parallel roles.

You cannot change the execution mode of a run after it starts. Create another run or project when you need a different mode.

## Attach source files

1. In the composer, select the attachment control.
2. Choose one or more files.
3. Confirm that the file names appear in the composer.
4. Mention the files and their purpose in the request.

Attachments become part of the first run's execution context.

## Write the first request

Describe:

- The desired outcome
- Required source material
- Constraints or acceptance criteria
- Preferred output format
- Any service or tool the agents should use

For example:

> Analyze the attached customer interview notes. Group the findings into themes, identify the five highest-impact problems, and create a Markdown report with supporting quotes and recommended product actions.

## Start the project

1. Review the selected Space, mode, files, and request.
2. Select **Send**.

Eigent creates a server-backed Project in the active Space, opens the Session, and starts the first Run.

In Workforce mode, Eigent can show a task plan before execution. Review, edit, add, or remove subtasks before starting the plan.

> **Video placeholder:** Add a 60-90 second MP4 showing project creation in both Single Agent and Workforce modes. Include captions and pause briefly on the Workforce plan review.

## Troubleshooting

### The send action does nothing

Confirm that the request contains text and that project startup is not already in progress.

### Eigent asks for a model

Open **Agents > Models**, configure a provider, and return to the composer.

### A file is missing

Attach it again before sending, or add it from the Context tab in an existing project.

### The wrong Space is selected

Cancel the draft, select the correct Space, and start the project there. Space selection defines the project and file boundary.

## Next steps

- [Workspace](/projects/workspace)
- [Sessions](/projects/sessions)
- [Single Agent mode](/projects/single-agent)
- [Workforce](/core/workforce)
