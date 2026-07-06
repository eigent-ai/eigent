---
title: Automation overview
description: Run Eigent tasks on schedules, webhooks, app events, or remote-control commands.
icon: bolt
---

Automation turns a project prompt into reusable work that can run without manually opening the task composer.

Eigent supports scheduled triggers, webhooks, selected application events, and remote-control commands.

## Open Automations

Use either entry point:

- In the project sidebar, select **Scheduled**.
- In the Home dashboard, select **Triggers**.

The project sidebar focuses on the active Space and Project. The Home dashboard provides a cross-project trigger view.

> **Screenshot placeholder:** Add a screenshot of the Scheduled tab with the trigger list and execution log panel visible.

## Choose an automation type

### Scheduled trigger

Runs a prompt once or on a daily, weekly, monthly, or custom cron schedule.

### Webhook trigger

Creates an HTTP endpoint that starts a task when an external system sends a request.

### Slack trigger

Starts a task from a configured Slack event. Availability depends on connector and trigger configuration.

### Remote control

Dispatch creates a shareable web session that can send follow-up commands to a desktop task in the selected Space.

## Create a trigger

1. Open **Scheduled**.
2. Select **Create**.
3. Enter a trigger name.
4. Select the Project.
5. Enter the task prompt.
6. Choose Schedule or App.
7. Configure timing, event, or webhook values.
8. Save the trigger.

## Manage triggers

You can:

- Edit a trigger
- Activate or deactivate it
- Delete it
- Sort by created time, last execution, or token cost
- Review execution history
- Retry a failed execution

## Review execution logs

Open the execution log panel to see:

- Trigger lifecycle events
- Execution start and completion
- Errors and cancellations
- Webhook receipt
- Token or task metadata when available

Use the logs to distinguish trigger-delivery failures from task-execution failures.

## Control execution

Set:

- Maximum failure count
- Hourly execution limits
- Daily execution limits
- Expiration date for recurring schedules

These controls help prevent a misconfigured trigger from generating unbounded work.

> **Video placeholder:** Add a 90-second MP4 showing a scheduled trigger creation, automatic execution, log review, deactivation, and retry. Include captions.

## Security

- Treat webhook URLs as credentials.
- Restrict app-trigger permissions.
- Review task prompts before enabling recurring execution.
- Add rate limits to event-driven triggers.
- Disable triggers that are no longer monitored.

## Related guides

- [Scheduled triggers](/automation/scheduled-triggers)
- [Webhook and app triggers](/automation/webhook-triggers)
- [Dispatch and remote control](/automation/dispatch)
